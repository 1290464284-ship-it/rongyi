# 口腔诊所管理系统（牙科管家）

本地私有部署的口腔诊所管理软件，支持 Web 开发模式与 Electron 桌面版。

## 技术栈

- 前端：React 18 + TypeScript + Vite + TailwindCSS
- 后端：NestJS + better-sqlite3（SQLite）
- 桌面：Electron（数据目录位于系统 userData，升级不会覆盖诊所数据）

## 开发模式

```bash
pnpm install
pnpm --filter @dental/api dev   # 或根目录 pnpm dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 开发库默认路径：`apps/api/data/dental.sqlite`（若存在旧版 `apps/api/prisma/data/dental.sqlite` 会自动迁移）

根目录一键：

```bash
pnpm install
pnpm dev
```

### 环境变量

复制 `.env.example` 为 `apps/api/.env`，至少设置足够长的 `JWT_SECRET`（不要使用示例弱值）。

开发环境默认可使用账号（首次种子数据）：

| 用户名 | 角色 | 密码 |
|--------|------|------|
| boss | 老板 | 123456 |
| doctor | 医生 | 123456 |
| front | 前台 | 123456 |

**生产 / Electron 首次启动会生成随机初始密码并写入日志，请立即修改。**

## Electron 桌面版

```bash
pnpm --filter @dental/api build   # 如需重新打包 API bundle
pnpm electron:dist                # 根脚本，或 pnpm --filter @dental/web electron:dist
```

- 数据目录：`%APPDATA%/牙科管家/data/dental.sqlite`（Windows）
- 备份目录：同级 `backups/`
- 旧版若数据在安装目录 `resources/api/data/`，首次启动会自动复制到 userData（不删除旧文件）

Electron 主进程源码为 `apps/web/electron/main.ts`，`main.cjs` 为编译产物，请勿手改。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 同时启动 API + Web |
| `pnpm build` | 构建 shared + api + web |
| `pnpm electron:dev` | Electron 开发 |
| `pnpm electron:dist` | 打包安装包到 `release-v2/` |

## 说明

本项目已从早期 Postgres/Prisma 方案迁移到本地 SQLite。历史 Docker/Postgres 文档不再作为主路径。
