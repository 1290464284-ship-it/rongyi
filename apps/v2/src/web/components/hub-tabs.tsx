import { lazy, useMemo, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { DataTable, LoadingState, PageError } from './index';
import { formatMoney } from '../lib/format';
import { ResourcePage } from './ResourcePage';

const AppointmentsPage = lazy(() => import('../pages/appointments/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const AppointmentBoardPage = lazy(() => import('../pages/appointments/AppointmentBoardPage').then((m) => ({ default: m.AppointmentBoardPage })));
const PatientTimelinePage = lazy(() => import('../pages/patients/PatientTimelinePage').then((m) => ({ default: m.PatientTimelinePage })));
const ChargesPage = lazy(() => import('../pages/finance/ChargesPage').then((m) => ({ default: m.ChargesPage })));
const InventoryPage = lazy(() => import('../pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const FollowUpsPage = lazy(() => import('../pages/communication/FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })));
const BackupsPage = lazy(() => import('../pages/system/BackupsPage').then((m) => ({ default: m.BackupsPage })));
const DesktopSettingsPage = lazy(() => import('../pages/system/DesktopSettingsPage').then((m) => ({ default: m.DesktopSettingsPage })));
const ClinicalWorkflowPage = lazy(() => import('../pages/clinical/ClinicalWorkflowPage').then((m) => ({ default: m.ClinicalWorkflowPage })));
const HrWorkflowPage = lazy(() => import('../pages/hr/HrWorkflowPage').then((m) => ({ default: m.HrWorkflowPage })));
const SchedulesPage = lazy(() => import('../pages/appointments/SchedulesPage').then((m) => ({ default: m.SchedulesPage })));
const PermissionsPage = lazy(() => import('../pages/system/PermissionsPage').then((m) => ({ default: m.PermissionsPage })));
const FinanceWorkflowPage = lazy(() => import('../pages/finance/FinanceWorkflowPage').then((m) => ({ default: m.FinanceWorkflowPage })));
const SystemOperationsPage = lazy(() => import('../pages/system/SystemOperationsPage').then((m) => ({ default: m.SystemOperationsPage })));
const InventoryWorkflowPage = lazy(() => import('../pages/inventory/InventoryWorkflowPage').then((m) => ({ default: m.InventoryWorkflowPage })));
const CommunicationWorkflowPage = lazy(() => import('../pages/communication/CommunicationWorkflowPage').then((m) => ({ default: m.CommunicationWorkflowPage })));
const FollowUpReportPage = lazy(() => import('../pages/communication/FollowUpReportPage').then((m) => ({ default: m.FollowUpReportPage })));
const PatientWorkflowPage = lazy(() => import('../pages/patients/PatientWorkflowPage').then((m) => ({ default: m.PatientWorkflowPage })));
const ClinicOverviewPage = lazy(() => import('../pages/analytics/ClinicOverviewPage').then((m) => ({ default: m.ClinicOverviewPage })));
const UsersPage = lazy(() => import('../pages/system/UsersPage').then((m) => ({ default: m.UsersPage })));
const CustomFieldsPage = lazy(() => import('../pages/system/CustomFieldsPage').then((m) => ({ default: m.CustomFieldsPage })));
const SyncConflictsPage = lazy(() => import('../pages/system/SyncConflictsPage').then((m) => ({ default: m.SyncConflictsPage })));
const PatientsPage = lazy(() => import('../pages/patients/PatientsPage').then((m) => ({ default: m.PatientsPage })));
const VisitsPage = lazy(() => import('../pages/clinical/VisitsPage').then((m) => ({ default: m.VisitsPage })));
const FirstExamsPage = lazy(() => import('../pages/clinical/FirstExamsPage').then((m) => ({ default: m.FirstExamsPage })));
const ImagingPage = lazy(() => import('../pages/clinical/ImagingPage').then((m) => ({ default: m.ImagingPage })));
const MemberCardsPage = lazy(() => import('../pages/finance/MemberCardsPage').then((m) => ({ default: m.MemberCardsPage })));
const MedicalRecordsPage = lazy(() => import('../pages/clinical/MedicalRecordsPage').then((m) => ({ default: m.MedicalRecordsPage })));
const PurchaseOrdersPage = lazy(() => import('../pages/inventory/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })));
const ProcessingOrdersPage = lazy(() => import('../pages/inventory/ProcessingOrdersPage').then((m) => ({ default: m.ProcessingOrdersPage })));
const TreatmentsPage = lazy(() => import('../pages/clinical/TreatmentsPage').then((m) => ({ default: m.TreatmentsPage })));
const PrescriptionsPage = lazy(() => import('../pages/clinical/PrescriptionsPage').then((m) => ({ default: m.PrescriptionsPage })));
const TreatmentPlansPage = lazy(() => import('../pages/clinical/TreatmentPlansPage').then((m) => ({ default: m.TreatmentPlansPage })));
const CephalometricPage = lazy(() => import('../pages/clinical/CephalometricPage').then((m) => ({ default: m.CephalometricPage })));
const AnalyticsDashboardPage = lazy(() => import('../pages/analytics/AnalyticsDashboardPage').then((m) => ({ default: m.AnalyticsDashboardPage })));
const RefundsPage = lazy(() => import('../pages/finance/RefundsPage').then((m) => ({ default: m.RefundsPage })));
const DispenseWorkbenchPage = lazy(() => import('../pages/inventory/DispenseWorkbenchPage').then((m) => ({ default: m.DispenseWorkbenchPage })));
const CommissionPage = lazy(() => import('../pages/hr/CommissionPage').then((m) => ({ default: m.CommissionPage })));
const FrontDeskWorkflowPage = lazy(() => import('../pages/front-desk/FrontDeskWorkflowPage').then((m) => ({ default: m.FrontDeskWorkflowPage })));

export function CostShareTab() {
  const query = useQuery({
    queryKey: ['stats', 'cost-share'],
    queryFn: () => apiRequest<{ rows: Array<Record<string, unknown>>; summary: { SERVICE?: { total: number; itemCount: number; chargeCount: number }; MATERIAL?: { total: number; itemCount: number; chargeCount: number }; grandTotal?: number } }>('/stats/cost-share'),
  });
  const { rows, summary } = query.data ?? { rows: [], summary: {} };
  const tableRows = useMemo(
    () => rows.map((row) => ({ ...row, id: `${row.costType}-${row.category}` })),
    [rows],
  );
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const columns = [
    { key: 'costType', label: '类型', render: (row: Record<string, unknown>) => (row.costType === 'SERVICE' ? '技术服务' : row.costType === 'MATERIAL' ? '材料耗材' : String(row.costType ?? '')) },
    { key: 'category', label: '分类' },
    { key: 'total', label: '金额', render: (row: Record<string, unknown>) => formatMoney(row.total) },
    { key: 'itemCount', label: '明细数' },
    { key: 'chargeCount', label: '收费单数' },
  ];
  return (
    <div className="page">
      <h1>技耗分账统计</h1>
      <div className="inline-form">
        <span>技术服务合计：{formatMoney(summary.SERVICE?.total ?? 0)}（{summary.SERVICE?.itemCount ?? 0} 明细 / {summary.SERVICE?.chargeCount ?? 0} 单）</span>
        <span>材料耗材合计：{formatMoney(summary.MATERIAL?.total ?? 0)}（{summary.MATERIAL?.itemCount ?? 0} 明细 / {summary.MATERIAL?.chargeCount ?? 0} 单）</span>
        <span>总计：{formatMoney(summary.grandTotal ?? 0)}</span>
      </div>
      <DataTable columns={columns} rows={tableRows} keyField="id" emptyText="暂无收费明细数据" />
    </div>
  );
}

export type HubTab =
  | { id: string; label: string; kind: 'resource'; resource: string; bossOnly?: boolean; group?: string; searchTab?: boolean }
  | { id: string; label: string; kind: 'custom'; component: ComponentType<{ initialSearch?: string }>; bossOnly?: boolean; group?: string; searchTab?: boolean };

export const patientHubTabs: HubTab[] = [
  { id: 'patients', label: '患者档案', kind: 'custom', component: PatientsPage, searchTab: true },
  { id: 'timeline', label: '时间线', kind: 'custom', component: PatientTimelinePage },
  { id: 'workflow', label: '风险评分', kind: 'custom', component: PatientWorkflowPage },
  { id: 'family', label: '家属联系人', kind: 'resource', resource: 'familyMembers' },
];

export const frontDeskHubTabs: HubTab[] = [
  { id: 'workflow', label: '挂号分诊', kind: 'custom', component: FrontDeskWorkflowPage },
  { id: 'appointments', label: '预约', kind: 'custom', component: AppointmentsPage, searchTab: true },
  { id: 'appointmentBoard', label: '预约看板', kind: 'custom', component: AppointmentBoardPage },
  { id: 'departments', label: '分诊科室', kind: 'resource', resource: 'departments' },
];

export const clinicalHubTabs: HubTab[] = [
  { id: 'workflow', label: '工作流', kind: 'custom', component: ClinicalWorkflowPage, group: '常用' },
  { id: 'visits', label: '就诊', kind: 'custom', component: VisitsPage, group: '常用' },
  { id: 'firstExams', label: '首诊', kind: 'custom', component: FirstExamsPage, group: '常用' },
  { id: 'treatments', label: '治疗', kind: 'custom', component: TreatmentsPage, group: '常用' },
  { id: 'records', label: '病历', kind: 'custom', component: MedicalRecordsPage, group: '资料' },
  { id: 'plans', label: '治疗计划', kind: 'custom', component: TreatmentPlansPage, group: '资料' },
  { id: 'imaging', label: '影像', kind: 'custom', component: ImagingPage, group: '资料' },
  { id: 'cephalometric', label: '头影测量', kind: 'custom', component: CephalometricPage, group: '资料' },
  { id: 'prescriptions', label: '处方', kind: 'custom', component: PrescriptionsPage, group: '资料' },
];

export const financeHubTabs: HubTab[] = [
  { id: 'workflow', label: '收银', kind: 'custom', component: FinanceWorkflowPage },
  { id: 'charges', label: '收费', kind: 'custom', component: ChargesPage, searchTab: true },
  { id: 'memberCards', label: '会员卡', kind: 'custom', component: MemberCardsPage },
  { id: 'treatmentCatalogs', label: '收费项目', kind: 'resource', resource: 'treatmentCatalogs', bossOnly: true },
  { id: 'payMethods', label: '缴费方式', kind: 'resource', resource: 'payMethods' },
  { id: 'refunds', label: '退款', kind: 'custom', component: RefundsPage },
  { id: 'debts', label: '欠费', kind: 'resource', resource: 'debtRecords' },
  { id: 'invoices', label: '发票', kind: 'resource', resource: 'invoices' },
];

export const inventoryHubTabs: HubTab[] = [
  { id: 'items', label: '库存工作台', kind: 'custom', component: InventoryPage, group: '常用' },
  { id: 'pharmacy', label: '药房工作台', kind: 'custom', component: DispenseWorkbenchPage, group: '常用' },
  { id: 'workflow', label: '采购工作台', kind: 'custom', component: InventoryWorkflowPage, group: '常用' },
  { id: 'itemMaster', label: '库存项目', kind: 'resource', resource: 'inventoryItems', group: '资料', searchTab: true },
  { id: 'suppliers', label: '供应商', kind: 'resource', resource: 'suppliers', group: '资料' },
  { id: 'purchaseOrders', label: '采购单', kind: 'custom', component: PurchaseOrdersPage, group: '资料' },
  { id: 'processingOrders', label: '加工单', kind: 'custom', component: ProcessingOrdersPage, group: '资料' },
  { id: 'inventoryDocs', label: '退回/库损单', kind: 'resource', resource: 'inventoryDocs', group: '资料' },
];

export const communicationHubTabs: HubTab[] = [
  { id: 'workflow', label: '微信发送', kind: 'custom', component: CommunicationWorkflowPage, group: '常用' },
  { id: 'followUps', label: '随访', kind: 'custom', component: FollowUpsPage, group: '常用' },
  { id: 'followUpReport', label: '到诊率', kind: 'custom', component: FollowUpReportPage, group: '资料' },
  { id: 'followUpDicts', label: '回访词典', kind: 'resource', resource: 'followUpDicts', group: '资料' },
  { id: 'followUpTemplates', label: '随访模板', kind: 'resource', resource: 'followUpTemplates', group: '资料' },
  { id: 'wechat', label: '微信消息', kind: 'resource', resource: 'wechatMessages', group: '资料' },
  { id: 'satisfaction', label: '满意度', kind: 'resource', resource: 'satisfactionSurveys', group: '资料' },
];

export const hrHubTabs: HubTab[] = [
  { id: 'workflow', label: '审批', kind: 'custom', component: HrWorkflowPage, group: '常用' },
  { id: 'staff', label: '员工', kind: 'custom', component: UsersPage, group: '常用' },
  { id: 'schedules', label: '排班', kind: 'custom', component: SchedulesPage, group: '常用' },
  { id: 'attendance', label: '考勤', kind: 'resource', resource: 'attendance', group: '常用' },
  { id: 'leaves', label: '请假', kind: 'resource', resource: 'leaveRequests', group: '常用' },
  { id: 'commission', label: '提成', kind: 'custom', component: CommissionPage, bossOnly: true, group: '绩效' },
  { id: 'anomalies', label: '医生异常', kind: 'custom', component: () => <ResourcePage title={'医生异常'} endpoint="/analytics/doctor-anomalies" />, group: '绩效' },
  { id: 'permissions', label: '权限', kind: 'custom', component: PermissionsPage, group: '配置' },
  { id: 'equipment', label: '设备', kind: 'resource', resource: 'equipment', group: '配置' },
];

export const systemHubTabs: HubTab[] = [
  { id: 'backups', label: '备份', kind: 'custom', component: BackupsPage, group: '运维' },
  { id: 'alerts', label: '告警', kind: 'resource', resource: 'businessAlerts', group: '运维' },
  { id: 'logs', label: '操作日志', kind: 'resource', resource: 'operationLogs', group: '运维' },
  { id: 'sync', label: '同步记录', kind: 'resource', resource: 'syncChanges', group: '运维' },
  { id: 'syncConflicts', label: '同步冲突', kind: 'custom', component: SyncConflictsPage, group: '运维' },
  { id: 'importJobs', label: '导入任务', kind: 'resource', resource: 'dataImportJobs', group: '运维' },
  { id: 'desktop', label: '桌面端', kind: 'custom', component: DesktopSettingsPage, group: '配置' },
  { id: 'operations', label: '系统操作', kind: 'custom', component: SystemOperationsPage, group: '配置' },
  { id: 'settings', label: '设置', kind: 'resource', resource: 'settings', group: '配置' },
  { id: 'customFields', label: '自定义字段', kind: 'custom', component: CustomFieldsPage, group: '配置' },
  { id: 'printTemplates', label: '打印模板', kind: 'resource', resource: 'printTemplates', group: '配置' },
];

export const analyticsHubTabs: HubTab[] = [
  { id: 'dashboard', label: '经营报表', kind: 'custom', component: AnalyticsDashboardPage },
  { id: 'clinicOverview', label: '多门店', kind: 'custom', component: ClinicOverviewPage, bossOnly: true },
  { id: 'monthly', label: '月度报表', kind: 'custom', component: () => <ResourcePage title={'月度报表'} endpoint="/stats/revenue?groupBy=month" columnTypes={{ revenue: 'money' }} /> },
  { id: 'inventoryReport', label: '库存报表', kind: 'custom', component: () => <ResourcePage title={'库存报表'} endpoint="/stats/inventory" /> },
  { id: 'costShare', label: '分账统计', kind: 'custom', component: CostShareTab },
  { id: 'rfm', label: 'RFM', kind: 'custom', component: () => <ResourcePage title="RFM" endpoint="/analytics/rfm" /> },
  { id: 'churn', label: '流失预警', kind: 'custom', component: () => <ResourcePage title={'流失预警'} endpoint="/analytics/churn" /> },
];
