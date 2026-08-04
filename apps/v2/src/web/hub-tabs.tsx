import { ComponentType } from 'react';
import { AppointmentsPage } from './AppointmentsPage';
import { ChargesPage } from './ChargesPage';
import { InventoryPage } from './InventoryPage';
import { FollowUpsPage } from './FollowUpsPage';
import { BackupsPage } from './BackupsPage';
import { SimpleListPage } from './SimpleListPage';
import { DashboardPage } from './DashboardPage';
import { DesktopSettingsPage } from './DesktopSettingsPage';
import { ClinicalWorkflowPage } from './ClinicalWorkflowPage';
import { HrWorkflowPage } from './HrWorkflowPage';
import { FinanceWorkflowPage } from './FinanceWorkflowPage';
import { SystemOperationsPage } from './SystemOperationsPage';
import { InventoryWorkflowPage } from './InventoryWorkflowPage';
import { CommunicationWorkflowPage } from './CommunicationWorkflowPage';
import { PatientWorkflowPage } from './PatientWorkflowPage';

export type HubTab =
  | { id: string; label: string; kind: 'resource'; resource: string }
  | { id: string; label: string; kind: 'custom'; component: ComponentType };

export const patientHubTabs: HubTab[] = [
  { id: 'patients', label: '\u60a3\u8005\u6863\u6848', kind: 'resource', resource: 'patients' },
  { id: 'appointments', label: '\u9884\u7ea6', kind: 'custom', component: AppointmentsPage },
  { id: 'workflow', label: '\u98ce\u9669\u8bc4\u5206', kind: 'custom', component: PatientWorkflowPage },
  { id: 'family', label: '\u5bb6\u5c5e\u8054\u7cfb\u4eba', kind: 'resource', resource: 'familyMembers' },
];

export const clinicalHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5de5\u4f5c\u6d41', kind: 'custom', component: ClinicalWorkflowPage },
  { id: 'visits', label: '\u5c31\u8bca', kind: 'resource', resource: 'visits' },
  { id: 'firstExams', label: '\u9996\u8bca', kind: 'resource', resource: 'firstExams' },
  { id: 'treatments', label: '\u6cbb\u7597', kind: 'resource', resource: 'treatments' },
  { id: 'records', label: '\u75c5\u5386', kind: 'resource', resource: 'medicalRecords' },
  { id: 'plans', label: '\u6cbb\u7597\u8ba1\u5212', kind: 'resource', resource: 'treatmentPlans' },
  { id: 'imaging', label: '\u5f71\u50cf', kind: 'resource', resource: 'imaging' },
  { id: 'cephalometric', label: '\u5934\u5f71\u6d4b\u91cf', kind: 'resource', resource: 'cephalometricCases' },
  { id: 'prescriptions', label: '\u5904\u65b9', kind: 'resource', resource: 'prescriptions' },
];

export const financeHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u64cd\u4f5c', kind: 'custom', component: FinanceWorkflowPage },
  { id: 'charges', label: '\u6536\u8d39', kind: 'custom', component: ChargesPage },
  { id: 'memberCards', label: '\u4f1a\u5458\u5361', kind: 'resource', resource: 'memberCards' },
  { id: 'refunds', label: '\u9000\u6b3e', kind: 'resource', resource: 'refunds' },
  { id: 'debts', label: '\u6b20\u8d39', kind: 'resource', resource: 'debtRecords' },
  { id: 'invoices', label: '\u53d1\u7968', kind: 'resource', resource: 'invoices' },
];

export const inventoryHubTabs: HubTab[] = [
  { id: 'items', label: '\u5e93\u5b58', kind: 'custom', component: InventoryPage },
  { id: 'workflow', label: '\u91c7\u8d2d\u52a0\u5de5', kind: 'custom', component: InventoryWorkflowPage },
  { id: 'suppliers', label: '\u4f9b\u5e94\u5546', kind: 'resource', resource: 'suppliers' },
  { id: 'purchaseOrders', label: '\u91c7\u8d2d\u5355', kind: 'resource', resource: 'purchaseOrders' },
  { id: 'processingOrders', label: '\u52a0\u5de5\u5355', kind: 'resource', resource: 'processingOrders' },
];

export const communicationHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5fae\u4fe1\u53d1\u9001', kind: 'custom', component: CommunicationWorkflowPage },
  { id: 'followUps', label: '\u968f\u8bbf', kind: 'custom', component: FollowUpsPage },
  { id: 'wechat', label: '\u5fae\u4fe1', kind: 'resource', resource: 'wechatMessages' },
  { id: 'sms', label: '\u77ed\u4fe1', kind: 'resource', resource: 'smsLogs' },
  { id: 'satisfaction', label: '\u6ee1\u610f\u5ea6', kind: 'resource', resource: 'satisfactionSurveys' },
];

export const hrHubTabs: HubTab[] = [
  { id: 'workflow', label: '\u5ba1\u6279', kind: 'custom', component: HrWorkflowPage },
  { id: 'staff', label: '\u5458\u5de5', kind: 'resource', resource: 'users' },
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
  { id: 'dashboard', label: '\u5de5\u4f5c\u53f0', kind: 'custom', component: DashboardPage },
  { id: 'rfm', label: 'RFM', kind: 'custom', component: () => <SimpleListPage title="RFM" endpoint="/analytics/rfm" /> },
  { id: 'churn', label: '\u6d41\u5931\u9884\u8b66', kind: 'custom', component: () => <SimpleListPage title="\u6d41\u5931\u9884\u8b66" endpoint="/analytics/churn" /> },
  { id: 'anomalies', label: '\u533b\u751f\u5f02\u5e38', kind: 'custom', component: () => <SimpleListPage title="\u533b\u751f\u5f02\u5e38" endpoint="/analytics/doctor-anomalies" /> },
  { id: 'satisfaction', label: '\u6ee1\u610f\u5ea6', kind: 'resource', resource: 'satisfactionSurveys' },
];
