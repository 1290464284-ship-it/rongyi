// 开发/生产种子数据（M-04：由 database.ts 拆分）
import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Logger } from './logger';
import { secretFileValue } from './secret-file';

export function seedDatabase(db: Database.Database, logger?: Logger): void {
  const warn = (message: string, meta?: Record<string, unknown>): void => {
    if (logger) logger.warn(message, meta);
    else console.warn(`[seed] ${message}`);
  };
  const now = new Date().toISOString();
  const isProduction = process.env.NODE_ENV === 'production';
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  // Test runs must stay deterministic even when CI injects V2_ADMIN_PASSWORD
  // for smoke scripts; production/dev read the env or generate a temp password.
  const seedPassword = nodeEnv === 'test'
    ? 'v2-test-seed-password'
    : process.env.V2_ADMIN_PASSWORD ?? secretFileValue('adminPassword') ?? randomBytes(18).toString('base64url');
  const clinicRow = db.prepare('SELECT id FROM Clinic LIMIT 1').get() as { id: string } | undefined;
  const clinicId = clinicRow ? String(clinicRow.id) : 'clinic-v2-001';
  if (!clinicRow) {
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2', 'Refactored Clinic', 1)`,
    ).run(clinicId, now, now);
  }

  const adminRow = db.prepare("SELECT id, passwordHash FROM User WHERE username = 'admin'").get() as
    | { id: string; passwordHash: string }
    | undefined;
  const userId = adminRow?.id ?? 'user-admin-001';
  if (!adminRow) {
    if (isProduction) {
      // Production bootstrap: an operator-provided V2_ADMIN_PASSWORD creates
      // the first admin. Without it the app starts normally and the renderer's
      // first-run setup wizard creates the initial admin, so no default
      // credentials are ever shipped.
      const bootstrapPassword = process.env.V2_ADMIN_PASSWORD ?? secretFileValue('adminPassword');
      if (bootstrapPassword) {
        if (bootstrapPassword.length < 6) {
          throw new Error('V2_ADMIN_PASSWORD must be at least 6 characters');
        }
        const passwordHash = bcrypt.hashSync(bootstrapPassword, 10);
        const created = db.prepare(
          `INSERT OR IGNORE INTO User (
             id, clinicId, createdAt, updatedAt, deletedAt,
             username, passwordHash, name, role, active, loginAttempts, tokenVersion
           ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
        ).run(userId, clinicId, now, now, passwordHash);
        if (created.changes > 0) {
          warn('[seed] production admin bootstrap: admin created from V2_ADMIN_PASSWORD; change the password after first login');
        }
      } else {
        warn('[seed] production first run: no admin user yet; use the setup wizard to create the initial admin');
      }
    } else {
      const passwordHash = bcrypt.hashSync(seedPassword, 10);
      const created = db.prepare(
        `INSERT OR IGNORE INTO User (
           id, clinicId, createdAt, updatedAt, deletedAt,
           username, passwordHash, name, role, active, loginAttempts, tokenVersion
         ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
      ).run(userId, clinicId, now, now, passwordHash);
      if (created.changes > 0 && !process.env.V2_ADMIN_PASSWORD && nodeEnv !== 'test') {
        warn('[seed] V2_ADMIN_PASSWORD not set; admin created with a temporary password. Set V2_ADMIN_PASSWORD before first launch to control it.');
        // 仅开发模式在控制台给出可登录密码；不写入日志文件，生产路径也不会触发。
        if (nodeEnv === 'development') {
          console.warn(`[seed] development admin temporary password: ${seedPassword}`);
        }
      }
    }
  }
  // 非生产且未显式配置 V2_ADMIN_PASSWORD 时，提醒默认管理员口令已生效；
  // 测试环境静默，避免测试输出噪音。
  if (!isProduction && !process.env.V2_ADMIN_PASSWORD && process.env.NODE_ENV !== 'test') {
    warn('[seed] V2_ADMIN_PASSWORD not set: admin uses a temporary generated password. Set V2_ADMIN_PASSWORD before first launch to make it stable.');
  }

  const doctorRow = db.prepare("SELECT id FROM User WHERE username = 'doctor'").get() as { id: string } | undefined;
  if (!doctorRow && !isProduction) {
    const doctorHash = bcrypt.hashSync('REDACTED', 10);
    db.prepare(
      `INSERT OR IGNORE INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'doctor', ?, 'Default Doctor', 'DOCTOR', 1, 0, 0)`,
    ).run('user-seed-doctor-001', clinicId, now, now, doctorHash);
  }

  if (!isProduction) {
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, contactNote, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P001', 'Demo Patient', 'UNKNOWN', '13800000000',
         'demo-wechat-id', 'WECHAT', NULL,
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-demo-001', clinicId, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-demo-001', clinicId, now, now, userId, now, new Date(Date.now() + 3_600_000).toISOString());

    db.prepare(
      `INSERT OR IGNORE INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'MAT-001', 'Dental Material', 'CONSUMABLE', 'box', 100, 20, 5000)`,
    ).run('inventory-demo-001', clinicId, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Post-treatment review', 'PENDING')`,
    ).run('followup-demo-001', clinicId, now, now, new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  }
}
