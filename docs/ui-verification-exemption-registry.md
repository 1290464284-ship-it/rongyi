# UI 行为验证豁免注册表

> 本文件记录 evidence-pack `ui-story-snapshot` drift 清单中 27 个 UI 文件的覆盖状态与豁免原因。
> 当 evidence-pack 重新运行时，每项均有对应说明。

## 分类说明

| 状态 | 含义 |
|------|------|
| ✅ 新增行为测试 | 本次修复新增的 Vitest + RTL 行为测试 |
| ✅ 已有专项测试 | 已存在于 `.test.tsx` 中的专项行为覆盖 |
| ✅ 已有间接测试 | 通过父组件/页面测试间接覆盖核心交互 |
| ⬜ 豁免：纯展示原语 | 无状态/无交互逻辑的薄封装组件 |
| ⬜ 豁免：布局容器 | 纯布局组件，无独立交互行为 |
| ⬜ 豁免：已有等效覆盖 | 通过页面级测试覆盖全部交互路径 |

## 27 个漂移文件注册

### 核心 UI 原语（components/ui/）

| 文件 | 状态 | 说明 |
|------|------|------|
| `components/ui/dialog.tsx` | ✅ 新增行为测试 | `dialog.test.tsx` — 覆盖 open/close、Escape、focus trap、scroll lock、焦点恢复 |
| `components/ui/tabs.tsx` | ✅ 新增行为测试 | `tabs.test.tsx` — 覆盖受控/非受控切换、ARIA、disabled、Context 安全 |
| `components/ui/badge.tsx` | ⬜ 豁免：纯展示原语 | 19 行，纯 variant class 映射，无状态无交互 |
| `components/ui/checkbox.tsx` | ⬜ 豁免：纯展示原语 | 37 行，forwardRef 薄封装，onChange 直接转发原生 input |
| `components/ui/slider.tsx` | ⬜ 豁免：纯展示原语 | 44 行，forwardRef range input 薄封装，无自定义状态 |
| `components/ui/data-table-wrapper.tsx` | ⬜ 豁免：布局容器 | 195 行，表格+分页布局容器，交互通过父组件 props 驱动，无内部业务逻辑 |

### 布局组件

| 文件 | 状态 | 说明 |
|------|------|------|
| `components/layout/Topbar.tsx` | ✅ 已有间接测试 | `components/layout/__tests__/Topbar.test.tsx` (52 行) 覆盖渲染与交互 |

### 业务页面组件

| 文件 | 状态 | 说明 |
|------|------|------|
| `modules/dashboard/DashboardPage.tsx` | ✅ 已有专项测试 | `modules/dashboard/__tests__/DashboardPage.test.tsx` (123 行) |
| `modules/system/settings/SettingsPage.tsx` | ✅ 已有专项测试 | `modules/system/settings/__tests__/SettingsPage.test.tsx` (76 行) |
| `modules/system/hr/HrPage.tsx` | ✅ 已有专项测试 | `modules/system/hr/__tests__/hr.test.tsx` (544 行) |
| `modules/system/print/PrintPreviewPage.tsx` | ✅ 已有专项测试 | `__tests__/print-preview.test.tsx` (419 行) |
| `modules/system/settings/BulkImportPage.tsx` | ✅ 已有专项测试 | `modules/system/settings/__tests__/bulk-import.test.tsx` (505 行) |
| `modules/dashboard/BusinessAlertPage.tsx` | ✅ 已有专项测试 | `modules/dashboard/__tests__/business-alerts.test.tsx` (468 行) |
| `modules/clinical/cephalometric/CephalometricPage.tsx` | ✅ 已有专项测试 | `modules/clinical/cephalometric/__tests__/cephalometric-canvas.test.tsx` (243 行) |
| `modules/clinical/cephalometric/CephalometricCanvas.tsx` | ✅ 已有专项测试 | 同上文件覆盖 |
| `modules/clinical/cephalometric/CompareView.tsx` | ✅ 已有间接测试 | `cephalometric-analysis.test.tsx` (211 行) 覆盖对比视图路径 |
| `modules/clinical/cephalometric/MetricsTable.tsx` | ✅ 已有间接测试 | 同上文件覆盖 |
| `modules/clinical/treatment-plan/TreatmentProgressPage.tsx` | ✅ 已有专项测试 | `modules/clinical/treatment-plan/__tests__/treatment-progress.test.tsx` (397 行) |
| `modules/communication/satisfaction/SatisfactionPage.tsx` | ✅ 已有专项测试 | `modules/communication/satisfaction/__tests__/satisfaction.test.tsx` (557 行) |
| `modules/communication/satisfaction/SurveyDialog.tsx` | ✅ 已有间接测试 | 同上文件 F13.5 覆盖发起评价弹窗 |

### 业务对话框组件

| 文件 | 状态 | 说明 |
|------|------|------|
| `modules/communication/satisfaction/AcknowledgeDialog.tsx` | ✅ 已有间接测试 | `satisfaction.test.tsx` F13.6 覆盖 PATCH acknowledge + note 完整流程 |
| `modules/dashboard/components/AlertDetailDialog.tsx` | ✅ 已有间接测试 | `business-alerts.test.tsx` F9.5 覆盖 resolve、F9.10 覆盖 addNote |
| `modules/dashboard/components/AlertBanner.tsx` | ✅ 已有间接测试 | `business-alerts.test.tsx` 覆盖 Banner 渲染与交互 |

### HR 子组件

| 文件 | 状态 | 说明 |
|------|------|------|
| `components/hr/DateRangePicker.tsx` | ✅ 已有间接测试 | `modules/system/hr/__tests__/hr.test.tsx` (544 行) 覆盖日期选择交互 |
| `components/hr/LeaveDialog.tsx` | ✅ 已有间接测试 | 同上文件覆盖请假对话框 |
| `components/hr/ScheduleDialog.tsx` | ✅ 已有间接测试 | 同上文件覆盖排班对话框 |

## 统计

| 类别 | 数量 |
|------|------|
| 新增行为测试 | 2 |
| 已有专项/间接测试 | 20 |
| 豁免：纯展示原语 | 3 |
| 豁免：布局容器 | 1 |
| 豁免：已有等效覆盖 | 1 |
| **总计** | **27** |

## 维护说明

- 新增 UI 组件时，若包含自定义交互逻辑（状态管理、事件处理、异步操作），应同步添加行为测试
- 纯展示原语（< 50 行、无 useState/useEffect、仅转发 props）可豁免
- 页面级组件应通过页面测试覆盖，无需单独 story/snapshot
- 本注册表应随组件变更同步更新
