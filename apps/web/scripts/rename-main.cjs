const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '../electron/main.js');
const cjsPath = path.join(__dirname, '../electron/main.cjs');

if (fs.existsSync(cjsPath)) {
  fs.unlinkSync(cjsPath);
}
fs.renameSync(jsPath, cjsPath);
console.log('Renamed main.js to main.cjs');
