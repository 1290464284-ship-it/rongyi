import * as bcrypt from 'bcryptjs';
import * as readline from 'readline';
import { initDb } from '../db/database';

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
  initDb();
  
  const db = require('../db/database').db;
  
  const users = db.prepare('SELECT id, username, name FROM User WHERE deletedAt IS NULL').all() as any[];
  
  if (users.length === 0) {
    console.error('\n错误: 数据库中没有找到任何用户！');
    process.exit(1);
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
    process.exit(0);
  }
  
  const now = new Date().toISOString();
  const results: { username: string; name: string; password: string }[] = [];
  
  try {
    for (const user of users) {
      const password = String(Math.floor(1000 + Math.random() * 9000));
      const hash = bcrypt.hashSync(password, 10);
      
      const stmt = db.prepare(
        `UPDATE User SET passwordHash = ?, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ?`
      );
      const result = stmt.run(hash, now, user.id);
      
      if (result.changes === 0) {
        console.error(`警告: 用户 ${user.username} 更新失败`);
      } else {
        results.push({ username: user.username, name: user.name || '', password });
      }
    }
    
    if (results.length === 0) {
      console.error('\n错误: 没有任何用户密码被重置！');
      process.exit(1);
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
    process.exit(0);
  } catch (err) {
    console.error('密码重置失败:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  resetPassword();
}

export { resetPassword };
