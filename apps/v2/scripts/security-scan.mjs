import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceDirs = ['src', 'electron', 'scripts'];
const forbidden = [
  { pattern: /\beval\s*\(/, message: 'eval() usage is forbidden' },
  { pattern: /\binnerHTML\s*=/, message: 'unsafe innerHTML assignment is forbidden' },
  { pattern: /\bdocument\.write\s*\(/, message: 'document.write is forbidden' },
  { pattern: /\bnew\s+Function\s*\(/, message: 'dynamic function construction is forbidden' },
  { pattern: /\b(?:webContents\.)?executeJavaScript\s*\(/, message: 'executeJavaScript is forbidden outside the allowlisted error window' },
  { pattern: /child_process\.exec\(/, message: 'child_process.exec is forbidden' },
  { pattern: /shell:\s*true/, message: 'shell:true is forbidden' },
  { pattern: /req\.body\s*\.\s*(password|role|balance|stock|paidAmount|refundedAmount)/, message: 'sensitive fields must not be read directly from request bodies' },
  { pattern: /Invoke-Expression\b/, message: 'Invoke-Expression is forbidden' },
  { pattern: /-EncodedCommand\b/, message: 'encoded PowerShell commands are forbidden' },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return /\.(ts|tsx|cjs|js|mjs|ps1)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceDirs.flatMap((dir) => walk(path.join(root, dir)));
const issues = [];
for (const file of files) {
  if (path.basename(file) === 'security-scan.mjs') continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    const allowlistedExecuteJavaScript =
      rule.message.includes('executeJavaScript') &&
      content.includes('ALLOWED-SCAN: error window payload');
    if (rule.pattern.test(content) && !allowlistedExecuteJavaScript) {
      issues.push(`${path.relative(root, file)}: ${rule.message}`);
    }
  }
}

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`security scan passed (${files.length} files)`);
