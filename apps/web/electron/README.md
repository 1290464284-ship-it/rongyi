# Electron 主进程

- **源码**：`main.ts`（请只修改此文件）
- **产物**：`main.cjs` 由 `pnpm electron:compile`（tsc 类型检查 + esbuild 打包）生成，已加入 `.gitignore`
- **密钥存储**：`secrets.json`（userData/config）v2 格式用 `safeStorage`（Windows DPAPI）加密 jwtSecret/encryptionKey；v1 明文文件首次启动时自动迁移为加密存储
