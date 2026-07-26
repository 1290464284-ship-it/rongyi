# 提交规范

本文档定义了项目的 Git 提交规范，基于 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范。

## 1. 为什么使用规范的提交信息？

- 自动化生成 CHANGELOG
- 自动识别语义化版本号
- 提供更清晰的历史记录
- 便于代码审查和问题追踪
- 让协作者更容易理解变更意图

## 2. 提交格式

每次提交信息包含以下结构：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 2.1 type（必需）

用于说明提交的类型，必须是以下之一：

| 类型 | 说明 | 示例 |
|------|------|------|
| **feat** | 新功能 | `feat: 添加用户登录功能` |
| **fix** | 修复 bug | `fix: 修复登录页面验证码不显示问题` |
| **docs** | 文档更新 | `docs: 更新 API 接口文档` |
| **style** | 代码格式（不影响功能） | `style: 调整代码缩进和格式` |
| **refactor** | 代码重构（不是新功能也不是修 bug） | `refactor: 重构用户服务模块` |
| **perf** | 性能优化 | `perf: 优化数据库查询性能` |
| **test** | 测试相关 | `test: 添加用户模块单元测试` |
| **build** | 构建系统或外部依赖变更 | `build: 升级 NestJS 到 v10` |
| **ci** | CI/CD 配置变更 | `ci: 添加 GitHub Actions 工作流` |
| **chore** | 杂项（不修改源码或测试） | `chore: 更新 .gitignore` |
| **revert** | 回滚提交 | `revert: 回滚"添加用户登录功能"` |

### 2.2 scope（可选）

用于说明提交影响的范围，如模块名、组件名等。

示例：
- `feat(auth): 添加 JWT 认证`
- `fix(user): 修复用户信息更新失败`
- `refactor(clinical): 重构临床模块`

### 2.3 subject（必需）

提交的简短描述，不超过 50 个字符。

- 使用祈使句，如"添加"、"修复"、"重构"
- 首字母小写（中文除外）
- 结尾不加句号

### 2.4 body（可选）

详细描述本次提交的内容，可以分成多行。

- 说明提交的动机和背景
- 描述修改的关键点
- 与之前行为的对比

### 2.5 footer（可选）

用于说明不兼容变更或关闭的 Issue。

**不兼容变更：**
```
BREAKING CHANGE: 移除了旧版 API 接口，使用新版接口替代。
```

**关闭 Issue：**
```
Closes #123
```

## 3. 示例

### 3.1 简单提交

```
feat: 添加用户注册功能
```

### 3.2 带范围的提交

```
fix(auth): 修复 token 过期时间不正确的问题
```

### 3.3 带详细描述的提交

```
refactor(patient): 重构患者信息查询接口

- 将多个查询参数统一封装为 DTO
- 添加参数校验
- 优化查询性能，减少数据库查询次数
- 更新相关测试用例
```

### 3.4 带不兼容变更的提交

```
feat(api): 升级 REST API 到 v2

BREAKING CHANGE: v1 API 已废弃，请迁移到 v2 接口。
主要变更：
- 统一响应格式
- 优化分页参数
- 添加更详细的错误码
```

## 4. Commitlint 配置

项目使用 `commitlint` 来自动检查提交信息是否符合规范。

### 4.1 配置文件

配置文件位于项目根目录的 `.commitlintrc.json`：

```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", [
      "feat", "fix", "docs", "style", "refactor", "perf",
      "test", "build", "ci", "chore", "revert"
    ]],
    "subject-case": [0],
    "body-max-line-length": [0]
  }
}
```

### 4.2 手动检查

可以使用以下命令手动检查提交信息：

```bash
# 检查最后一次提交
npm run commitlint

# 检查特定提交
npx commitlint --from HEAD~1 --to HEAD
```

## 5. 预提交钩子

项目使用 `husky` 和 `lint-staged` 配置了 Git 钩子，在提交代码前自动执行检查。

### 5.1 pre-commit

在提交前自动运行 `lint-staged`，对暂存的文件执行代码检查和修复。

**当前配置：**
- `*.ts`, `*.tsx` 文件：运行 `eslint --fix`

### 5.2 commit-msg

在提交信息编写完成后自动运行 `commitlint`，检查提交信息是否符合规范。

如果提交信息不符合规范，提交会被拒绝，并显示错误信息。

### 5.3 pre-push

在推送代码前自动运行测试，确保代码质量。

```bash
npm run test -- --passWithNoTests
```

### 5.4 跳过钩子

如果确实需要跳过钩子检查（不推荐），可以使用 `--no-verify` 参数：

```bash
# 跳过 pre-commit 和 commit-msg 钩子
git commit --no-verify -m "..."

# 跳过 pre-push 钩子
git push --no-verify
```

> **注意：** 请谨慎使用 `--no-verify`，只有在特殊情况下才使用。

## 6. 最佳实践

1. **原子提交**：每次提交只做一件事，保持提交的原子性
2. **频繁提交**：小步提交，便于回溯和代码审查
3. **清晰描述**：subject 要简洁明了，body 补充详细信息
4. **关联 Issue**：相关的 Issue 在 footer 中引用
5. **使用 scope**：尽量指定影响范围，便于筛选历史记录
6. **先格式化再提交**：提交前确保代码已经过 lint 检查

## 7. 相关命令

```bash
# 安装依赖（首次使用）
npm install

# 激活 husky 钩子
npm run prepare

# 手动运行 lint-staged
npm run lint:staged

# 检查提交信息
npm run commitlint
```
