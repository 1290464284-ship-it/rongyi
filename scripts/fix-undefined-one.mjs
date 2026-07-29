/**
 * Fix 'possibly undefined' errors by adding non-null assertions.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apps/api/src/modules/clinical/first-exams/first-exams.service.spec.ts';
const errorLines = [135, 143, 152, 161, 171, 180, 248, 256, 829, 830, 988, 997, 1006, 1015, 1024, 1033, 1044, 1045, 1046, 1053];

const lines = readFileSync(file, 'utf8').split('\n');

for (const lineNum of errorLines) {
  const idx = lineNum - 1;
  const line = lines[idx];
  // Replace `result.` with `result!.` but not `result!.`
  lines[idx] = line.replace(/\bresult\.(?!\!)/, 'result!.');
}

writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`Fixed ${errorLines.length} lines`);
