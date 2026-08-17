// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Suspense, type ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  analyticsHubTabs,
  clinicalHubTabs,
  communicationHubTabs,
  financeHubTabs,
  frontDeskHubTabs,
  hrHubTabs,
  inventoryHubTabs,
  patientHubTabs,
  systemHubTabs,
  type HubTab,
} from './hub-tabs';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

vi.mock('../pages/appointments/AppointmentsPage', () => ({ AppointmentsPage: () => 'AppointmentsPage' }));
vi.mock('../pages/appointments/AppointmentBoardPage', () => ({ AppointmentBoardPage: () => 'AppointmentBoardPage' }));
vi.mock('../pages/patients/PatientTimelinePage', () => ({ PatientTimelinePage: () => 'PatientTimelinePage' }));
vi.mock('../pages/finance/ChargesPage', () => ({ ChargesPage: () => 'ChargesPage' }));
vi.mock('../pages/inventory/InventoryPage', () => ({ InventoryPage: () => 'InventoryPage' }));
vi.mock('../pages/communication/FollowUpsPage', () => ({ FollowUpsPage: () => 'FollowUpsPage' }));
vi.mock('../pages/system/BackupsPage', () => ({ BackupsPage: () => 'BackupsPage' }));
vi.mock('../pages/system/DesktopSettingsPage', () => ({ DesktopSettingsPage: () => 'DesktopSettingsPage' }));
vi.mock('../pages/clinical/ClinicalWorkflowPage', () => ({ ClinicalWorkflowPage: () => 'ClinicalWorkflowPage' }));
vi.mock('../pages/hr/HrWorkflowPage', () => ({ HrWorkflowPage: () => 'HrWorkflowPage' }));
vi.mock('../pages/appointments/SchedulesPage', () => ({ SchedulesPage: () => 'SchedulesPage' }));
vi.mock('../pages/system/PermissionsPage', () => ({ PermissionsPage: () => 'PermissionsPage' }));
vi.mock('../pages/finance/FinanceWorkflowPage', () => ({ FinanceWorkflowPage: () => 'FinanceWorkflowPage' }));
vi.mock('../pages/system/SystemOperationsPage', () => ({ SystemOperationsPage: () => 'SystemOperationsPage' }));
vi.mock('../pages/inventory/InventoryWorkflowPage', () => ({ InventoryWorkflowPage: () => 'InventoryWorkflowPage' }));
vi.mock('../pages/communication/CommunicationWorkflowPage', () => ({ CommunicationWorkflowPage: () => 'CommunicationWorkflowPage' }));
vi.mock('../pages/communication/FollowUpReportPage', () => ({ FollowUpReportPage: () => 'FollowUpReportPage' }));
vi.mock('../pages/patients/PatientWorkflowPage', () => ({ PatientWorkflowPage: () => 'PatientWorkflowPage' }));
vi.mock('../pages/analytics/ClinicOverviewPage', () => ({ ClinicOverviewPage: () => 'ClinicOverviewPage' }));
vi.mock('../pages/system/UsersPage', () => ({ UsersPage: () => 'UsersPage' }));
vi.mock('../pages/system/CustomFieldsPage', () => ({ CustomFieldsPage: () => 'CustomFieldsPage' }));
vi.mock('../pages/system/SyncConflictsPage', () => ({ SyncConflictsPage: () => 'SyncConflictsPage' }));
vi.mock('../pages/patients/PatientsPage', () => ({ PatientsPage: () => 'PatientsPage' }));
vi.mock('../pages/clinical/VisitsPage', () => ({ VisitsPage: () => 'VisitsPage' }));
vi.mock('../pages/clinical/FirstExamsPage', () => ({ FirstExamsPage: () => 'FirstExamsPage' }));
vi.mock('../pages/clinical/ImagingPage', () => ({ ImagingPage: () => 'ImagingPage' }));
vi.mock('../pages/finance/MemberCardsPage', () => ({ MemberCardsPage: () => 'MemberCardsPage' }));
vi.mock('../pages/clinical/MedicalRecordsPage', () => ({ MedicalRecordsPage: () => 'MedicalRecordsPage' }));
vi.mock('../pages/inventory/PurchaseOrdersPage', () => ({ PurchaseOrdersPage: () => 'PurchaseOrdersPage' }));
vi.mock('../pages/inventory/ProcessingOrdersPage', () => ({ ProcessingOrdersPage: () => 'ProcessingOrdersPage' }));
vi.mock('../pages/clinical/TreatmentsPage', () => ({ TreatmentsPage: () => 'TreatmentsPage' }));
vi.mock('../pages/clinical/PrescriptionsPage', () => ({ PrescriptionsPage: () => 'PrescriptionsPage' }));
vi.mock('../pages/clinical/TreatmentPlansPage', () => ({ TreatmentPlansPage: () => 'TreatmentPlansPage' }));
vi.mock('../pages/clinical/CephalometricPage', () => ({ CephalometricPage: () => 'CephalometricPage' }));
vi.mock('../pages/analytics/AnalyticsDashboardPage', () => ({ AnalyticsDashboardPage: () => 'AnalyticsDashboardPage' }));
vi.mock('../pages/finance/RefundsPage', () => ({ RefundsPage: () => 'RefundsPage' }));
vi.mock('../pages/inventory/DispenseWorkbenchPage', () => ({ DispenseWorkbenchPage: () => 'DispenseWorkbenchPage' }));
vi.mock('../pages/hr/CommissionPage', () => ({ CommissionPage: () => 'CommissionPage' }));
vi.mock('../pages/front-desk/FrontDeskWorkflowPage', () => ({ FrontDeskWorkflowPage: () => 'FrontDeskWorkflowPage' }));

