import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV47 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('WorkSchedule')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS WorkSchedule (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          shiftType TEXT NOT NULL CHECK (shiftType IN ('MORNING','AFTERNOON','FULL','CUSTOM','LEAVE','OFF')),
          startAt TEXT NOT NULL,
          endAt TEXT NOT NULL,
          note TEXT,
          repeatRule TEXT DEFAULT NULL,
          color TEXT DEFAULT '#4F46E5',
          clinicId TEXT NOT NULL,
          createdBy TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY(userId) REFERENCES User(id)
        )
      `);
    }

    if (!tableExists('LeaveRequest')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS LeaveRequest (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          leaveType TEXT NOT NULL CHECK (leaveType IN ('ANNUAL','SICK','PERSONAL','MARRIAGE','MATERNITY','PATERNITY','BEREAVEMENT','OTHER')),
          startAt TEXT NOT NULL,
          endAt TEXT NOT NULL,
          totalDays REAL NOT NULL DEFAULT 1,
          reason TEXT,
          status TEXT NOT NULL CHECK (status IN ('SAVED','PENDING','APPROVED','REJECTED','CANCELLED')),
          submittedAt TEXT,
          approverId TEXT,
          approvedAt TEXT,
          rejectReason TEXT,
          clinicId TEXT NOT NULL,
          createdBy TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY(userId) REFERENCES User(id),
          FOREIGN KEY(approverId) REFERENCES User(id)
        )
      `);
    }

    createIndexIfNotExists(
      'IDX_WorkSchedule_user_start',
      'WorkSchedule',
      'userId, startAt, endAt',
    );
    createIndexIfNotExists(
      'IDX_WorkSchedule_clinic_start',
      'WorkSchedule',
      'clinicId, startAt',
    );
    createIndexIfNotExists(
      'IDX_LeaveRequest_user',
      'LeaveRequest',
      'userId, status',
    );
    createIndexIfNotExists(
      'IDX_LeaveRequest_clinic_status',
      'LeaveRequest',
      'clinicId, status, createdAt DESC',
    );
  });
  migrateTx();
  logger.log('v47: WorkSchedule + LeaveRequest 表 + 4 索引');
};
