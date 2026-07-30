import { createIndexIfNotExists, tableExists, logger } from './helpers';

export const migrateToV29 = () => {
  // 为关键业务表补充 (clinicId, deletedAt, ...) 复合索引，
  // 优化软删除过滤（WHERE clinicId = ? AND deletedAt IS NULL）的查询性能。
  // 现有索引（v19-v26）未涵盖 deletedAt 列，导致该最常见查询模式无法利用索引。

  if (tableExists('Patient')) {
    createIndexIfNotExists(
      'idx_patient_clinic_deleted_created',
      'Patient',
      'clinicId, deletedAt, createdAt DESC',
    );
  }

  if (tableExists('Appointment')) {
    createIndexIfNotExists(
      'idx_appointment_clinic_deleted_start',
      'Appointment',
      'clinicId, deletedAt, startTime DESC',
    );
  }

  if (tableExists('Charge')) {
    createIndexIfNotExists(
      'idx_charge_clinic_deleted_created',
      'Charge',
      'clinicId, deletedAt, createdAt DESC',
    );
  }

  if (tableExists('Treatment')) {
    createIndexIfNotExists(
      'idx_treatment_clinic_deleted_created',
      'Treatment',
      'clinicId, deletedAt, createdAt DESC',
    );
  }

  if (tableExists('MedicalRecord')) {
    createIndexIfNotExists(
      'idx_medical_record_clinic_deleted_created',
      'MedicalRecord',
      'clinicId, deletedAt, createdAt DESC',
    );
  }

  logger.log('v29 迁移完成：关键业务表软删除查询优化复合索引');
};
