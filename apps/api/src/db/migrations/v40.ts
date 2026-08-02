import {
  getMigrationDb,
  createIndexIfNotExists,
  addColumnIfMissing,
  logger,
  tableExists,
} from './helpers';

export const migrateToV40 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (tableExists('FollowUpTemplate')) {
      addColumnIfMissing('FollowUpTemplate', 'triggerTreatmentCodes', "TEXT DEFAULT '[]'");
      addColumnIfMissing('FollowUpTemplate', 'triggerTreatmentCategories', "TEXT DEFAULT '[]'");
      addColumnIfMissing('FollowUpTemplate', 'minIntervalDays', 'INTEGER DEFAULT 7');
      addColumnIfMissing('FollowUpTemplate', 'recommendedIntervalDays', 'INTEGER DEFAULT 30');
      addColumnIfMissing('FollowUpTemplate', 'maxIntervalDays', 'INTEGER DEFAULT 180');
      addColumnIfMissing('FollowUpTemplate', 'riskMultiplierLow', 'REAL DEFAULT 1.0');
      addColumnIfMissing('FollowUpTemplate', 'riskMultiplierMedium', 'REAL DEFAULT 1.0');
      addColumnIfMissing('FollowUpTemplate', 'riskMultiplierHigh', 'REAL DEFAULT 0.75');
      addColumnIfMissing('FollowUpTemplate', 'riskMultiplierExtreme', 'REAL DEFAULT 0.5');
      addColumnIfMissing('FollowUpTemplate', 'requiresAdherenceCheck', 'INTEGER DEFAULT 0 CHECK (requiresAdherenceCheck IN (0,1))');

      createIndexIfNotExists(
        'IDX_FollowUpTemplate_trigger_codes',
        'FollowUpTemplate',
        'clinicId, triggerTreatmentCodes',
      );
    }

    if (!tableExists('FollowUpAssignment')) {
      db.exec(`
        CREATE TABLE FollowUpAssignment (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          followUpId TEXT,
          templateId TEXT,
          recommendedDate TEXT,
          actualDate TEXT,
          reason TEXT,
          confidence REAL DEFAULT 0,
          createdBy TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (followUpId) REFERENCES FollowUp(id),
          FOREIGN KEY (templateId) REFERENCES FollowUpTemplate(id),
          FOREIGN KEY (createdBy) REFERENCES User(id)
        )
      `);
    } else {
      addColumnIfMissing('FollowUpAssignment', 'patientId', 'TEXT NOT NULL DEFAULT ""');
      addColumnIfMissing('FollowUpAssignment', 'followUpId', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'templateId', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'recommendedDate', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'actualDate', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'reason', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'confidence', 'REAL DEFAULT 0');
      addColumnIfMissing('FollowUpAssignment', 'createdBy', 'TEXT');
      addColumnIfMissing('FollowUpAssignment', 'clinicId', 'TEXT NOT NULL DEFAULT ""');
      addColumnIfMissing('FollowUpAssignment', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      addColumnIfMissing('FollowUpAssignment', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      addColumnIfMissing('FollowUpAssignment', 'deletedAt', 'TEXT');
    }

    createIndexIfNotExists(
      'IDX_FollowUpAssignment_patient_status',
      'FollowUpAssignment',
      'patientId, recommendedDate',
    );
  });
  migrateTx();
  logger.log('v40: FollowUpTemplate 新增 trigger/interval/risk 列，FollowUpAssignment 表创建（若不存在），2 个复合索引已建立');
};
