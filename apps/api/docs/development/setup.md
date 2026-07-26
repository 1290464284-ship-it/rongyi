# 开发环境搭建指南

本文档介绍如何在本地搭建牙科诊所管理系统 API 的开发环境，以及日常开发中的常用操作和规范。

## 1. 环境要求

### 1.1 Node.js

- **版本**：Node.js 20.x（LTS）
- **推荐工具**：使用 nvm 管理 Node.js 版本

项目根目录已提供 `.nvmrc` 文件，可直接使用：

```bash
# 在 source 目录下执行
nvm use
```

### 1.2 包管理器

- **包管理器**：npm（随 Node.js 一起安装）
- **工作区**：项目使用 npm workspaces 管理 monorepo

### 1.3 编辑器推荐

推荐使用以下编辑器和插件：

- **VS Code**（推荐）
  - ESLint 插件
  - Prettier 插件
  - EditorConfig for VS Code 插件
  - Jest 插件
  - TypeScript Hero 插件

## 2. 本地开发步骤

### 2.1 克隆代码

```bash
git clone <repository-url>
cd rongyi/source
```

### 2.2 切换 Node.js 版本

```bash
nvm use
```

> 如果尚未安装 Node.js 20，可使用 `nvm install 20` 安装。

### 2.3 安装依赖

在 `source/` 根目录执行（monorepo 工作区会自动安装所有子项目的依赖）：

```bash
npm install
```

### 2.4 配置环境变量

进入 API 项目目录，复制环境变量示例文件：

```bash
cd apps/api
cp .env.example .env
```

**必填配置项：**

| 变量 | 说明 | 生成方式 |
|------|------|----------|
| `JWT_SECRET` | JWT 签名密钥（至少 32 位） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ENCRYPTION_KEY` | 数据加密密钥（64 位十六进制） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> 未配置 `.env` 时，应用首次启动会自动在 `data` 目录生成一份含随机密钥的 `.env`。

### 2.5 初始化数据库（可选）

如果需要初始化种子数据：

```bash
npm run seed:fresh
```

### 2.6 启动开发服务

```bash
npm run dev
```

服务默认监听 `http://localhost:3001`，API 路径前缀为 `/api/v1`。

### 2.7 访问 API 文档

开发环境下启动服务后，访问 Swagger UI：

```
http://localhost:3001/api/docs
```

> 生产环境（`NODE_ENV=production`）不启用 Swagger。

## 3. 常用命令

所有命令均在 `apps/api/` 目录下执行。

### 3.1 开发与构建

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务（watch 模式，文件变更自动重启） |
| `npm run build` | 构建生产产物（nest build + ncc 打包） |
| `npm start` | 运行构建产物 |

### 3.2 代码检查

| 命令 | 说明 |
|------|------|
| `npm run lint` | ESLint 检查（允许警告） |
| `npm run lint:fix` | ESLint 自动修复可修复的问题 |
| `npm run lint:strict` | ESLint 严格检查（0 警告阈值） |
| `npm run typecheck` | TypeScript 类型检查 |

### 3.3 测试

| 命令 | 说明 |
|------|------|
| `npm test` | 运行单元测试 + 集成测试 |
| `npm run test:cov` | 运行测试并生成覆盖率报告 |
| `npm run test:e2e` | 运行 E2E 端到端测试 |
| `npm run test:smoke` | 运行烟雾测试（启动检查） |
| `npm run test:migration` | 运行数据库迁移测试 |
| `npm run verify` | 综合验证：typecheck + lint + test |
| `npm run verify:full` | 完整验证：typecheck + lint + test + e2e + smoke + migration |

### 3.4 数据库工具

| 命令 | 说明 |
|------|------|
| `npm run seed` | 写入种子数据 |
| `npm run seed:fresh` | 重置数据库并写入种子数据 |
| `npm run seed:large` | 写入大量种子数据（1000 条） |
| `npm run reset-password` | 命令行重置用户密码 |

### 3.5 代码质量

| 命令 | 说明 |
|------|------|
| `npm run health` | 代码健康检查 |
| `npm run tech-debt` | 技术债务追踪 |
| `npm audit` | 安全漏洞审计（仅报告高危） |

## 4. 代码规范

### 4.1 EditorConfig

项目使用 `.editorconfig` 统一编辑器配置：

- 字符编码：UTF-8
- 换行符：LF
- 缩进风格：空格
- 缩进大小：2 个空格
- 文件末尾插入新行
- 修剪行尾空白（Markdown 文件除外）

> 大部分编辑器已内置支持 EditorConfig，无需额外配置。

### 4.2 Prettier

