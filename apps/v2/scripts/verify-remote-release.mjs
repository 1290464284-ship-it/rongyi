import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUEST_TIMEOUT_MS = 300_000;

function timedFetch(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// Round7 I2：GitHub 不提供 GITHUB_REPOSITORY_NAME，从 GITHUB_REPOSITORY
// （owner/repo）解析；仓库改名/迁移后仍能指向正确仓库。
const ghRepo = process.env.GITHUB_REPOSITORY ?? '';
const [ghOwner, ghRepoName] = ghRepo.split('/');
const owner = ghOwner || process.env.GITHUB_REPOSITORY_OWNER || '1290464284-ship-it';
const repo = ghRepoName || 'rongyi';

// Round7 C2：默认 tag 从 package.json 推导（v2-<version>），不再硬编码
// 2.2.0。CI 中由 V2_RELEASE_TAG 显式注入（严格模式）；本地裸跑且该版本
// 尚未发布时给出明确 warning 而不是报错。
const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const tagExplicitlySet = Boolean(process.env.V2_RELEASE_TAG);
const tag = process.env.V2_RELEASE_TAG ?? `v2-${pkg.version}`;

async function api(pathname) {
  const response = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      // 关闭 keep-alive，避免脚本退出时 Node(Windows) 对未关闭的
      // fetch 连接做 teardown 时触发 libuv 断言。
      connection: 'close',
      ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${pathname} failed: ${response.status}`);
  return response.json();
}

const releases = await api('releases?per_page=100');
const release = releases.find((item) => item.tag_name === tag);
if (!release) {
  const message = `Release ${tag} not found (latest remote: ${releases[0]?.tag_name ?? 'none'})`;
  if (tagExplicitlySet) {
    throw new Error(`${message}; V2_RELEASE_TAG was set explicitly — this is a real failure`);
  }
  // 本地裸跑场景：默认 tag 来自 package.json，未发布不代表脚本错误。
  console.warn(`::warning::${message}`);
  console.warn(`::warning::local bare run: package.json version ${pkg.version} may not be published yet; pass V2_RELEASE_TAG to verify strictly`);
  process.exit(0);
}

const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
const latestAsset = assets.get('latest.yml');
if (!latestAsset) throw new Error('latest.yml asset is missing');

console.log(`downloading latest.yml from ${latestAsset.browser_download_url}`);
const latestResponse = await timedFetch(latestAsset.browser_download_url, {
  headers: { connection: 'close' },
});
if (!latestResponse.ok) throw new Error('latest.yml download failed');
const latestYml = await latestResponse.text();
const pathMatch = latestYml.match(/^path:\s*(.+)$/m);
const sizeMatch = latestYml.match(/^\s+size:\s*(\d+)$/m);
const sha512Match = latestYml.match(/^\s*sha512:\s*([A-Za-z0-9+/=]+)$/m);
if (!pathMatch || !sizeMatch || !sha512Match) {
  throw new Error('latest.yml is missing path, size or sha512');
}

const installerName = pathMatch[1].trim();
const installerSize = Number(sizeMatch[1]);
const expectedSha512 = sha512Match[1];
const installerAsset = assets.get(installerName);
if (!installerAsset) throw new Error(`Installer asset not found: ${installerName}`);
if (installerAsset.size !== installerSize) {
  throw new Error(`Size mismatch: latest.yml=${installerSize}, asset=${installerAsset.size}`);
}

const blockmapName = `${installerName}.blockmap`;
if (!assets.has(blockmapName)) throw new Error(`Blockmap asset not found: ${blockmapName}`);

// Round7 H7：下载安装包并校验 sha512 与 latest.yml 一致（校验闭环）。
// 只比对 size 无法发现"元数据生成后被替换/上传错误产物"的场景。
console.log(`downloading installer ${installerName} (${installerSize} bytes)`);
const installerResponse = await timedFetch(installerAsset.browser_download_url, {
  headers: { connection: 'close' },
});
if (!installerResponse.ok) {
  throw new Error(`Installer download failed: ${installerResponse.status}`);
}
const installerBuffer = Buffer.from(await installerResponse.arrayBuffer());
const actualSha512 = crypto.createHash('sha512').update(installerBuffer).digest('base64');
if (actualSha512 !== expectedSha512) {
  throw new Error(`sha512 mismatch: latest.yml=${expectedSha512}, installer=${actualSha512}`);
}
if (installerBuffer.length !== installerSize) {
  throw new Error(`Size mismatch on download: latest.yml=${installerSize}, actual=${installerBuffer.length}`);
}

console.log(`remote release verified: ${tag} -> ${installerName} (${installerSize} bytes, sha512 ok)`);
