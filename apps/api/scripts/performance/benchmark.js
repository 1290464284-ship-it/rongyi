#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'benchmark.sqlite');
const ITERATIONS = parseInt(getArg('--iterations', '100'), 10);
const WARMUP = parseInt(getArg('--warmup', '10'), 10);
const TABLE_NAME = 'benchmark_items';

function getArg(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : defaultValue;
}

function formatNumber(num, digits = 2) {
  return Number(num).toFixed(digits);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function calcStats(times) {
  if (times.length === 0) return { avg: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  const len = sorted.length;
  return {
    avg: sorted.reduce((a, b) => a + b, 0) / len,
    median: sorted[Math.floor(len / 2)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    min: sorted[0],
    max: sorted[len - 1],
  };
}

function printTable(title, rows) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(70)}`);
  console.log(
    `  ${'测试项'.padEnd(28)}${'平均(ms)'.padEnd(12)}${'中位(ms)'.padEnd(12)}` +
    `${'P95(ms)'.padEnd(12)}${'P99(ms)'.padEnd(12)}`
  );
  console.log(`  ${'-'.repeat(68)}`);
  for (const row of rows) {
    console.log(
      `  ${row.name.padEnd(28)}` +
      `${formatNumber(row.stats.avg).padStart(12)}` +
      `${formatNumber(row.stats.median).padStart(12)}` +
      `${formatNumber(row.stats.p95).padStart(12)}` +
      `${formatNumber(row.stats.p99).padStart(12)}`
    );
  }
  console.log(`${'='.repeat(70)}`);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('错误: 未找到 better-sqlite3 模块。请先安装依赖: npm install');
  process.exit(1);
}

function setupDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      createdAt INTEGER NOT NULL
    )
  `);

  return db;
}

