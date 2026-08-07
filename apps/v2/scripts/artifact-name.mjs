import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function installerFileName(pkg) {
  const template = pkg.build.artifactName ?? `${pkg.build.productName} Setup ${pkg.version}.${'ext'}`;
  return template
    .replaceAll('${version}', pkg.version)
    .replaceAll('${ext}', 'exe');
}

// CLI 入口：直接运行打印当前 package.json 对应的 installer 精确文件名
// （Round7 M7：发布 workflow 用它生成精确资产名，替代 *.exe 通配符）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..'), 'package.json'), 'utf8'));
  process.stdout.write(installerFileName(pkg));
}
