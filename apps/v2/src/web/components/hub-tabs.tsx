import { lazy, type ComponentType } from 'react';
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
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const { rows, summary } = query.data ?? { rows: [], summary: {} };
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
      <DataTable columns={columns} rows={rows.map((row) => ({ ...row, id: `${row.costType}-${row.category}` }))} keyField="id" emptyText="暂无收费明细数据" />
    </div>
  );
}

export type HubTab =
  | { id: string; label: string; kind: 'resource'; resource: string; bossOnly?: boolean; group?: string; searchTab?: boolean }
  | { id: string; label: string; kind: 'custom'; component: ComponentType<{ initialSearch?: string }>; bossOnly?: boolean; group?: string; searchTab?: boolean };

export const patientHubTabs: HubTab[] = [
  { id: 'patients', label: '\u60a3\u8005\u6863\u6848', kind: 'custom', component: PatientsPage, searchTab: true },
  { id: 'timeline', label: '\u65f6\u95f4\u7ebf', kind: 'custom', component: PatientTimelinePage },
  { id: 'workflow', label: '\u98ce\u9669\u8bc4\u5206', kind: 'custom', component: PatientWorkflowPage },
  { id: 'family', label: '\u5bb6\u5c5e\u8054\u7cfb\u4eba', kind: 'resource', resource: 'familyMembers' },
];

export const frontDeskHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u6302\u53f7\u5206\u8bca', kind: 'custom', component: FrontDeskWorkflowPage },
  { id: 'appointments', label: '\u9884\u7ea6', kind: 'custom', component: AppointmentsPage, searchTab: true },
  { id: 'appointmentBoard', label: '\u9884\u7ea6\u770b\u677f', kind: 'custom', component: AppointmentBoardPage },
  { id: 'departments', label: '\u5206\u8bca\u79d1\u5ba4', kind: 'resource', resource: 'departments' },
];

export const clinicalHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5de5\u4f5c\u6d41', kind: 'custom', component: ClinicalWorkflowPage, group: '\u5e38\u7528' },
  { id: 'visits', label: '\u5c31\u8bca', kind: 'custom', component: VisitsPage, group: '\u5e38\u7528' },
  { id: 'firstExams', label: '\u9996\u8bca', kind: 'custom', component: FirstExamsPage, group: '\u5e38\u7528' },
  { id: 'treatments', label: '\u6cbb\u7597', kind: 'custom', component: TreatmentsPage, group: '\u5e38\u7528' },
  { id: 'records', label: '\u75c5\u5386', kind: 'custom', component: MedicalRecordsPage, group: '\u8d44\u6599' },
  { id: 'plans', label: '\u6cbb\u7597\u8ba1\u5212', kind: 'custom', component: TreatmentPlansPage, group: '\u8d44\u6599' },
  { id: 'imaging', label: '\u5f71\u50cf', kind: 'custom', component: ImagingPage, group: '\u8d44\u6599' },
  { id: 'cephalometric', label: '\u5934\u5f71\u6d4b\u91cf', kind: 'custom', component: CephalometricPage, group: '\u8d44\u6599' },
  { id: 'prescriptions', label: '\u5904\u65b9', kind: 'custom', component: PrescriptionsPage, group: '\u8d44\u6599' },
];

export const financeHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u6536\u94f6', kind: 'custom', component: FinanceWorkflowPage },
  { id: 'charges', label: '\u6536\u8d39', kind: 'custom', component: ChargesPage, searchTab: true },
  { id: 'memberCards', label: '\u4f1a\u5458\u5361', kind: 'custom', component: MemberCardsPage },
  { id: 'treatmentCatalogs', label: '\u6536\u8d39\u9879\u76ee', kind: 'resource', resource: 'treatmentCatalogs', bossOnly: true },
  { id: 'payMethods', label: '\u7f34\u8d39\u65b9\u5f0f', kind: 'resource', resource: 'payMethods' },
  { id: 'refunds', label: '\u9000\u6b3e', kind: 'custom', component: RefundsPage },
  { id: 'debts', label: '\u6b20\u8d39', kind: 'resource', resource: 'debtRecords' },
  { id: 'invoices', label: '\u53d1\u7968', kind: 'resource', resource: 'invoices' },
];

