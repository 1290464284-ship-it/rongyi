/**
 * Remove `(varName as any).prop` from multiple test files and fix possibly undefined.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'apps/api/src/modules/clinical/treatments/treatments.service.spec.ts',
  'apps/api/src/modules/clinical/medical-records/medical-records.service.spec.ts',
  'apps/api/src/modules/patients/patients.service.spec.ts',
];

const vars = ['result', 'created', 'updated', 'found', 'item', 'data', 'record', 'patient', 'savedPatient', 'deleted', 'beforeDelete', 'afterDelete'];

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let fileTotal = 0;
  
  for (const v of vars) {
    const pattern = new RegExp(`\\(${v} as any\\)\\.`, 'g');
    const matches = content.match(pattern);
    if (matches) {
      fileTotal += matches.length;
      content = content.replace(pattern, `${v}.`);
    }
  }
  
  if (fileTotal > 0) {
    writeFileSync(file, content, 'utf8');
    console.log(`${file.split('/').pop()}: ${fileTotal} replacements`);
  }
}
console.log('\nDone!');
