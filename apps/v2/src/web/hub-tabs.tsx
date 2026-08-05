import { lazy, type ComponentType } from 'react';

const AppointmentsPage = lazy(() => import('./AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const AppointmentBoardPage = lazy(() => import('./AppointmentBoardPage').then((m) => ({ default: m.AppointmentBoardPage })));
const PatientTimelinePage = lazy(() => import('./PatientTimelinePage').then((m) => ({ default: m.PatientTimelinePage })));
const ChargesPage = lazy(() => import('./ChargesPage').then((m) => ({ default: m.ChargesPage })));
const InventoryPage = lazy(() => import('./InventoryPage').then((m) => ({ default: m.InventoryPage })));
const FollowUpsPage = lazy(() => import('./FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })));
const BackupsPage = lazy(() => import('./BackupsPage').then((m) => ({ default: m.BackupsPage })));
const SimpleListPage = lazy(() => import('./SimpleListPage').then((m) => ({ default: m.SimpleListPage })));
const DashboardPage = lazy(() => import('./DashboardPage').then((m) => ({ default: m.DashboardPage })));
const DesktopSettingsPage = lazy(() => import('./DesktopSettingsPage').then((m) => ({ default: m.DesktopSettingsPage })));
const ClinicalWorkflowPage = lazy(() => import('./ClinicalWorkflowPage').then((m) => ({ default: m.ClinicalWorkflowPage })));
const HrWorkflowPage = lazy(() => import('./HrWorkflowPage').then((m) => ({ default: m.HrWorkflowPage })));
const FinanceWorkflowPage = lazy(() => import('./FinanceWorkflowPage').then((m) => ({ default: m.FinanceWorkflowPage })));
const SystemOperationsPage = lazy(() => import('./SystemOperationsPage').then((m) => ({ default: m.SystemOperationsPage })));
const InventoryWorkflowPage = lazy(() => import('./InventoryWorkflowPage').then((m) => ({ default: m.InventoryWorkflowPage })));
const CommunicationWorkflowPage = lazy(() => import('./CommunicationWorkflowPage').then((m) => ({ default: m.CommunicationWorkflowPage })));
const FollowUpReportPage = lazy(() => import('./FollowUpReportPage').then((m) => ({ default: m.FollowUpReportPage })));
const PatientWorkflowPage = lazy(() => import('./PatientWorkflowPage').then((m) => ({ default: m.PatientWorkflowPage })));
const ClinicOverviewPage = lazy(() => import('./ClinicOverviewPage').then((m) => ({ default: m.ClinicOverviewPage })));
const UsersPage = lazy(() => import('./UsersPage').then((m) => ({ default: m.UsersPage })));
const PatientsPage = lazy(() => import('./PatientsPage').then((m) => ({ default: m.PatientsPage })));
const VisitsPage = lazy(() => import('./VisitsPage').then((m) => ({ default: m.VisitsPage })));
const FirstExamsPage = lazy(() => import('./FirstExamsPage').then((m) => ({ default: m.FirstExamsPage })));
const ImagingPage = lazy(() => import('./ImagingPage').then((m) => ({ default: m.ImagingPage })));
const MemberCardsPage = lazy(() => import('./MemberCardsPage').then((m) => ({ default: m.MemberCardsPage })));
const MedicalRecordsPage = lazy(() => import('./MedicalRecordsPage').then((m) => ({ default: m.MedicalRecordsPage })));
const PurchaseOrdersPage = lazy(() => import('./PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })));
const ProcessingOrdersPage = lazy(() => import('./ProcessingOrdersPage').then((m) => ({ default: m.ProcessingOrdersPage })));
const TreatmentsPage = lazy(() => import('./TreatmentsPage').then((m) => ({ default: m.TreatmentsPage })));
const PrescriptionsPage = lazy(() => import('./PrescriptionsPage').then((m) => ({ default: m.PrescriptionsPage })));
const TreatmentPlansPage = lazy(() => import('./TreatmentPlansPage').then((m) => ({ default: m.TreatmentPlansPage })));
const CephalometricPage = lazy(() => import('./CephalometricPage').then((m) => ({ default: m.CephalometricPage })));
const AnalyticsDashboardPage = lazy(() => import('./AnalyticsDashboardPage').then((m) => ({ default: m.AnalyticsDashboardPage })));

export type HubTab =
  | { id: string; label: string; kind: 'resource'; resource: string; bossOnly?: boolean }
  | { id: string; label: string; kind: 'custom'; component: ComponentType; bossOnly?: boolean };

export const patientHubTabs: HubTab[] = [
  { id: 'patients', label: '\u60a3\u8005\u6863\u6848', kind: 'custom', component: PatientsPage },
  { id: 'appointments', label: '\u9884\u7ea6', kind: 'custom', component: AppointmentsPage },
  { id: 'appointmentBoard', label: '\u9884\u7ea6\u770b\u677f', kind: 'custom', component: AppointmentBoardPage },
  { id: 'timeline', label: '\u65f6\u95f4\u7ebf', kind: 'custom', component: PatientTimelinePage },
  { id: 'workflow', label: '\u98ce\u9669\u8bc4\u5206', kind: 'custom', component: PatientWorkflowPage },
  { id: 'family', label: '\u5bb6\u5c5e\u8054\u7cfb\u4eba', kind: 'resource', resource: 'familyMembers' },
];

export const clinicalHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5de5\u4f5c\u6d41', kind: 'custom', component: ClinicalWorkflowPage },
  { id: 'visits', label: '\u5c31\u8bca', kind: 'custom', component: VisitsPage },
  { id: 'firstExams', label: '\u9996\u8bca', kind: 'custom', component: FirstExamsPage },
  { id: 'treatments', label: '\u6cbb\u7597', kind: 'custom', component: TreatmentsPage },
  { id: 'records', label: '\u75c5\u5386', kind: 'custom', component: MedicalRecordsPage },
  { id: 'plans', label: '\u6cbb\u7597\u8ba1\u5212', kind: 'custom', component: TreatmentPlansPage },
  { id: 'imaging', label: '\u5f71\u50cf', kind: 'custom', component: ImagingPage },
  { id: 'cephalometric', label: '\u5934\u5f71\u6d4b\u91cf', kind: 'custom', component: CephalometricPage },
  { id: 'prescriptions', label: '\u5904\u65b9', kind: 'custom', component: PrescriptionsPage },
];

export const financeHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u64cd\u4f5c', kind: 'custom', component: FinanceWorkflowPage },
  { id: 'charges', label: '\u6536\u8d39', kind: 'custom', component: ChargesPage },
  { id: 'memberCards', label: '\u4f1a\u5458\u5361', kind: 'custom', component: MemberCardsPage },
  { id: 'refunds', label: '\u9000\u6b3e', kind: 'resource', resource: 'refunds' },
  { id: 'debts', label: '\u6b20\u8d39', kind: 'resource', resource: 'debtRecords' },
  { id: 'invoices', label: '\u53d1\u7968', kind: 'resource', resource: 'invoices' },
];

export const inventoryHubTabs: HubTab[] = [
  { id: 'items', label: '\u5e93\u5b58', kind: 'custom', component: InventoryPage },
  { id: 'itemMaster', label: '\u5e93\u5b58\u9879\u76ee', kind: 'resource', resource: 'inventoryItems' },
  { id: 'workflow', label: '\u91c7\u8d2d\u52a0\u5de5', kind: 'custom', component: InventoryWorkflowPage },
  { id: 'suppliers', label: '\u4f9b\u5e94\u5546', kind: 'resource', resource: 'suppliers' },
  { id: 'purchaseOrders', label: '\u91c7\u8d2d\u5355', kind: 'custom', component: PurchaseOrdersPage },
  { id: 'processingOrders', label: '\u52a0\u5de5\u5355', kind: 'custom', component: ProcessingOrdersPage },
];

export const communicationHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5fae\u4fe1\u53d1\u9001', kind: 'custom', component: CommunicationWorkflowPage },
  { id: 'followUps', label: '\u968f\u8bbf', kind: 'custom', component: FollowUpsPage },
  { id: 'followUpReport', label: '\u5230\u8bca\u7387', kind: 'custom', component: FollowUpReportPage },
  { id: 'followUpTemplates', label: '\u968f\u8bbf\u6a21\u677f', kind: 'resource', resource: 'followUpTemplates' },
  { id: 'wechat', label: '\u5fae\u4fe1', kind: 'resource', resource: 'wechatMessages' },
  { id: 'satisfaction', label: '\u6ee1\u610f\u5ea6', kind: 'resource', resource: 'satisfactionSurveys' },
];

export const hrHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5ba1\u6279', kind: 'custom', component: HrWorkflowPage },
  { id: 'staff', label: '\u5458\u5de5', kind: 'custom', component: UsersPage },
  { id: 'schedules', label: '\u6392\u73ed', kind: 'resource', resource: 'workSchedules' },
  { id: 'attendance', label: '\u8003\u52e4', kind: 'resource', resource: 'attendance' },
  { id: 'leaves', label: '\u8bf7\u5047', kind: 'resource', resource: 'leaveRequests' },
  { id: 'equipment', label: '\u8bbe\u5907', kind: 'resource', resource: 'equipment' },
];

export const systemHubTabs: HubTab[] = [
  { id: 'backups', label: '\u5907\u4efd', kind: 'custom', component: BackupsPage },
  { id: 'desktop', label: '\u684c\u9762\u7aef', kind: 'custom', component: DesktopSettingsPage },
  { id: 'operations', label: '\u7cfb\u7edf\u64cd\u4f5c', kind: 'custom', component: SystemOperationsPage },
  { id: 'settings', label: '\u8bbe\u7f6e', kind: 'resource', resource: 'settings' },
  { id: 'alerts', label: '\u544a\u8b66', kind: 'resource', resource: 'businessAlerts' },
  { id: 'logs', label: '\u64cd\u4f5c\u65e5\u5fd7', kind: 'resource', resource: 'operationLogs' },
  { id: 'sync', label: '\u540c\u6b65\u8bb0\u5f55', kind: 'resource', resource: 'syncChanges' },
  { id: 'printTemplates', label: '\u6253\u5370\u6a21\u677f', kind: 'resource', resource: 'printTemplates' },
  { id: 'importJobs', label: '\u5bfc\u5165\u4efb\u52a1', kind: 'resource', resource: 'dataImportJobs' },
];

export const analyticsHubTabs: HubTab[] = [
  { id: 'dashboard', label: '\u7ecf\u8425\u62a5\u8868', kind: 'custom', component: AnalyticsDashboardPage },
  { id: 'workbench', label: '\u5de5\u4f5c\u53f0', kind: 'custom', component: DashboardPage },
  { id: 'clinicOverview', label: '\u591a\u95e8\u5e97', kind: 'custom', component: ClinicOverviewPage, bossOnly: true },
  { id: 'monthly', label: '\u6708\u5ea6\u62a5\u8868', kind: 'custom', component: () => <SimpleListPage title="\u6708\u5ea6\u62a5\u8868" endpoint="/stats/revenue?groupBy=month" /> },
  { id: 'inventoryReport', label: '\u5e93\u5b58\u62a5\u8868', kind: 'custom', component: () => <SimpleListPage title="\u5e93\u5b58\u62a5\u8868" endpoint="/stats/inventory" /> },
  { id: 'rfm', label: 'RFM', kind: 'custom', component: () => <SimpleListPage title="RFM" endpoint="/analytics/rfm" /> },
  { id: 'churn', label: '\u6d41\u5931\u9884\u8b66', kind: 'custom', component: () => <SimpleListPage title="\u6d41\u5931\u9884\u8b66" endpoint="/analytics/churn" /> },
  { id: 'anomalies', label: '\u533b\u751f\u5f02\u5e38', kind: 'custom', component: () => <SimpleListPage title="\u533b\u751f\u5f02\u5e38" endpoint="/analytics/doctor-anomalies" /> },
  { id: 'satisfaction', label: '\u6ee1\u610f\u5ea6', kind: 'resource', resource: 'satisfactionSurveys' },
];
