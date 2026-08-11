import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const schemaDir = path.join(appRoot, 'legacy', 'schema');

function extractCreateTableStatements(text) {
  const statements = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('CREATE TABLE IF NOT EXISTS', cursor);
    if (start === -1) break;
    const parenStart = text.indexOf('(', start);
    if (parenStart === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = parenStart; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    statements.push(text.slice(start, end + 1));
    cursor = end + 1;
  }
  return statements;
}

const files = fs.readdirSync(schemaDir)
  .filter((name) => name.endsWith('.tables.ts'))
  .sort();
const statements = [];
for (const file of files) {
  statements.push(...extractCreateTableStatements(fs.readFileSync(path.join(schemaDir, file), 'utf8')));
}
if (statements.length === 0) {
  throw new Error(`No CREATE TABLE statements found under ${schemaDir}`);
}
const output = `${statements.join(';\n')};\n`;
fs.writeFileSync(path.join(schemaDir, 'legacy-schema.generated.sql'), output, 'utf8');
console.log(`generated legacy-schema.generated.sql (${statements.length} statements from ${files.length} files)`);