export const inventoryHubTabs: HubTab[] = [
  { id: 'items', label: '\u5e93\u5b58\u5de5\u4f5c\u53f0', kind: 'custom', component: InventoryPage, group: '\u5e38\u7528', searchTab: true },
  { id: 'pharmacy', label: '\u836f\u623f\u5de5\u4f5c\u53f0', kind: 'custom', component: DispenseWorkbenchPage, group: '\u5e38\u7528' },
  { id: 'workflow', label: '\u91c7\u8d2d\u5de5\u4f5c\u53f0', kind: 'custom', component: InventoryWorkflowPage, group: '\u5e38\u7528' },
  { id: 'itemMaster', label: '\u5e93\u5b58\u9879\u76ee', kind: 'resource', resource: 'inventoryItems', group: '\u8d44\u6599' },
  { id: 'suppliers', label: '\u4f9b\u5e94\u5546', kind: 'resource', resource: 'suppliers', group: '\u8d44\u6599' },
  { id: 'purchaseOrders', label: '\u91c7\u8d2d\u5355', kind: 'custom', component: PurchaseOrdersPage, group: '\u8d44\u6599' },
  { id: 'processingOrders', label: '\u52a0\u5de5\u5355', kind: 'custom', component: ProcessingOrdersPage, group: '\u8d44\u6599' },
  { id: 'inventoryDocs', label: '\u9000\u56de/\u5e93\u635f\u5355', kind: 'resource', resource: 'inventoryDocs', group: '\u8d44\u6599' },
];

export const communicationHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5fae\u4fe1\u53d1\u9001', kind: 'custom', component: CommunicationWorkflowPage, group: '\u5e38\u7528' },
  { id: 'followUps', label: '\u968f\u8bbf', kind: 'custom', component: FollowUpsPage, group: '\u5e38\u7528' },
  { id: 'followUpReport', label: '\u5230\u8bca\u7387', kind: 'custom', component: FollowUpReportPage, group: '\u8d44\u6599' },
  { id: 'followUpDicts', label: '\u56de\u8bbf\u8bcd\u5178', kind: 'resource', resource: 'followUpDicts', group: '\u8d44\u6599' },
  { id: 'followUpTemplates', label: '\u968f\u8bbf\u6a21\u677f', kind: 'resource', resource: 'followUpTemplates', group: '\u8d44\u6599' },
  { id: 'wechat', label: '\u5fae\u4fe1\u6d88\u606f', kind: 'resource', resource: 'wechatMessages', group: '\u8d44\u6599' },
  { id: 'satisfaction', label: '\u6ee1\u610f\u5ea6', kind: 'resource', resource: 'satisfactionSurveys', group: '\u8d44\u6599' },
];

export const hrHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5ba1\u6279', kind: 'custom', component: HrWorkflowPage, group: '\u5e38\u7528' },
  { id: 'staff', label: '\u5458\u5de5', kind: 'custom', component: UsersPage, group: '\u5e38\u7528' },
  { id: 'schedules', label: '\u6392\u73ed', kind: 'custom', component: SchedulesPage, group: '\u5e38\u7528' },
  { id: 'attendance', label: '\u8003\u52e4', kind: 'resource', resource: 'attendance', group: '\u5e38\u7528' },
  { id: 'leaves', label: '\u8bf7\u5047', kind: 'resource', resource: 'leaveRequests', group: '\u5e38\u7528' },
  { id: 'commission', label: '\u63d0\u6210', kind: 'custom', component: CommissionPage, bossOnly: true, group: '\u7ee9\u6548' },
  { id: 'anomalies', label: '\u533b\u751f\u5f02\u5e38', kind: 'custom', component: () => <ResourcePage title={'\u533b\u751f\u5f02\u5e38'} endpoint="/analytics/doctor-anomalies" />, group: '\u7ee9\u6548' },
  { id: 'permissions', label: '\u6743\u9650', kind: 'custom', component: PermissionsPage, group: '\u914d\u7f6e' },
  { id: 'equipment', label: '\u8bbe\u5907', kind: 'resource', resource: 'equipment', group: '\u914d\u7f6e' },
];

