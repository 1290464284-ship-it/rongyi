import { getMigrationDb, createIndexIfNotExists, logger } from './helpers';

export const migrateToV31 = () => {
  const db = getMigrationDb();
  const migrateTx = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS CephalometricLandmarkSet (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      patientId TEXT NOT NULL,
      imageId TEXT,
      landmarkJson TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      UNIQUE(clinicId, patientId, imageId),
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (imageId) REFERENCES Imaging(id)
    )`);
    createIndexIfNotExists('idx_cephalolandmarkset_clinic_deleted', 'CephalometricLandmarkSet', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_cephalolandmarkset_patient', 'CephalometricLandmarkSet', 'patientId');

    db.exec(`CREATE TABLE IF NOT EXISTS CephalometricAnalysisRecord (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      landmarkSetId TEXT NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('TWEED','MCNAMARA','STEINER','DOWNS')),
      metricsJson TEXT NOT NULL,
      analysisDate TEXT NOT NULL,
      doctorId TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      UNIQUE(clinicId, landmarkSetId, method),
      FOREIGN KEY (landmarkSetId) REFERENCES CephalometricLandmarkSet(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_cephalorecord_clinic_deleted', 'CephalometricAnalysisRecord', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_cephalorecord_landmarkset', 'CephalometricAnalysisRecord', 'landmarkSetId');
    createIndexIfNotExists('idx_cephalorecord_doctor', 'CephalometricAnalysisRecord', 'doctorId');

    db.exec(`CREATE TABLE IF NOT EXISTS CephalometricNormValue (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      method TEXT NOT NULL,
      metricName TEXT NOT NULL,
      race TEXT DEFAULT 'CHINESE',
      gender TEXT CHECK(gender IN ('MALE','FEMALE','BOTH')) DEFAULT 'BOTH',
      ageMin INTEGER,
      ageMax INTEGER,
      mean REAL NOT NULL,
      stdDev REAL NOT NULL,
      unit TEXT,
      source TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    )`);
    createIndexIfNotExists('idx_cephalonorm_clinic_deleted', 'CephalometricNormValue', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_cephalonorm_method_metric', 'CephalometricNormValue', 'method, metricName');
    createIndexIfNotExists('idx_cephalonorm_race_gender_age', 'CephalometricNormValue', 'race, gender, ageMin, ageMax');

    db.exec(`CREATE TABLE IF NOT EXISTS DrugContraindication (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      drugAId TEXT,
      drugBId TEXT,
      drugCategoryA TEXT,
      drugCategoryB TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','DANGER')) DEFAULT 'WARN',
      reason TEXT NOT NULL,
      pregnancyFlag INTEGER DEFAULT 0,
      lactationFlag INTEGER DEFAULT 0,
      renalFlag INTEGER DEFAULT 0,
      hepaticFlag INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (drugAId) REFERENCES DrugCatalog(id),
      FOREIGN KEY (drugBId) REFERENCES DrugCatalog(id)
    )`);
    createIndexIfNotExists('idx_drugcontra_clinic_deleted', 'DrugContraindication', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_drugcontra_drugA', 'DrugContraindication', 'drugAId');
    createIndexIfNotExists('idx_drugcontra_drugB', 'DrugContraindication', 'drugBId');
    createIndexIfNotExists('idx_drugcontra_categoryA', 'DrugContraindication', 'drugCategoryA');
    createIndexIfNotExists('idx_drugcontra_categoryB', 'DrugContraindication', 'drugCategoryB');

    db.exec(`CREATE TABLE IF NOT EXISTS PatientRiskScore (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      patientId TEXT NOT NULL,
      cariesScore INTEGER NOT NULL,
      periodontalScore INTEGER NOT NULL,
      implantScore INTEGER NOT NULL,
      cariesLevel TEXT CHECK(cariesLevel IN ('LOW','MEDIUM','HIGH','EXTREME')),
      periodontalLevel TEXT CHECK(periodontalLevel IN ('LOW','MEDIUM','HIGH','EXTREME')),
      implantLevel TEXT CHECK(implantLevel IN ('LOW','MEDIUM','HIGH','EXTREME')),
      factorSnapshotJson TEXT NOT NULL,
      assessedById TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (assessedById) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_patientrisk_clinic_deleted', 'PatientRiskScore', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_patientrisk_patient', 'PatientRiskScore', 'patientId, createdAt DESC');
    createIndexIfNotExists('idx_patientrisk_assessed', 'PatientRiskScore', 'assessedById');

    db.exec(`CREATE TABLE IF NOT EXISTS BusinessAlert (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      alertType TEXT NOT NULL CHECK(alertType IN ('REVENUE_DROP','NEW_PATIENTS','NO_SHOW_RATE','AOV','INVENTORY_STOCKOUT','SCHEDULER_TASK_FAILURE','PERFORMANCE_ANOMALY')),
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','CRITICAL')) DEFAULT 'WARN',
      metricName TEXT NOT NULL,
      currentValue REAL,
      baselineValue REAL,
      deviationPercent REAL,
      message TEXT NOT NULL,
      suggestion TEXT,
      acknowledged INTEGER DEFAULT 0 CHECK(acknowledged IN (0,1)),
      acknowledgedAt TEXT,
      acknowledgedBy TEXT,
      occurredAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (acknowledgedBy) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_bizalert_clinic_deleted', 'BusinessAlert', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_bizalert_type_severity', 'BusinessAlert', 'alertType, severity, occurredAt DESC');
    createIndexIfNotExists('idx_bizalert_acknowledged', 'BusinessAlert', 'acknowledged, occurredAt DESC');

    db.exec(`CREATE TABLE IF NOT EXISTS InventoryReplenishmentSuggestion (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      inventoryId TEXT NOT NULL,
      avgDailyConsumption REAL,
      leadTimeDays INTEGER DEFAULT 7,
      safetyFactor REAL DEFAULT 1.5,
      rop REAL NOT NULL,
      suggestedQty INTEGER NOT NULL,
      calculationSnapshotJson TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (inventoryId) REFERENCES InventoryItem(id)
    )`);
    createIndexIfNotExists('idx_invreplenish_clinic_deleted', 'InventoryReplenishmentSuggestion', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_invreplenish_inventory', 'InventoryReplenishmentSuggestion', 'inventoryId, createdAt DESC');

    db.exec(`CREATE TABLE IF NOT EXISTS SatisfactionSurvey (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      visitId TEXT NOT NULL UNIQUE,
      patientId TEXT NOT NULL,
      npsScore INTEGER CHECK(npsScore BETWEEN 0 AND 10),
      overallStars INTEGER CHECK(overallStars BETWEEN 1 AND 5),
      techStars INTEGER CHECK(techStars BETWEEN 1 AND 5),
      serviceStars INTEGER CHECK(serviceStars BETWEEN 1 AND 5),
      envStars INTEGER CHECK(envStars BETWEEN 1 AND 5),
      comment TEXT,
      tags TEXT DEFAULT '[]',
      doctorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_satisfaction_clinic_deleted', 'SatisfactionSurvey', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_satisfaction_patient', 'SatisfactionSurvey', 'patientId, createdAt DESC');
    createIndexIfNotExists('idx_satisfaction_doctor', 'SatisfactionSurvey', 'doctorId, createdAt DESC');

    db.exec(`CREATE TABLE IF NOT EXISTS StaffSchedule (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      staffId TEXT NOT NULL,
      scheduleDate TEXT NOT NULL,
      shiftId TEXT,
      startTime TEXT,
      endTime TEXT,
      station TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      UNIQUE(clinicId, staffId, scheduleDate, shiftId),
      FOREIGN KEY (staffId) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_staffsched_clinic_deleted', 'StaffSchedule', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_staffsched_staff_date', 'StaffSchedule', 'staffId, scheduleDate');
    createIndexIfNotExists('idx_staffsched_scheduledate', 'StaffSchedule', 'scheduleDate');

    db.exec(`CREATE TABLE IF NOT EXISTS StaffLeaveRequest (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      staffId TEXT NOT NULL,
      leaveType TEXT NOT NULL CHECK(leaveType IN ('ANNUAL','SICK','PERSONAL','MATERNITY','PATERNITY','OTHER')),
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      daysCount REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SAVED','PENDING','APPROVED','REJECTED','CANCELLED')) DEFAULT 'SAVED',
      approverId TEXT,
      approvedAt TEXT,
      rejectReason TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (staffId) REFERENCES User(id),
      FOREIGN KEY (approverId) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_staffleave_clinic_deleted', 'StaffLeaveRequest', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_staffleave_staff_status', 'StaffLeaveRequest', 'staffId, status, startDate');
    createIndexIfNotExists('idx_staffleave_approver', 'StaffLeaveRequest', 'approverId, status');

    db.exec(`CREATE TABLE IF NOT EXISTS DataImportJob (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      importType TEXT NOT NULL CHECK(importType IN ('PATIENT','DRUG_CATALOG','INVENTORY')),
      fileName TEXT NOT NULL,
      totalRows INTEGER DEFAULT 0,
      successRows INTEGER DEFAULT 0,
      failedRows INTEGER DEFAULT 0,
      errorReportPath TEXT,
      status TEXT NOT NULL CHECK(status IN ('UPLOADED','VALIDATING','VALIDATED','IMPORTING','COMPLETED','FAILED')) DEFAULT 'UPLOADED',
      startedById TEXT,
      completedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (startedById) REFERENCES User(id)
    )`);
    createIndexIfNotExists('idx_dataimport_clinic_deleted', 'DataImportJob', 'clinicId, deletedAt');
    createIndexIfNotExists('idx_dataimport_type_status', 'DataImportJob', 'importType, status, createdAt DESC');
    createIndexIfNotExists('idx_dataimport_startedby', 'DataImportJob', 'startedById, createdAt DESC');
  });

  migrateTx();
  logger.log('v31: 已创建 12 张艾登特新表');
};
