import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: [
        'src/web/ResourceHub.tsx',
        'src/web/ResourcePage.tsx',
        'src/web/hub-tabs.tsx',
        'src/web/components.tsx',
        'src/web/FollowUpsPage.tsx',
        'src/web/BackupsPage.tsx',
        'src/web/SimpleListPage.tsx',
        'src/web/InventoryWorkflowPage.tsx',
        'src/web/InventoryPage.tsx',
        'src/web/ChargesPage.tsx',
        'src/web/FinanceWorkflowPage.tsx',
        'src/web/CommunicationWorkflowPage.tsx',
        'src/web/HrWorkflowPage.tsx',
        'src/web/ClinicalWorkflowPage.tsx',
        'src/web/PatientWorkflowPage.tsx',
        'src/web/AppointmentBoardPage.tsx',
        'src/web/PatientTimelinePage.tsx',
        'src/web/DashboardPage.tsx',
        'src/web/AppointmentsPage.tsx',
        'src/web/SystemOperationsPage.tsx',
        'src/web/LoginPage.tsx',
        'src/web/Layout.tsx',
        'src/web/FollowUpReportPage.tsx',
        'src/web/DesktopSettingsPage.tsx',
        'src/web/ClinicOverviewPage.tsx',
      ],
      thresholds: {
        statements: 98.5,
        branches: 92.5,
        functions: 98.5,
        lines: 100,
      },
    },
  },
});
