#!/usr/bin/env node
/**
 * UI 验证豁免注册表 — 测试文件存在性校验
 *
 * 解析 docs/ui-verification-exemption-registry.md 中"已有专项/间接测试"条目，
 * 校验其引用的测试文件在 apps/web/src/ 下仍然存在。
 * 任一引用文件缺失即 exit(1)，阻止 verify 链通过。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const WEB_SRC = resolve(repoRoot, 'apps/web/src');
const REGISTRY = resolve(repoRoot, 'docs/ui-verification-exemption-registry.md');

// ── 1. 收集 apps/web/src 下所有 .test.tsx，建立 basename → fullPath 索引 ──
function collectTestFiles(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectTestFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.test.tsx')) {
      results.push({ name: entry.name, full, rel: full.slice(base.length + 1) });
    }
  }
  return results;
}

// ── 2. 解析注册表，提取测试文件引用 ──
/**
 * 解析注册表，提取所有带测试文件引用的条目。
 * 覆盖状态：✅ 新增行为测试 / ✅ 已有专项测试 / ✅ 已有间接测试
 */
function parseRegistry(content) {
  const entries = [];
  for (const line of content.split('\n')) {
    if (!line.includes('✅')) continue;

    const cols = line.split('|').map(c => c.trim());
    // cols: ['', '文件路径', '状态', '说明', '']
    const srcFile = cols[1];
    const status = cols[2];
    const desc = cols[3];

    // 仅校验含测试文件引用的条目（反引号内 *.test.tsx）
    const codeMatch = desc.match(/`([^`]+\.test\.tsx)`/);
    if (codeMatch) {
      entries.push({ srcFile, status, ref: codeMatch[1] });
    }
  }
  return entries;
}

// ── 3. 将引用解析为实际文件路径 ──
function resolveRef(ref, testFileIndex) {
  // 优先精确匹配：相对路径后缀或完整 basename
  const byRel = testFileIndex.find(f => f.rel === ref || f.rel.endsWith(ref));
  if (byRel) return byRel;

  // 退而求其次：basename 匹配
  const bn = basename(ref);
  return testFileIndex.find(f => f.name === bn) || null;
}

// ── Main ──
function main() {
  if (!existsSync(REGISTRY)) {
    console.error('✗ 注册表文件不存在:', REGISTRY);
    process.exit(1);
  }

  const content = readFileSync(REGISTRY, 'utf8');
  const entries = parseRegistry(content);

  if (entries.length === 0) {
    console.log('✓ 豁免注册表中无测试文件引用，跳过校验');
    return;
  }

  const testFiles = collectTestFiles(WEB_SRC);
  const missing = [];

  for (const entry of entries) {
    const resolved = resolveRef(entry.ref, testFiles);
    if (!resolved) {
      missing.push({ ...entry, reason: '文件不存在' });
    }
  }

  if (missing.length > 0) {
    console.error('✗ 豁免注册表引用的测试文件缺失:');
    for (const m of missing) {
      console.error(`  - ${m.srcFile} → ${m.ref}`);
    }
    console.error(
      `\n请恢复上述测试文件，或更新 docs/ui-verification-exemption-registry.md`,
    );
    process.exit(1);
  }

  console.log(`✓ 豁免注册表 ${entries.length} 条测试引用均有效`);
}

main();
