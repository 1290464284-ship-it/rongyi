import {
  getMigrationDb,
  logger,
} from './helpers';

export const migrateToV49 = () => {
  const db = getMigrationDb();
  const migrateTx = db.transaction(() => {
    // CephalometricLandmarkSet: 补 name / method / status / createdBy 列
    const lmCols = db.prepare(`PRAGMA table_info(CephalometricLandmarkSet)`).all() as { name: string }[];
    const lmColNames = new Set(lmCols.map(c => c.name));
    if (lmColNames.has('id') && !lmColNames.has('name')) {
      db.exec(`ALTER TABLE CephalometricLandmarkSet ADD COLUMN name TEXT DEFAULT '初始'`);
    }
    if (lmColNames.has('id') && !lmColNames.has('method')) {
      db.exec(`ALTER TABLE CephalometricLandmarkSet ADD COLUMN method TEXT DEFAULT 'STEINER'`);
    }
    if (lmColNames.has('id') && !lmColNames.has('status')) {
      db.exec(`ALTER TABLE CephalometricLandmarkSet ADD COLUMN status TEXT DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED'))`);
    }
    if (lmColNames.has('id') && !lmColNames.has('createdBy')) {
      db.exec(`ALTER TABLE CephalometricLandmarkSet ADD COLUMN createdBy TEXT`);
    }

    // CephalometricAnalysisRecord: 补 patientId 列（用于按患者列表）
    const arCols = db.prepare(`PRAGMA table_info(CephalometricAnalysisRecord)`).all() as { name: string }[];
    const arColNames = new Set(arCols.map(c => c.name));
    if (arColNames.has('id') && !arColNames.has('patientId')) {
      db.exec(`ALTER TABLE CephalometricAnalysisRecord ADD COLUMN patientId TEXT`);
    }

    // CephalometricNormValue: 补 adultChildFlag 列（用于区分成人/儿童）
    const nvCols = db.prepare(`PRAGMA table_info(CephalometricNormValue)`).all() as { name: string }[];
    const nvColNames = new Set(nvCols.map(c => c.name));
    if (nvColNames.has('id') && !nvColNames.has('adultChildFlag')) {
      db.exec(`ALTER TABLE CephalometricNormValue ADD COLUMN adultChildFlag TEXT DEFAULT 'ADULT' CHECK(adultChildFlag IN ('ADULT','CHILD'))`);
    }
  });
  migrateTx();
  logger.log('v49: CephalometricLandmarkSet/AnalysisRecord/NormValue 补列');
};
