# UI Primitives

以下组件是公开导出的 UI 原语库，带有独立组件测试，供业务页面按需接入：

- `BatchBar`：批量操作条（归档/导出/删除）。
- `DateRange`：日期范围选择。
- `Drawer`：侧滑抽屉（Escape/遮罩/关闭动画）。
- `Dropdown`：菜单（键盘导航、焦点还原、外部点击关闭）。
- `MultiSelect`：多选下拉（listbox + active-descendant 键盘导航）。
- `Segmented`：分段单选。
- `Steps`：步骤条。
- `Switch`：开关。

这些组件当前没有业务调用方，但属于有意保留的公共原语，不是死代码；新增功能时应优先复用，
避免再造一份风格不一致的实现。
