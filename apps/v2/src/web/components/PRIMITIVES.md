# UI Primitives

以下组件是公开导出的 UI 原语库，带有独立组件测试，供业务页面按需接入：

- `Dialog` / `ConfirmDialog` / `PromptDialog`：弹窗三件套（焦点陷阱、Escape/遮罩/关闭按钮统一出口、关闭动画、submitting 防双发）。
- `DataTable`：共享数据表（500 行上限 + 滚动增量渲染 + sticky 表头）。
- `LoadingState` / `EmptyState` / `PageError` / `QuerySection` / `QueryBoundary`：统一的加载/空/错误状态族。
- `Tooltip`：键盘焦点态与 hover 双触发。
- `KanbanBoard`、`Timeline`、`Tree`、`Progress`、`UploadPreview`、`DentalChart`、`SearchableSelect`、`SignedImage`：业务接入的通用组件（对应 `.ui-*` CSS 家族保留在 styles.css）。

> 历史说明（2026-08 UI 统一第二轮 A5）：早期 PRIMITIVES.md 曾登记
> `BatchBar/DateRange/Drawer/Dropdown/MultiSelect/Segmented/Steps/Switch` 为「有意保留的原语」，
> 但经全库核对这些组件**从未存在实现文件、零业务调用方**，其孤儿 CSS（`.ui-drawer-*`、
> `.ui-switch`、`.ui-segmented`、`.ui-accordion`、`.ui-steps`、`.ui-dropdown*`、
> `.ui-multiselect*`、`.ui-date-range`、`.ui-chip` 及 uiMenu/uiDrawer keyframes）
> 已从 styles.css 删除（批次内不留死样式）。后续如需要这些交互，按既有 `.ui-*` 命名规范
> 新增组件文件与对应 CSS，并同步更新本文件，避免再次出现「文档声明存在、代码不存在」的漂移。