export const systemHubTabs: HubTab[] = [
  { id: 'backups', label: '\u5907\u4efd', kind: 'custom', component: BackupsPage, group: '\u8fd0\u7ef4' },
  { id: 'alerts', label: '\u544a\u8b66', kind: 'resource', resource: 'businessAlerts', group: '\u8fd0\u7ef4' },
  { id: 'logs', label: '\u64cd\u4f5c\u65e5\u5fd7', kind: 'resource', resource: 'operationLogs', group: '\u8fd0\u7ef4' },
  { id: 'sync', label: '\u540c\u6b65\u8bb0\u5f55', kind: 'resource', resource: 'syncChanges', group: '\u8fd0\u7ef4' },
  { id: 'syncConflicts', label: '\u540c\u6b65\u51b2\u7a81', kind: 'custom', component: SyncConflictsPage, group: '\u8fd0\u7ef4' },
  { id: 'importJobs', label: '\u5bfc\u5165\u4efb\u52a1', kind: 'resource', resource: 'dataImportJobs', group: '\u8fd0\u7ef4' },
  { id: 'desktop', label: '\u684c\u9762\u7aef', kind: 'custom', component: DesktopSettingsPage, group: '\u914d\u7f6e' },
  { id: 'operations', label: '\u7cfb\u7edf\u64cd\u4f5c', kind: 'custom', component: SystemOperationsPage, group: '\u914d\u7f6e' },
  { id: 'settings', label: '\u8bbe\u7f6e', kind: 'resource', resource: 'settings', group: '\u914d\u7f6e' },
  { id: 'customFields', label: '\u81ea\u5b9a\u4e49\u5b57\u6bb5', kind: 'custom', component: CustomFieldsPage, group: '\u914d\u7f6e' },
  { id: 'printTemplates', label: '\u6253\u5370\u6a21\u677f', kind: 'resource', resource: 'printTemplates', group: '\u914d\u7f6e' },
];

export const analyticsHubTabs: HubTab[] = [
  { id: 'dashboard', label: '\u7ecf\u8425\u62a5\u8868', kind: 'custom', component: AnalyticsDashboardPage },
  { id: 'clinicOverview', label: '\u591a\u95e8\u5e97', kind: 'custom', component: ClinicOverviewPage, bossOnly: true },
  { id: 'monthly', label: '\u6708\u5ea6\u62a5\u8868', kind: 'custom', component: () => <ResourcePage title={'\u6708\u5ea6\u62a5\u8868'} endpoint="/stats/revenue?groupBy=month" /> },
  { id: 'inventoryReport', label: '\u5e93\u5b58\u62a5\u8868', kind: 'custom', component: () => <ResourcePage title={'\u5e93\u5b58\u62a5\u8868'} endpoint="/stats/inventory" /> },
  { id: 'costShare', label: '\u5206\u8d26\u7edf\u8ba1', kind: 'custom', component: CostShareTab },
  { id: 'rfm', label: 'RFM', kind: 'custom', component: () => <ResourcePage title="RFM" endpoint="/analytics/rfm" /> },
  { id: 'churn', label: '\u6d41\u5931\u9884\u8b66', kind: 'custom', component: () => <ResourcePage title={'\u6d41\u5931\u9884\u8b66'} endpoint="/analytics/churn" /> },
];
