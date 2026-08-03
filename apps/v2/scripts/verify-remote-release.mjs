const owner = process.env.GITHUB_REPOSITORY_OWNER ?? '1290464284-ship-it';
const repo = process.env.GITHUB_REPOSITORY_NAME ?? 'rongyi';
const tag = process.env.V2_RELEASE_TAG ?? 'v2-2.1.0';

async function api(pathname) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${pathname} failed: ${response.status}`);
  return response.json();
}

const releases = await api('releases?per_page=100');
const release = releases.find((item) => item.tag_name === tag);
if (!release) throw new Error(`Release ${tag} not found`);

const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
const latestAsset = assets.get('latest.yml');
if (!latestAsset) throw new Error('latest.yml asset is missing');

const latestResponse = await fetch(latestAsset.browser_download_url);
if (!latestResponse.ok) throw new Error('latest.yml download failed');
const latestYml = await latestResponse.text();
const pathMatch = latestYml.match(/^path:\s*(.+)$/m);
const sizeMatch = latestYml.match(/^\s+size:\s*(\d+)$/m);
if (!pathMatch || !sizeMatch) throw new Error('latest.yml is missing path or size');

const installerName = pathMatch[1].trim();
const installerSize = Number(sizeMatch[1]);
const installerAsset = assets.get(installerName);
if (!installerAsset) throw new Error(`Installer asset not found: ${installerName}`);
if (installerAsset.size !== installerSize) {
  throw new Error(`Size mismatch: latest.yml=${installerSize}, asset=${installerAsset.size}`);
}

const blockmapName = `${installerName}.blockmap`;
if (!assets.has(blockmapName)) throw new Error(`Blockmap asset not found: ${blockmapName}`);

console.log(`remote release verified: ${tag} -> ${installerName} (${installerSize} bytes)`);
