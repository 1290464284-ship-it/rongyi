const fs = require('fs');
const path = require('path');

const base = 'd:/Desktop/rongyi/source/apps/api';

// Files that need || null → || undefined
const files = [
  'src/common/services/base.service.ts',
  'src/modules/financial/member-cards/member-cards.service.ts',
  'src/modules/financial/refunds/refunds.service.ts',
  'src/modules/inventory/inventory/inventory.service.ts',
  'src/modules/patients/patients.service.ts',
];

for (const relPath of files) {
  const fullPath = path.join(base, relPath);
  let content = fs.readFileSync(fullPath, 'utf8');
  
  // Replace `|| null` with `|| undefined`
  content = content.replace(/\|\|\s*null/g, '|| undefined');
  
  // Replace `?? null` with `?? undefined`
  content = content.replace(/\?\?\s*null/g, '?? undefined');
  
  // Replace `getClinicId()` return used as string|null → add ?? undefined
  // base.service.ts line 255: clinicId: this.clinicContext.getClinicId()
  content = content.replace(
    /clinicId:\s*this\.clinicContext\.getClinicId\(\)(?!\s*\?)/g,
    'clinicId: this.clinicContext.getClinicId() ?? undefined'
  );
  
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Fixed: ${relPath}`);
}
