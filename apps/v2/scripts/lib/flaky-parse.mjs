/**
 * 从 vitest 输出中提取失败测试所在文件（相对路径）。
 *
 * 兼容两种常见 reporter 输出：
 * - default/verbose reporter：` ❯ src/.../foo.spec.ts (2 tests | 1 failed)`
 *   文件行，以及 ` × src/.../foo.spec.ts > describe > test` 断言行；
 * - basic 风格：`FAIL  src/.../foo.spec.ts`。
 *
 * 只认 .spec/.test 扩展名，识别不出时返回空数组（不猜），避免把普通路径
 * 写入 flaky 历史造成噪音。
 */
export function extractFailedFiles(output = '') {
  const files = new Set();
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    const fileLine = /^\s*[❯›>]\s*(?:[\d.]+s?\s+)?(.+?\.(?:spec|test)\.[cm]?[jt]sx?)(?:\s|\(|$)/.exec(line);
    if (fileLine) files.add(fileLine[1].trim());
    const failLine = /^\s*[×✕✗xX]\s+(.+?\.(?:spec|test)\.[cm]?[jt]sx?)(?:\s+>|\s+\d+m?s?\s*$|\s*$)/.exec(line);
    if (failLine) files.add(failLine[1].trim());
    const basic = /^\s*FAIL\s+(.+?\.(?:spec|test)\.[cm]?[jt]sx?)/.exec(line);
    if (basic) files.add(basic[1].trim());
  }
  return [...files];
}
