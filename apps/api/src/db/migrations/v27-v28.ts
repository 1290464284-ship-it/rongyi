import { addColumnIfMissing, logger } from './helpers';

export const migrateToV28 = () => {
  // 补齐 schema.ts 索引定义引用但表定义中缺失的 deletedAt 列，
  // 与项目软删除规范（所有表必须含 deletedAt）对齐。
  // - TreatmentCatalog: idx_treatment_catalog_clinic_deleted_code 引用了 deletedAt
  // - MedicalRecordTemplate: idx_medical_record_template_clinic_deleted 引用了 deletedAt
  addColumnIfMissing('TreatmentCatalog', 'deletedAt', 'TEXT');
  addColumnIfMissing('MedicalRecordTemplate', 'deletedAt', 'TEXT');

  logger.log('v28 迁移完成：TreatmentCatalog / MedicalRecordTemplate 补齐 deletedAt 列');
};
