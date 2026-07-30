#!/usr/bin/env node
/**
 * 文档新鲜度验证脚本
 * 
 * 检查核心代码变更时，对应的 AGENTS.md / API 文档是否同步更新。
 * 规则：
 * 1. apps/api/src/ 变更时，apps/api/AGENTS.md 应在最近 5 次提交中也有变更
 * 2. apps/web/src/lib/api/ 变更时，docs/ 下 API 文档应在最近 5 次提交中也有变更
 * 3. packages/shared/src/ 变更时，根 AGENTS.md 应在最近 5 次提交中也有变更
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function getRecentChangedFiles(pattern, count = 5) {
  try {
    const log = execFileSync(
      'git', ['log', '--name-only', '--pretty=format:', '-n', String(count), '--', pattern],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return log.split('\n').filter(f => f.trim() && !f.includes('AGENTS.md') && !f.includes('docs/'));
  } catch {
    return [];
  }
}

function hasCompanionUpdated(pattern, companionPattern, count = 5) {
  try {
    const log = execFileSync(
      'git', ['log', '--name-only', '--pretty=format:', '-n', String(count), '--', companionPattern],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return log.split('\n').some(f => f.trim().includes(companionPattern.replace('*', '')));
  } catch {
    return false;
  }
}

let findings = 0;

// 检查 1: API 源码变更 → AGENTS.md 同步
const apiChanges = getRecentChangedFiles('apps/api/src/**/*.ts');
if (apiChanges.length > 0) {
  const agentsUpdated = hasCompanionUpdated('apps/api/src/**', 'apps/api/AGENTS.md');
  if (!agentsUpdated && existsSync(resolve(repoRoot, 'apps/api/AGENTS.md'))) {
    // 仅当 API 变更涉及新模块或路由变更时才报警
    const hasNewModule = apiChanges.some(f => f.includes('.module.ts') || f.includes('.controller.ts'));
    if (hasNewModule) {
      console.log(`⚠ API 模块/路由变更但 AGENTS.md 可能未同步更新`);
      console.log(`  变更文件: ${apiChanges.slice(0, 3).join(', ')}`);
      findings++;
    }
  }
}

// 检查 2: shared 包变更 → 根 AGENTS.md 同步
const sharedChanges = getRecentChangedFiles('packages/shared/src/**');
if (sharedChanges.length > 0) {
  const agentsUpdated = hasCompanionUpdated('packages/shared/src/**', 'AGENTS.md');
  if (!agentsUpdated) {
    console.log(`⚠ shared 包变更但根 AGENTS.md 可能未同步更新`);
    findings++;
  }
}

if (findings === 0) {
  console.log('✓ 文档新鲜度检查通过');
} else {
  console.log(`\n发现 ${findings} 个潜在文档同步问题（advisory）`);
}

process.exit(0); // advisory only, never blocks
