const asar = require('asar');
const fs = require('fs');
const path = require('path');

// 支持通过环境变量或命令行参数自定义输出目录
// 用法: node repack-asar.js [releaseDir] [platform]
//   releaseDir: 发布目录名，默认 'release-final'
//   platform:   平台目录名，默认 'win-unpacked'
const releaseDir = process.argv[2] || process.env.RELEASE_DIR || 'release-final';
const platformDir = process.argv[3] || process.env.PLATFORM_DIR || 'win-unpacked';

const asarPath = path.join(__dirname, releaseDir, platformDir, 'resources', 'app.asar');
const tempDir = path.join(__dirname, 'temp-asar');
const sourceElectronDir = path.join(__dirname, 'apps', 'web', 'electron');

if (!fs.existsSync(asarPath)) {
  console.error(`错误: app.asar 不存在: ${asarPath}`);
  console.error(`用法: node repack-asar.js [releaseDir] [platform]`);
  console.error(`示例: node repack-asar.js release-final win-unpacked`);
  process.exit(1);
}

console.log('Extracting app.asar...');
asar.extractAll(asarPath, tempDir);

console.log('Copying updated main.cjs...');
const destMainPath = path.join(tempDir, 'electron', 'main.cjs');
fs.copyFileSync(path.join(sourceElectronDir, 'main.cjs'), destMainPath);

console.log('Repacking app.asar...');
asar.createPackage(tempDir, asarPath);

console.log('Cleaning up...');
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('Done!');
