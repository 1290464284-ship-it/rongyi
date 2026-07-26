# AGENTS.md — @dental/web (React 前端)

## 模块结构

```
src/
├── main.tsx                   # 入口
├── App.tsx                    # 根组件
├── index.css                  # 全局样式（Tailwind）
├── components/                # 公共组件
│   ├── layout/                # 布局（AppLayout, Sidebar, Topbar, AnimatedRoute）
│   ├── patient/               # 患者相关（PatientSelector, Timeline）
│   ├── tooth/                 # 牙位图（ToothChart — SVG FDI 32 牙）
│   ├── ui/                    # 基础 UI 组件（button, card, dialog, input, table, loading...）
│   ├── ErrorBoundary.tsx
│   ├── GlobalLoading.tsx
│   ├── SearchModal.tsx
│   └── NotFoundPage.tsx
├── lib/                       # 工具库
│   ├── api/                   # API 调用层（按领域分目录）
│   │   ├── api.ts             # Axios 实例 + 拦截器
│   │   ├── query-client.ts    # TanStack Query 配置
│   │   ├── clinical/          # 临床相关 API
│   │   ├── communication/     # 沟通相关 API
│   │   ├── content/           # 内容相关 API
│   │   ├── financial/         # 财务相关 API
│   │   ├── inventory/         # 库存相关 API
│   │   ├── patients/          # 患者 API
│   │   └── system/            # 系统 API
│   ├── hooks/                 # 自定义 Hooks（use-crud）
│   ├── store/                 # Zustand 状态（auth-store）
│   ├── types/                 # 前端类型定义
│   ├── utils/                 # 工具函数（安全、Toast）
│   ├── app-routes.ts          # 路由配置
│   ├── auth.ts                # 认证工具
│   └── constants.ts           # 常量
└── modules/                   # 页面模块（按业务域）
    ├── auth/                  # 登录页
    ├── patient/               # 患者列表/详情/表单
    ├── appointment/           # 预约日历
    ├── clinical/              # 临床（口检面板、牙周面板）
    ├── first-exams/           # 初诊
    ├── medical-records/       # 病历
    ├── treatment-plan/        # 治疗方案
    ├── registration/          # 挂号
    ├── charge/                # 收费（旧版）
    ├── charge-v2/             # 收费 V2（组合、欠费、支付方式）
    ├── finance/               # 会员卡
    ├── inventory/             # 库存 + 采购
    ├── processing-orders/     # 加工单
    ├── imaging/               # 影像
    ├── prescription/          # 处方
    ├── follow-ups/            # 随访（工作台、模板、自动规则、统计）
    ├── wechat/                # 微信
    ├── equipment/             # 设备
    ├── dashboard/             # 仪表盘
    ├── report/                # 报表（ECharts 图表）
    ├── staff/                 # 员工管理
    └── settings/              # 设置（备份、操作日志、价目表）
```

## 模块所有者速查

| 要做什么 | 去哪里 |
|---------|--------|
| 登录/认证 | `modules/auth/` + `lib/store/auth-store.ts` |
| 患者列表/详情 | `modules/patient/` |
| 预约日历 | `modules/appointment/` |
| 临床面板 | `modules/clinical/` |
| 初诊管理 | `modules/first-exams/` |
| 病历 | `modules/medical-records/` |
| 治疗方案 | `modules/treatment-plan/` |
| 挂号 | `modules/registration/` |
| 收费 | `modules/charge-v2/`（新版）或 `modules/charge/`（旧版） |
| 会员卡 | `modules/finance/` |
| 库存/采购 | `modules/inventory/` |
| 加工单 | `modules/processing-orders/` |
| 影像 | `modules/imaging/` |
| 处方 | `modules/prescription/` |
| 随访 | `modules/follow-ups/` |
| 微信 | `modules/wechat/` |
| 设备 | `modules/equipment/` |
| 仪表盘 | `modules/dashboard/` |
| 报表/图表 | `modules/report/` |
| 员工 | `modules/staff/` |
| 系统设置 | `modules/settings/` |
| API 调用 | `lib/api/<领域>/` |
| 路由配置 | `lib/app-routes.ts` |
| 公共 UI 组件 | `components/ui/` |
| 布局/导航 | `components/layout/` |
| 牙位图 | `components/tooth/ToothChart.tsx` |

## 验证命令

```bash
pnpm build             # TypeScript 编译 + Vite 构建
pnpm lint              # ESLint 检查
pnpm test:e2e          # Playwright E2E 测试
pnpm dev               # Vite 开发服务器 (port 5173)
```

## 关键约束

1. **技术栈**：React 19 + TypeScript + Vite + TailwindCSS 4 + TanStack Query + Zustand + React Router 7。
2. **API 层**：所有后端通信通过 `lib/api/` 中的 Axios 封装，不直接在组件中 fetch。
3. **状态管理**：全局状态用 Zustand（`lib/store/`），服务端状态用 TanStack Query。
4. **表单验证**：使用 react-hook-form + zod schema。
5. **UI 组件**：优先使用 `components/ui/` 中的基础组件，样式用 Tailwind + tailwind-merge。
6. **路由**：集中定义在 `lib/app-routes.ts`，使用 React Router。
7. **主题**：暖石色调（背景 `#FAFAF9`，主色 teal `#0F766E`）。
8. **语言**：UI 文案中文，代码标识符英文。
9. **Electron 兼容**：构建产物须兼容 Electron 加载（`dist-web/`）。
10. **共享类型**：从 `@dental/shared` 导入跨端类型，不重复定义。

## 禁止事项

- ❌ 不在组件中直接调用 `fetch` / `axios` — 使用 `lib/api/` 封装
- ❌ 不引入新的 UI 框架（如 Ant Design、MUI）— 使用现有 Tailwind + 自定义组件
- ❌ 不在前端存储敏感数据（除 localStorage 中的 auth token）
- ❌ 不直接操作 DOM — 使用 React ref
- ❌ 不修改 `electron/` 目录除非明确需要桌面端变更
- ❌ 不跳过 TypeScript 类型（避免 `any`）
- ❌ 不在 `modules/` 外创建页面级组件