项目使用 Prettier 统一代码格式，配置文件位于 `source/.prettierrc`：

- 分号：启用
- 尾随逗号：全部（all）
- 单引号：禁用（使用双引号）
- 行宽：100 字符
- 缩进：2 空格
- 括号间距：启用
- 箭头函数参数括号：总是添加
- 行尾：LF

### 4.3 ESLint

项目使用 ESLint 进行代码质量检查，配置文件为 `eslint.config.js`。

启用的主要规则集：
- TypeScript ESLint 推荐规则
- Prettier 兼容配置（禁用与 Prettier 冲突的规则）
- Node.js 最佳实践
- 安全相关规则
- SonarJS 代码质量规则
- Unicorn 代码风格规则

### 4.4 代码风格约定

- 使用 TypeScript 严格模式
- 优先使用 `const`，避免 `var`
- 文件顶部进行模块导入，按分组排序
- 接口和类型使用 PascalCase
- 变量和函数使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- 避免使用 `any` 类型，尽量使用具体类型或 `unknown`

## 5. 提交规范

项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范。

详细说明请参考 [提交规范](./commit-convention.md)。

### 5.1 提交类型速查

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建系统或依赖变更 |
| `ci` | CI/CD 配置变更 |
| `chore` | 杂项 |
| `revert` | 回滚提交 |

### 5.2 预提交钩子

项目使用 Husky + lint-staged 配置了 Git 钩子：

- **pre-commit**：对暂存的 TypeScript 文件运行 ESLint
- **commit-msg**：检查提交信息是否符合规范

## 6. 调试指南

### 6.1 VS Code 调试

在 VS Code 中可以使用内置调试器进行调试。创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug NestJS",
      "args": ["${workspaceFolder}/apps/api/src/main.ts"],
      "runtimeArgs": ["--nolazy", "-r", "ts-node/register"],
      "sourceMaps": true,
      "cwd": "${workspaceFolder}/apps/api",
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### 6.2 日志调试

- 应用使用 `AppLogger` 进行结构化日志输出
- 开发环境下日志默认输出到控制台
- 日志级别可通过 `LOG_LEVEL` 环境变量调整

### 6.3 常见调试技巧

1. **数据库查询调试**：设置 `DB_DEBUG=1` 环境变量可以打印 SQL 查询
2. **性能分析**：使用 `npm run health` 检查代码性能问题
3. **测试调试**：在 VS Code 中使用 Jest 插件可以单独调试测试用例

## 7. 常见问题

### 7.1 依赖安装失败

**问题**：`npm install` 失败，出现网络错误或权限问题。

**解决方法**：
```bash
# 清除缓存
npm cache clean --force

# 使用国内镜像源
npm config set registry https://registry.npmmirror.com

# 删除 node_modules 后重新安装
rm -rf node_modules package-lock.json
npm install
```

### 7.2 数据库启动失败

**问题**：启动时报数据库连接错误或权限不足。

**解决方法**：
- 检查 `DATA_DIR` 和 `DB_PATH` 配置是否正确
- 确保数据目录有写入权限
- 尝试删除数据库文件重新初始化：
  ```bash
  rm -rf data/*.sqlite
  npm run seed:fresh
  ```

### 7.3 端口被占用

**问题**：启动时提示端口 3001 已被占用。

**解决方法**：
- 修改 `.env` 文件中的 `PORT` 配置
- 或找到并停止占用端口的进程：
  ```bash
  # Windows
  netstat -ano | findstr :3001
  taskkill /PID <进程ID> /F
  ```

### 7.4 TypeScript 类型检查不通过

**问题**：`npm run typecheck` 报错。

**解决方法**：
- 检查是否缺少类型定义
- 确保所有导入路径正确
- 运行 `npm run typecheck` 查看详细错误信息

### 7.5 ESLint 警告过多

**问题**：lint 检查有大量警告。

**解决方法**：
- 优先运行 `npm run lint:fix` 自动修复
- 对于无法自动修复的问题，按提示逐一修复
- 如有必要，可在代码中使用 `eslint-disable-next-line` 临时禁用特定规则，但需添加注释说明原因

### 7.6 Husky 钩子不生效

**问题**：提交代码时没有触发预提交检查。

**解决方法**：
```bash
# 重新激活 husky
npm run prepare

# 检查 .husky 目录是否存在
ls -la .husky/
```

## 8. 相关文档

- [提交规范](./commit-convention.md)
- [系统架构总览](../architecture/system-architecture.md)
- [ADR 索引](../adr/README.md)
- [代码审查清单](../code-review-checklist.md)
- [数据库设计](../database/database-design.md)
- [部署指南](../deployment/docker-deployment.md)
