// 汇总 ESLint 警告
const { ESLint } = require('eslint');
const path = require('path');

(async () => {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: path.join(process.cwd(), 'eslint.config.cjs'),
  });

  const patterns = ['src/**/*.ts', 'test/**/*.ts'];
  const results = await eslint.lintFiles(patterns);

  const byRule = {};
  const byFile = {};
  let totalErrors = 0;
  let totalWarnings = 0;
  const allMessages = [];

  for (const r of results) {
    for (const m of r.messages) {
      if (m.severity === 2) totalErrors++;
      if (m.severity === 1) totalWarnings++;

      byRule[m.ruleId || 'unknown'] = (byRule[m.ruleId || 'unknown'] || 0) + 1;
      byFile[r.filePath] = (byFile[r.filePath] || 0) + 1;
      allMessages.push({
        file: r.filePath.replace(process.cwd(), ''),
        line: m.line,
        col: m.column,
        rule: m.ruleId,
        msg: m.message,
        severity: m.severity,
      });
    }
  }

  console.log('===== Summary =====');
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);
  console.log('');

  console.log('===== By Rule =====');
  Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .forEach(([rule, count]) => {
      console.log(`${count.toString().padStart(4)}  ${rule}`);
    });

  console.log('');
  console.log('===== Top 20 Files =====');
  Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([file, count]) => {
      console.log(`${count.toString().padStart(4)}  ${file.replace(process.cwd(), '')}`);
    });

  // 写详细文件
  const fs = require('fs');
  fs.writeFileSync(
    'lint-detail.json',
    JSON.stringify(allMessages, null, 2),
  );
  console.log('');
  console.log('Detailed messages written to lint-detail.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
