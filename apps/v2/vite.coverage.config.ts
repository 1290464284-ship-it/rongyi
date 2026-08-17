import { defineConfig } from 'vitest/config';
import base from './vite.config';

// T-1：服务端覆盖收集配置——单进程（fileParallelism: false）执行，避免多 worker v8 合并
// 丢失分支表（实测 workflow.ts 分支从 116 掉到 33，`?? {}` 等分支不入账）。
// 仅覆盖运行使用；普通 `vitest run`（test）保持并行不引用本配置。
// 注：vitest 4 已移除 poolOptions.forks.singleFork（类型与运行时均无），
// 官方替代为 fileParallelism: false（自动覆盖 maxWorkers 为 1）。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    fileParallelism: false,
  },
});
