import type { Migration } from './index';
import { addColumns } from './helpers';

export const migrations147: Migration[] = [
  {
    version: 147,
    name: 'v2-patient-contact-fields',
    up(db) {
      addColumns(db, 'Patient', [
        ['wechatId', 'TEXT'],
        ['preferredContact', "TEXT NOT NULL DEFAULT 'PHONE'"],
        ['contactNote', 'TEXT'],
      ]);
      db.exec('CREATE INDEX IF NOT EXISTS idx_v2_patient_wechat ON Patient(clinicId, wechatId)');
    },
  },
];
