# Dental Clinic V2 UI 翻新与统一 —— 最终版提示词

> 用法：新建会话（工作区 D:\Desktop\rongyi，预设 Router Standard，模型 deepseek-v4-pro），
> 粘贴下方【提示词正文】后发送。
>
> 两轮策略（推荐）：正文开头加一行「第一轮只执行阶段 0-1 并输出审计报告，等我确认后再继续」，
> 审阅报告同意后再让它跑完整流程。

---

## 提示词正文

对 Dental Clinic V2（apps/v2，Electron + React 桌面应用）做一轮 UI 翻新与统一：
找出所有视觉不一致的页面/组件，重新设计并统一到同一套设计语言下。

【工作流程（按顺序执行）】

### 阶段 0：历史资产（先读再动）

- 读取 docs/audits 下与 UI/前端相关的历史审计报告、优化报告、多维度评分报告，
  整理已知的视觉问题清单，避免重复发现；把已知问题并入下面的不一致清单。

### 阶段 1：现状审计（redesign-existing-projects + design-taste-frontend）

审计范围：apps/v2/src/web/pages 下全部 52 个生产页面/组件，按模块逐个过：

- auth：LoginPage
- appointments（4）：AppointmentsPage、AppointmentBoardPage、SchedulesPage、AppointmentPurposePanel
- clinical（8）：MedicalRecordsPage、VisitsPage、TreatmentsPage、PrescriptionsPage、FirstExamsPage、
  TreatmentPlansPage、CephalometricPage、ImagingPage
- finance（6）：ChargesPage、RefundsPage、MemberCardsPage、MemberCardPlanDialog、
  MemberCardQuoteDialog、FinanceWorkflowPage
- inventory（7）：InventoryPage、InventoryReportPanel、PurchaseOrdersPage、ProcessingOrdersPage、
  ProcessingFlowDialog、ProcessingSettleDialog、DispenseWorkbenchPage
- patients（3）：PatientsPage、PatientTimelinePage、PatientWorkflowPage
- communication（5）：FollowUpsPage、FollowUpReportPage、FollowUpExecutionDialog、
  WechatTemplateLibrary、WechatReminderSettings
- analytics（3）：DashboardPage、AnalyticsDashboardPage、ClinicOverviewPage
- system（8）：UsersPage、PermissionsPage、CustomFieldsPage、BackupsPage、SystemOperationsPage、
  SyncConflictsPage、GlobalSearchPage、ChangeOwnPasswordForm、DesktopSettingsPage
- hr（2）：CommissionPage、HrWorkflowPage
- front-desk（1）：FrontDeskWorkflowPage
- 注：CommunicationWorkflowPage、InventoryWorkflowPage、ClinicalWorkflowPage 计入对应模块的
  WorkflowPage 专项（共 7 个 WorkflowPage：Clinical/Finance/FrontDesk/Hr/Inventory/Patient/Communication）

每个页面记录：是否使用 token、野生样式数量、间距/圆角/字号是否偏离、交互态是否齐全、
暗色模式是否正常。特殊关注：CephalometricPage（画布）、ImagingPage（影像）、
AppointmentBoardPage（看板）、GlobalSearchPage（全局搜索）——定制密集，最易偏离。

输出「不一致清单」，按影响面排序（全局高频组件 > 高频页面 > 低频页面 > 特殊页面）。

### 阶段 2：确立设计方向（brainstorming + high-end-visual-design）

- 先确认基调再动手：现有 teal 主色（--primary: #0D8282）与医疗专业风是否保留；
  如需要可提问澄清，但不要反复追问
- 定出视觉支柱：字体体系（Segoe UI/微软雅黑回退链）、间距刻度（4px 基）、
  圆角体系（现有 --radius 系列）、阴影层级（--shadow 系列）、状态色
- 写出简短设计原则（信息密度优先、医疗专业感、明暗双主题均成立）

### 阶段 3：设计系统对齐（design-system + ui-styling）

- 三层 token：从现有语义变量反推 Primitive 色阶层（--teal-50..900 等），
  语义层改为引用 primitive，高频组件建立组件层 token（--btn-* / --card-* / --table-*）
- 对高频组件（按钮/输入框/表格/对话框/标签/空状态/分页）建立状态矩阵：
  默认/hover/active/disabled/focus
- 尽量复用现有变量名，避免破坏性改名（styles.css 已有 80+ 变量，两套主题齐全）

### 阶段 4：交互一致性（与视觉同等重要）

- 加载态：spinner/骨架屏/禁用态全应用统一
- 空状态：无数据占位样式与文案统一
- 错误提示：表单校验错误、请求失败 toast、错误边界的样式一致
- 确认对话框：删除/危险操作确认框统一（含文案语气）
- 表格：表头、行高、分页控件、hover 高亮统一
- 表单控件：输入框/下拉/日期选择器/开关的 focus 态统一

### 阶段 5：桌面端细节（Electron 特有）

- 窗口缩放适配：1280x800 / 1920x1080 / 高 DPI 下布局正常
- 滚动条样式统一（暗色模式同样检查）
- 打印/PDF 导出视图干净（收费单、处方等）
- 中文环境字体回退链正确

### 阶段 6：实施翻新

- 优先统一高频全局组件，再逐页翻新；每改完一组就跑测试
- 顺带完成 IA 微调：SystemOperationsPage（系统管理）内部 9 个入口
  （用户/权限/改密码/备份/同步冲突/系统操作/自定义字段/桌面设置/全局搜索）
  按用途分组归类展示（如：账号与权限 / 数据与备份 / 个性化设置），
  仅做页面内 tab 或卡片分组，不改路由、不改权限模型、不改菜单层级
- 消灭野生硬编码：颜色/间距/圆角/阴影全部走 token
  （用户可配置色除外：日程模板色、预约目的色、头影测量轮廓/折线色）
- 亮/暗双主题都保持正确；可访问性不退化（对比度、focus 可见、键盘可达、aria）

### 阶段 7：视觉验证与迭代（必须）

- 用 playwright 对关键页面截图：Login / Dashboard / Appointments / Charges / Patients /
  Inventory / Clinical(MedicalRecords) / Cephalometric / AppointmentBoard / Settings
- 亮色 + 暗色各截一套，逐张检查：对齐、留白、层级、一致性、溢出、对比度
- 不满意就迭代，直到整体协调统一

【硬性约束】

- 不改变任何业务逻辑、接口、数据流；只动表现层
- 全量测试保持绿：pnpm --filter @dental/v2 test / test:coverage:web
- typecheck、lint、knip 不新增告警
- 新增 CSS 变量全部在 styles.css 集中声明，禁止散落
- 中文界面文案不随意改动

【交付】

1. 不一致清单与设计方向说明 → docs/audits/ui-redesign-统一方案.md
2. 变更文件清单
3. playwright 截图对比（关键页面，亮/暗各一套，前后对照）
4. 每个页面的统一性检查结论表（52 页逐页结论）