function insertTestData(db, count) {
  const stmt = db.prepare(
    `INSERT INTO ${TABLE_NAME} (name, value, category, description, createdAt) VALUES (?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item.name, item.value, item.category, item.description, item.createdAt);
    }
  });

  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      name: `item_${i}`,
      value: i,
      category: `cat_${i % 10}`,
      description: `description for item ${i} with some extra text to make it longer`,
      createdAt: Date.now() + i,
    });
  }
  insertMany(items);
  return items;
}

function measure(fn, iterations, warmup) {
  for (let i = 0; i < warmup; i++) {
    fn(i);
  }
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    fn(i);
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6);
  }
  return calcStats(times);
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
  };
}

function printMemory(title, mem) {
  console.log(`\n  ${title}:`);
  console.log(`    RSS:        ${formatBytes(mem.rss)}`);
  console.log(`    Heap Total: ${formatBytes(mem.heapTotal)}`);
  console.log(`    Heap Used:  ${formatBytes(mem.heapUsed)}`);
  console.log(`    External:   ${formatBytes(mem.external)}`);
}

function runBenchmark() {
  console.log('\n' + '='.repeat(70));
  console.log('  SQLite 性能基准测试');
  console.log('='.repeat(70));
  console.log(`  迭代次数: ${ITERATIONS}`);
  console.log(`  预热次数: ${WARMUP}`);
  console.log(`  数据库: ${DB_PATH}`);
  console.log(`  Node.js: ${process.version}`);
  console.log(`  平台: ${os.platform()} ${os.arch()}`);
  console.log(`  CPU: ${os.cpus().length} 核`);
  console.log('='.repeat(70));

  const memBefore = getMemoryUsage();
  printMemory('启动后内存使用', memBefore);

  const db = setupDb();
  const memAfterSetup = getMemoryUsage();
  printMemory('数据库初始化后内存', memAfterSetup);

  console.log('\n  正在插入测试数据 (1000 条)...');
  const testData = insertTestData(db, 1000);
  console.log('  测试数据插入完成');

  const dbRows = [];

  console.log('\n  运行数据库性能测试...');

  const insertSingleStats = measure((i) => {
    const idx = i + 10000;
    db.prepare(
      `INSERT INTO ${TABLE_NAME} (name, value, category, description, createdAt) VALUES (?, ?, ?, ?, ?)`
    ).run(`single_${idx}`, idx, `cat_${idx % 10}`, `single insert ${idx}`, Date.now());
  }, ITERATIONS, WARMUP);
  dbRows.push({ name: '单条插入', stats: insertSingleStats });

  const insertBatchStats = measure(() => {
    const items = [];
    for (let j = 0; j < 100; j++) {
      const idx = Math.floor(Math.random() * 100000) + 20000;
      items.push({
        name: `batch_${idx}`,
        value: idx,
        category: `cat_${idx % 10}`,
        description: `batch item ${idx}`,
        createdAt: Date.now() + idx,
      });
    }
    const insertTx = db.transaction((its) => {
      const stmt = db.prepare(
        `INSERT INTO ${TABLE_NAME} (name, value, category, description, createdAt) VALUES (?, ?, ?, ?, ?)`
      );
      for (const it of its) {
        stmt.run(it.name, it.value, it.category, it.description, it.createdAt);
      }
    });
    insertTx(items);
  }, Math.min(ITERATIONS, 50), Math.min(WARMUP, 5));
  dbRows.push({ name: '批量插入 (100条)', stats: insertBatchStats });

  const selectByIdStats = measure((i) => {
    const id = (i % 1000) + 1;
    db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`).get(id);
  }, ITERATIONS, WARMUP);
  dbRows.push({ name: '主键查询', stats: selectByIdStats });

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_bench_cat ON ${TABLE_NAME}(category)`).run();

  const paginatedStats = measure((i) => {
    const offset = i % 900;
    db.prepare(`SELECT * FROM ${TABLE_NAME} ORDER BY id LIMIT 20 OFFSET ?`).all(offset);
  }, ITERATIONS, WARMUP);
  dbRows.push({ name: '分页查询 (LIMIT 20)', stats: paginatedStats });

  const fuzzyStats = measure((i) => {
    const keyword = `item_${i % 50}`;
    db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE name LIKE ? LIMIT 20`).all(`%${keyword}%`);
  }, ITERATIONS, WARMUP);
  dbRows.push({ name: '模糊查询 (LIKE)', stats: fuzzyStats });

  const transactionStats = measure((i) => {
    const tx = db.transaction(() => {
      const idx = i + 50000;
      db.prepare(
        `INSERT INTO ${TABLE_NAME} (name, value, category, description, createdAt) VALUES (?, ?, ?, ?, ?)`
      ).run(`tx_${idx}`, idx, `cat_tx`, `tx item ${idx}`, Date.now());
      db.prepare(`UPDATE ${TABLE_NAME} SET value = value + 1 WHERE id = ?`).run((i % 100) + 1);
      db.prepare(`SELECT COUNT(*) as cnt FROM ${TABLE_NAME} WHERE category = ?`).get('cat_0');
    });
    tx();
  }, Math.min(ITERATIONS, 50), Math.min(WARMUP, 5));
  dbRows.push({ name: '事务处理 (3操作)', stats: transactionStats });

  printTable('数据库性能测试结果', dbRows);

  console.log('\n  正在执行内存压力测试 (1000次查询)...');
  const memBeforeQueries = getMemoryUsage();

  const stmt = db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`);
  for (let i = 0; i < 1000; i++) {
    stmt.get((i % 1000) + 1);
  }
  global.gc && global.gc();

  const memAfterQueries = getMemoryUsage();
  printMemory('1000次查询后内存', memAfterQueries);

  const memDiff = {
    rss: memAfterQueries.rss - memBeforeQueries.rss,
    heapUsed: memAfterQueries.heapUsed - memBeforeQueries.heapUsed,
    heapTotal: memAfterQueries.heapTotal - memBeforeQueries.total,
  };
  console.log(`\n  内存变化 (1000次查询后 - 查询前):`);
  console.log(`    RSS 变化:   ${memDiff.rss >= 0 ? '+' : ''}${formatBytes(memDiff.rss)}`);
  console.log(`    Heap Used:  ${memDiff.heapUsed >= 0 ? '+' : ''}${formatBytes(memDiff.heapUsed)}`);

  console.log('\n' + '='.repeat(70));
  console.log('  缓存与连接信息');
  console.log('='.repeat(70));

  try {
    const cacheHit = db.pragma('cache_hit');
    const cacheMiss = db.pragma('cache_miss');
    const hit = cacheHit && cacheHit[0] ? cacheHit[0].cache_hit : 0;
    const miss = cacheMiss && cacheMiss[0] ? cacheMiss[0].cache_miss : 0;
    const total = hit + miss;
    const hitRate = total > 0 ? ((hit / total) * 100).toFixed(2) : 'N/A';
    console.log(`  缓存命中: ${hit}`);
    console.log(`  缓存未命中: ${miss}`);
    console.log(`  缓存命中率: ${hitRate}%`);
  } catch {
    console.log('  缓存统计: 不可用');
  }

  try {
    const pageCount = db.pragma('page_count');
    const pageSize = db.pragma('page_size');
    const pages = pageCount && pageCount[0] ? pageCount[0].page_count : 0;
    const pSize = pageSize && pageSize[0] ? pageSize[0].page_size : 0;
    console.log(`  数据库页数: ${pages}`);
    console.log(`  页大小: ${pSize} bytes`);
    console.log(`  数据库大小: ${formatBytes(pages * pSize)}`);
  } catch {
    console.log('  数据库大小: 不可用');
  }

  console.log('\n' + '='.repeat(70));
  console.log('  测试完成');
  console.log('='.repeat(70));

  try {
    db.close();
  } catch {}

  try {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    const walPath = DB_PATH + '-wal';
    const shmPath = DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch {}

  console.log('');
}

runBenchmark();