import { apiRequest } from '../lib/api';

const workflowTexts: Record<string, string> = {
  'front-desk': 'FrontDeskWorkflowPage',
  clinical: 'ClinicalWorkflowPage',
  finance: 'FinanceWorkflowPage',
  inventory: 'InventoryWorkflowPage',
  communication: 'CommunicationWorkflowPage',
  hr: 'HrWorkflowPage',
  patients: 'PatientWorkflowPage',
};

const lazyTexts: Record<string, string> = {
  patients: 'PatientsPage',
  timeline: 'PatientTimelinePage',
  appointments: 'AppointmentsPage',
  appointmentBoard: 'AppointmentBoardPage',
  visits: 'VisitsPage',
  firstExams: 'FirstExamsPage',
  treatments: 'TreatmentsPage',
  records: 'MedicalRecordsPage',
  plans: 'TreatmentPlansPage',
  imaging: 'ImagingPage',
  cephalometric: 'CephalometricPage',
  prescriptions: 'PrescriptionsPage',
  charges: 'ChargesPage',
  memberCards: 'MemberCardsPage',
  refunds: 'RefundsPage',
  items: 'InventoryPage',
  pharmacy: 'DispenseWorkbenchPage',
  purchaseOrders: 'PurchaseOrdersPage',
  processingOrders: 'ProcessingOrdersPage',
  followUps: 'FollowUpsPage',
  followUpReport: 'FollowUpReportPage',
  staff: 'UsersPage',
  schedules: 'SchedulesPage',
  commission: 'CommissionPage',
  permissions: 'PermissionsPage',
  backups: 'BackupsPage',
  syncConflicts: 'SyncConflictsPage',
  desktop: 'DesktopSettingsPage',
  operations: 'SystemOperationsPage',
  customFields: 'CustomFieldsPage',
  dashboard: 'AnalyticsDashboardPage',
  clinicOverview: 'ClinicOverviewPage',
};

const resourceTitles: Record<string, string> = {
  monthly: '月度报表',
  inventoryReport: '库存报表',
  rfm: 'RFM',
  churn: '流失预警',
  anomalies: '医生异常',
};

const hubs: Array<[string, HubTab[]]> = [
  ['patients', patientHubTabs],
  ['front-desk', frontDeskHubTabs],
  ['clinical', clinicalHubTabs],
  ['finance', financeHubTabs],
  ['inventory', inventoryHubTabs],
  ['communication', communicationHubTabs],
  ['hr', hrHubTabs],
  ['system', systemHubTabs],
  ['analytics', analyticsHubTabs],
];

function expectedText(hubName: string, tab: HubTab): string | null {
  if (tab.id === 'workflow') return workflowTexts[hubName] ?? null;
  return lazyTexts[tab.id] ?? resourceTitles[tab.id] ?? null;
}

describe('hub tab lazy loaders', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  // 全量挂载所有 hub 的自定义页（~30 个组件含重页面），整体耗时 >10s，单独放宽超时。
  it('resolves every custom hub tab through its lazy loader', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/cost-share') return { rows: [], summary: {} };
      return [];
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );

    for (const [hubName, tabs] of hubs) {
      for (const tab of tabs) {
        if (tab.kind !== 'custom' || tab.id === 'costShare') continue;
        const expected = expectedText(hubName, tab);
        expect(expected, `${hubName}:${tab.id}`).not.toBeNull();
        cleanup();
        const Component = tab.component;
        render(
          <Suspense fallback={<div>页面加载中</div>}>
            <Component />
          </Suspense>,
          { wrapper },
        );
        expect(await screen.findByText(expected!)).toBeDefined();
      }
    }
  }, 60_000);
});
