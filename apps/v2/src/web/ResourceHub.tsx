import { ComponentType, useState } from 'react';
import { ResourcePage } from './ResourcePage';
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

export function ResourceHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div className="hub">
      <h1>{title}</h1>
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            className={tab.id === active?.id ? 'tab active' : 'tab'}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {active?.kind === 'resource' ? (
          <ResourcePage resource={active.resource} />
        ) : active?.kind === 'custom' ? (
          <active.component />
        ) : null}
      </div>
    </div>
  );
}

export const patientHubTabs: HubTab[] = [
  { id: 'patients', label: '患者档案', kind: 'resource', resource: 'patients' },
  { id: 'appointments', label: '预约', kind: 'custom', component: AppointmentsPage },
  { id: 'workflow', label: '风险评分', kind: 'custom', component: PatientWorkflowPage },
  { id: 'family', label: '家属联系人', kind: 'resource', resource: 'familyMembers' },
];

export const clinicalHubTabs: HubTab[] = [
  { id: 'workflow', label: '工作流', kind: 'custom', component: ClinicalWorkflowPage },
  { id: 'visits', label: '就诊', kind: 'resource', resource: 'visits' },
  { id: 'firstExams', label: '首诊', kind: 'resource', resource: 'firstExams' },
  { id: 'treatments', label: '治疗', kind: 'resource', resource: 'treatments' },
  { id: 'records', label: '病历', kind: 'resource', resource: 'medicalRecords' },
  { id: 'plans', label: '治疗计划', kind: 'resource', resource: 'treatmentPlans' },
  { id: 'imaging', label: '影像', kind: 'resource', resource: 'imaging' },
  { id: 'cephalometric', label: '头影测量', kind: 'resource', resource: 'cephalometricCases' },
  { id: 'prescriptions', label: '处方', kind: 'resource', resource: 'prescriptions' },
];

export const financeHubTabs: HubTab[] = [
  { id: 'workflow', label: '操作', kind: 'custom', component: FinanceWorkflowPage },
  { id: 'charges', label: '收费', kind: 'custom', component: ChargesPage },
  { id: 'memberCards', label: '会员卡', kind: 'resource', resource: 'memberCards' },
  { id: 'refunds', label: '退款', kind: 'resource', resource: 'refunds' },
  { id: 'debts', label: '欠费', kind: 'resource', resource: 'debtRecords' },
  { id: 'invoices', label: '发票', kind: 'resource', resource: 'invoices' },
];

export const inventoryHubTabs: HubTab[] = [
  { id: 'items', label: '库存', kind: 'custom', component: InventoryPage },
  { id: 'workflow', label: '采购加工', kind: 'custom', component: InventoryWorkflowPage },
  { id: 'suppliers', label: '供应商', kind: 'resource', resource: 'suppliers' },
  { id: 'purchaseOrders', label: '采购单', kind: 'resource', resource: 'purchaseOrders' },
  { id: 'processingOrders', label: '加工单', kind: 'resource', resource: 'processingOrders' },
];

export const communicationHubTabs: HubTab[] = [
  { id: 'workflow', label: '微信发送', kind: 'custom', component: CommunicationWorkflowPage },
  { id: 'followUps', label: '随访', kind: 'custom', component: FollowUpsPage },
  { id: 'wechat', label: '微信', kind: 'resource', resource: 'wechatMessages' },
  { id: 'sms', label: '短信', kind: 'resource', resource: 'smsLogs' },
  { id: 'satisfaction', label: '满意度', kind: 'resource', resource: 'satisfactionSurveys' },
];

export const hrHubTabs: HubTab[] = [
  { id: 'workflow', label: '审批', kind: 'custom', component: HrWorkflowPage },
  { id: 'staff', label: '员工', kind: 'resource', resource: 'users' },
  { id: 'schedules', label: '排班', kind: 'resource', resource: 'workSchedules' },
  { id: 'attendance', label: '考勤', kind: 'resource', resource: 'attendance' },
  { id: 'leaves', label: '请假', kind: 'resource', resource: 'leaveRequests' },
  { id: 'equipment', label: '设备', kind: 'resource', resource: 'equipment' },
];

export const systemHubTabs: HubTab[] = [
  { id: 'backups', label: '备份', kind: 'custom', component: BackupsPage },
  { id: 'desktop', label: '桌面端', kind: 'custom', component: DesktopSettingsPage },
  { id: 'operations', label: '系统操作', kind: 'custom', component: SystemOperationsPage },
  { id: 'settings', label: '设置', kind: 'resource', resource: 'settings' },
  { id: 'alerts', label: '告警', kind: 'resource', resource: 'businessAlerts' },
  { id: 'logs', label: '操作日志', kind: 'resource', resource: 'operationLogs' },
  { id: 'sync', label: '同步记录', kind: 'resource', resource: 'syncChanges' },
  { id: 'printTemplates', label: '打印模板', kind: 'resource', resource: 'PrintTemplate' },
  { id: 'importJobs', label: '导入任务', kind: 'resource', resource: 'DataImportJob' },
];

export const analyticsHubTabs: HubTab[] = [
  { id: 'dashboard', label: '工作台', kind: 'custom', component: DashboardPage },
  { id: 'rfm', label: 'RFM', kind: 'custom', component: () => <SimpleListPage title="RFM" endpoint="/analytics/rfm" /> },
  { id: 'churn', label: '流失预警', kind: 'custom', component: () => <SimpleListPage title="流失预警" endpoint="/analytics/churn" /> },
  { id: 'anomalies', label: '医生异常', kind: 'custom', component: () => <SimpleListPage title="医生异常" endpoint="/analytics/doctor-anomalies" /> },
  { id: 'satisfaction', label: '满意度', kind: 'resource', resource: 'SatisfactionSurvey' },
];
