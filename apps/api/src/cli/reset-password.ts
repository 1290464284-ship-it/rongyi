import * as bcrypt from 'bcryptjs';
import * as readline from 'node:readline';
import * as crypto from 'node:crypto';
import { initDb, createDbConnection } from '../db/database';

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function resetPassword() {
  const db = createDbConnection();
  try {
    initDb(db);
  } catch (err) {
    console.error('数据库初始化失败:', err);
    try { db.close(); } catch { /* ignore */ }
    process.exit(1);
  }

  const closeAndExit = (code: number) => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(code);
  };

  const users = db.prepare('SELECT id, username, name FROM User WHERE deletedAt IS NULL').all() as { id: string; username: string; name: string }[];
  
  if (users.length === 0) {
    console.error('\n错误: 数据库中没有找到任何用户！');
    closeAndExit(1);
  }

  console.log('\n========================================');
  console.log('警告: 此操作将重置所有用户的密码！');
  console.log(`将影响 ${users.length} 个用户:`);
  for (const u of users) {
    console.log(`  - ${u.name || u.username} (${u.username})`);
  }
  console.log('========================================\n');

  const confirmed = await promptConfirm('确认重置所有用户密码? (输入 yes 确认): ');
  if (!confirmed) {
    console.log('操作已取消。');
    closeAndExit(0);
  }
  
  const now = new Date().toISOString();
  const results: { username: string; name: string; password: string }[] = [];
  // 与 AuthService.bcryptRounds 保持一致：读取 BCRYPT_ROUNDS 并 clamp 到 8-15
  const envRounds = parseInt(process.env.BCRYPT_ROUNDS ?? '', 10);
  const bcryptRounds = Number.isFinite(envRounds) ? Math.max(8, Math.min(15, envRounds)) : 10;
  
  try {
    // P3-1: 密码批量重置必须原子化 — 若中途崩溃，部分用户密码已变、部分未变，且输出列表不完整
    const resetAll = db.transaction(() => {
      for (const user of users) {
        const buffer = crypto.randomBytes(2);
        const password = String(1000 + (buffer.readUInt16BE(0) % 9000));
        const hash = bcrypt.hashSync(password, bcryptRounds);

        const result = db.prepare(
          `UPDATE User SET passwordHash = ?, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ?`
        ).run(hash, now, user.id);

        if (result.changes === 0) {
          throw new Error(`用户 ${user.username} 更新失败`);
        }
        results.push({ username: user.username, name: user.name || '', password });
      }
    });
    resetAll();
    
    if (results.length === 0) {
      console.error('\n错误: 没有任何用户密码被重置！');
      closeAndExit(1);
    }
    
    console.log('\n========================================');
    console.log('密码重置成功！');
    console.log('========================================');
    for (const r of results) {
      console.log(`${r.name ? r.name + ' (' : ''}${r.username}${r.name ? ')': ''} 已重置`);
    }
    console.log('========================================');
    console.log('请尽快登录并修改密码。');
    console.log('========================================\n');
    closeAndExit(0);
  } catch (err: unknown) {
    console.error('密码重置失败:', err);
    closeAndExit(1);
  }
}

if (require.main === module) {
  resetPassword().catch((err: unknown) => {
    console.error('密码重置脚本执行失败:', err);
    process.exit(1);
  });
}

export { resetPassword };
