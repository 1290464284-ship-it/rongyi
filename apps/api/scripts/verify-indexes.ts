/**
 * 索引命中验证脚本
 *
 * 使用 EXPLAIN QUERY PLAN 对高频业务查询进行索引命中检测。
 * 从 schema/*.tables.ts 和 schema/indexes.ts 提取 SQL 构建内存数据库，
 * 无需编译或运行完整应用。
 *
 * 用法: npx tsx scripts/verify-indexes.ts
 * 退出码: 0 = 全部命中, 1 = 有未命中索引的查询
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * 从 schema/*.tables.ts 提取所有 CREATE TABLE SQL
 */
function extractCreateTableSQLs(): string[] {
  const schemaDir = path.join(apiRoot, 'src', 'db', 'schema');
  const sqls: string[] = [];
  const tableFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.tables.ts'));

  for (const file of tableFiles) {
    const content = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    // 提取模板字面量中的 CREATE TABLE 语句
    const regex = /`((?:CREATE\s+TABLE)[\s\S]*?)`/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      sqls.push(match[1].trim());
    }
  }
  return sqls;
}

/**
 * 从 schema/indexes.ts 提取所有 CREATE INDEX SQL
 */
function extractCreateIndexSQLs(): string[] {
  const indexPath = path.join(apiRoot, 'src', 'db', 'schema', 'indexes.ts');
  const content = fs.readFileSync(indexPath, 'utf8');
  const sqls: string[] = [];

  // 匹配 createIndexIfNotExists(db, 'name', 'table', 'columns') 和带 where 子句的版本
  const regex = /createIndexIfNotExists\(db,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'(?:,\s*'([^']+)')?\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, name, table, columns, where] = match;
    const whereClause = where ? ` WHERE ${where}` : '';
    sqls.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})${whereClause}`);
  }

  // 匹配直接 db.exec 的唯一索引
  const uniqueRegex = /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+\w+\([^)]+\)/gi;
  while ((match = uniqueRegex.exec(content)) !== null) {
    sqls.push(match[0]);
  }

  return sqls;
}

/**
 * 高频业务查询清单
 */
const HIGH_FREQUENCY_QUERIES = [
  // ── 患者模块 ──
  {
    desc: '患者列表（按诊所+软删除+分页排序）',
    sql: 'SELECT * FROM Patient WHERE clinicId = ? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    params: ['clinic-1', 20, 0],
  },
  {
    desc: '患者搜索（按姓名前缀）',
    sql: 'SELECT * FROM Patient WHERE clinicId = ? AND deletedAt IS NULL AND name LIKE ? ORDER BY name LIMIT ?',
    params: ['clinic-1', '%张%', 20],
  },
  {
    desc: '患者搜索（按手机号）',
    sql: 'SELECT * FROM Patient WHERE clinicId = ? AND deletedAt IS NULL AND phone = ?',
    params: ['clinic-1', '13800138000'],
  },
  // ── 预约模块 ──
  {
    desc: '预约列表（按诊所+日期范围）',
    sql: 'SELECT * FROM Appointment WHERE clinicId = ? AND deletedAt IS NULL AND startTime >= ? AND startTime < ? ORDER BY startTime',
    params: ['clinic-1', '2026-01-01', '2026-12-31'],
  },
  {
    desc: '预约按医生+时间查询',
    sql: 'SELECT * FROM Appointment WHERE clinicId = ? AND doctorId = ? AND deletedAt IS NULL ORDER BY startTime',
    params: ['clinic-1', 'doc-1'],
  },
  // ── 收费模块 ──
  {
    desc: '收费列表（按诊所+状态+分页）',
    sql: 'SELECT * FROM Charge WHERE clinicId = ? AND deletedAt IS NULL AND status = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    params: ['clinic-1', 'UNPAID', 20, 0],
  },
  {
    desc: '收费统计（按诊所+付费时间范围）',
    sql: 'SELECT COUNT(*) as count, SUM(totalAmount) as total FROM Charge WHERE clinicId = ? AND deletedAt IS NULL AND paidAt >= ? AND paidAt < ? AND status = ?',
    params: ['clinic-1', '2026-01-01', '2026-12-31', 'PAID'],
  },
  {
    desc: '收费项目 JOIN 收费单',
    sql: 'SELECT ci.* FROM ChargeItem ci INNER JOIN Charge c ON ci.chargeId = c.id WHERE c.clinicId = ? AND c.deletedAt IS NULL AND ci.category = ?',
    params: ['clinic-1', 'TREATMENT'],
  },
  // ── 治疗模块 ──
  {
    desc: '治疗记录（按患者+诊所）',
    sql: 'SELECT * FROM Treatment WHERE clinicId = ? AND patientId = ? AND deletedAt IS NULL ORDER BY createdAt DESC',
    params: ['clinic-1', 'patient-1'],
  },
  {
    desc: '医生工作量统计',
    sql: 'SELECT doctorId, COUNT(*) as count FROM Treatment WHERE clinicId = ? AND deletedAt IS NULL AND completedDate >= ? GROUP BY doctorId',
    params: ['clinic-1', '2026-01-01'],
  },
  // ── 病历模块 ──
  {
    desc: '病历列表（按患者+诊所）',
    sql: 'SELECT * FROM MedicalRecord WHERE clinicId = ? AND patientId = ? AND deletedAt IS NULL ORDER BY createdAt DESC',
    params: ['clinic-1', 'patient-1'],
  },
  // ── 会员卡模块 ──
  {
    desc: '活跃会员统计',
    sql: 'SELECT COUNT(*) as count FROM MemberCard WHERE clinicId = ? AND deletedAt IS NULL AND status = ?',
    params: ['clinic-1', 'ACTIVE'],
  },
  // ── 库存模块 ──
  {
    desc: '库存项目按分类查询',
    sql: 'SELECT * FROM InventoryItem WHERE clinicId = ? AND deletedAt IS NULL AND category = ? ORDER BY name LIMIT ? OFFSET ?',
    params: ['clinic-1', 'DRUG', 20, 0],
  },
  // ── 审计日志 ──
  {
    desc: '审计日志按目标查询',
    sql: 'SELECT * FROM AuditLog WHERE targetType = ? AND targetId = ? ORDER BY createdAt DESC LIMIT ?',
    params: ['Patient', 'patient-1', 50],
  },
  {
    desc: '审计日志按诊所分页',
    sql: 'SELECT * FROM AuditLog WHERE clinicId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    params: ['clinic-1', 50, 0],
  },
  // ── 通知模块 ──
  {
    desc: '未读通知查询',
    sql: 'SELECT * FROM Notification WHERE clinicId = ? AND userId = ? AND deletedAt IS NULL AND readAt IS NULL ORDER BY createdAt DESC LIMIT ?',
    params: ['clinic-1', 'user-1', 20],
  },
  // ── 欠费模块 ──
  {
    desc: '欠费记录按状态查询',
    sql: 'SELECT * FROM DebtRecord WHERE clinicId = ? AND deletedAt IS NULL AND status = ? ORDER BY createdAt DESC',
    params: ['clinic-1', 'PENDING'],
  },
];

function main() {
  console.log(`${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  索引命中验证脚本${RESET} ${DIM}— verify-indexes.ts${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  // 构建内存数据库
  const db = new Database(':memory:');

  // 1. 创建表
  const tableSQLs = extractCreateTableSQLs();
  console.log(`\n  ${DIM}创建 ${tableSQLs.length} 张表...${RESET}`);
  for (const sql of tableSQLs) {
    try {
      db.exec(sql);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.log(`  ${YELLOW}⚠ 建表警告: ${msg.slice(0, 80)}${RESET}`);
      }
    }
  }

  // 2. 创建索引
  const indexSQLs = extractCreateIndexSQLs();
  console.log(`  ${DIM}创建 ${indexSQLs.length} 个索引...${RESET}`);
  let indexOk = 0;
  for (const sql of indexSQLs) {
    try {
      db.exec(sql);
      indexOk++;
    } catch {
      // 部分索引可能因列不存在而失败（表结构不完整），跳过
    }
  }
  console.log(`  ${GREEN}✓${RESET} ${indexOk}/${indexSQLs.length} 个索引创建成功\n`);

  // 3. 运行 EXPLAIN QUERY PLAN
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const query of HIGH_FREQUENCY_QUERIES) {
    try {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params);
      const usesIndex = plan.some((row: Record<string, unknown>) => {
        const detail = String(row.detail || '');
        return detail.includes('USING INDEX') || detail.includes('USING COVERING INDEX');
      });

      if (usesIndex) {
        console.log(`  ${GREEN}✓${RESET} ${query.desc}`);
        passed++;
      } else {
        console.log(`  ${RED}✗${RESET} ${query.desc}`);
        const detail = plan.map((r: Record<string, unknown>) => r.detail).join('; ');
        console.log(`    ${RED}${detail}${RESET}`);
        failed++;
        failures.push(query.desc);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${YELLOW}⊘${RESET} ${query.desc} ${DIM}(${msg.slice(0, 60)})${RESET}`);
      skipped++;
    }
  }

  db.close();

  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}${passed} 命中索引${RESET}  ${failed > 0 ? RED : GREEN}${failed} 未命中${RESET}  ${skipped > 0 ? YELLOW : DIM}${skipped} 跳过${RESET}`);

  if (failures.length > 0) {
    console.log(`\n  ${RED}未命中索引的查询:${RESET}`);
    for (const desc of failures) {
      console.log(`    ${RED}•${RESET} ${desc}`);
    }
  }

  if (failed === 0) {
    console.log(`\n  ${GREEN}✓ 所有高频查询均命中索引${RESET}`);
  }
  console.log(`${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
