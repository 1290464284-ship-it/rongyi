import type { Migration } from './index';

export const migrations148: Migration[] = [
  {
    version: 148,
    name: 'v2-analytics-query-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_charge_patient_paid ON Charge(patientId, paidAt, deletedAt);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_clinic_patient_paid ON Charge(clinicId, patientId, paidAt);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_item_clinic_category ON ChargeItem(clinicId, category, name);
        CREATE INDEX IF NOT EXISTS idx_v2_visit_patient_created ON Visit(patientId, createdAt);
      `);
    },
  },
];
