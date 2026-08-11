# src/web 目录约定（Round 7 M-01）

本目录是 v2 前端源码根。顶层只保留应用入口与共享样式，其余文件按职责分层：

## 目录分层

| 目录 | 职责 | 内容约定 |
|---|---|---|
| `pages/` | 业务页面 | 一个文件一个页面，命名 `XxxPage.tsx`（对应 spec 为 `XxxPage.spec.tsx`） |
| `components/` | 通用组件 | `index.tsx` 是共享组件库（历史遗留的 `components.tsx` 迁入后改名）；`CrudPage`、`ResourcePage`、`FormBuilder`、`Layout`、`ResourceHub`、`hub-tabs`、`toast` 等通用 UI 都在这里 |
| `hooks/` | 通用 React hooks | `use-xxx.ts`（kebab-case），对应 spec `use-xxx.spec.tsx` |
| `lib/` | 共享工具/类型/字典 | `api`、`format`、`messages`、`toast-context`、`types`（web 共享类型）、`labels`（集中式中文 label 字典，M-03） |
| 领域子目录（`cephalometric/`、`charges/`、`clinical-workflow/`、`dispense/`、`first-exams/`、`processing-orders/`、`treatment-plans/`） | 领域模块 | 该领域专属的页面片段、组件、类型与常量都放在模块内；领域模块之间通过 `lib/`、`components/` 共享 |

## 命名约定

- 业务页面统一 `XxxPage.tsx`（PascalCase + Page 后缀），放 `pages/`。
- 通用组件 `Xxx.tsx`（PascalCase），放 `components/`。
- 通用 hooks `use-xxx.ts`（kebab-case），放 `hooks/`。
- 类型文件统一 `types.ts`（模块内共享类型）；跨模块共享类型放 `lib/types.ts`。
- 中文 label 文案一律集中在 `lib/labels.ts`（M-03），页面与领域模块从那里导入或 re-export，禁止在页面内重新定义字典导致文案分叉。

## 导入约定

- 全部使用相对导入；同目录引用不加多余前缀，跨目录按相对深度书写。
- `components/` 以目录导入（`from '../components'` 解析到 `index.tsx`）。
