const fs = require('fs');
const path = require('path');

const base = 'd:/Desktop/rongyi/source/apps/api';
const srcDir = path.join(base, 'src');

function walkDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walkDir(srcDir);
let totalFixes = 0;

for (const file of allFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  // Fix: `field?: T | null` -> `field?: T`
  // The sonarjs/no-redundant-optional rule considers | null redundant with ?:
  content = content.replace(/(\?\s*:\s*[^;\n{}]+?)\s*\|\s*null(\s*[;\n,}])/g, '$1$2');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    const relPath = path.relative(base, file);
    console.log(`Fixed: ${relPath}`);
    totalFixes++;
  }
}

console.log(`\nTotal files fixed: ${totalFixes}`);
