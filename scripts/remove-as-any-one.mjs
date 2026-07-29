/**
 * Remove `(varName as any).prop` → `varName.prop` from a specific test file.
 * Then check if TS compiles.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apps/api/src/modules/clinical/first-exams/first-exams.service.spec.ts';
const vars = ['result', 'created', 'updated', 'found', 'item', 'data', 'record', 'lastItem', 'tooth', 'tooth11', 'tooth16', 'tooth21', 'tooth26', 'tooth31', 'tooth36', 'tooth41', 'tooth46', 'before', 'after', 'deleted', 'track', 'tracks', 'teeth', 'followUp', 'exam', 'stats'];

let content = readFileSync(file, 'utf8');
let totalReplacements = 0;

for (const v of vars) {
  const pattern = new RegExp(`\\(${v} as any\\)\\.`, 'g');
  const matches = content.match(pattern);
  if (matches) {
    totalReplacements += matches.length;
    content = content.replace(pattern, `${v}.`);
    console.log(`  ${v}: ${matches.length} replacements`);
  }
}

writeFileSync(file, content, 'utf8');
console.log(`\nTotal: ${totalReplacements} replacements in ${file}`);
