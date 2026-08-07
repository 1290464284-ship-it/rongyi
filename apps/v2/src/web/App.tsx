import { Navigate, Route, Routes, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResourceHub } from './components/ResourceHub';
import { patientHubTabs, clinicalHubTabs, financeHubTabs, inventoryHubTabs, communicationHubTabs, hrHubTabs, systemHubTabs, analyticsHubTabs } from './components/hub-tabs';
import { ResourcePage } from './components/ResourcePage';
import { ErrorBoundary } from './components';

function DynamicResourcePage() {
  const { resource } = useParams<{ resource: string }>();
  return <ResourcePage resource={resource} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<ErrorBoundary><LoginPage /></ErrorBoundary>} />
      <Route path="/" element={<ErrorBoundary><Layout /></ErrorBoundary>}>
        <Route index element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
        <Route path="patients" element={<ErrorBoundary><ResourceHub title="患者与预约" tabs={patientHubTabs} /></ErrorBoundary>} />
        <Route path="clinical" element={<ErrorBoundary><ResourceHub title="临床记录" tabs={clinicalHubTabs} /></ErrorBoundary>} />
        <Route path="finance" element={<ErrorBoundary><ResourceHub title="财务中心" tabs={financeHubTabs} /></ErrorBoundary>} />
        <Route path="inventory" element={<ErrorBoundary><ResourceHub title="库存与采购" tabs={inventoryHubTabs} /></ErrorBoundary>} />
        <Route path="communication" element={<ErrorBoundary><ResourceHub title="随访与沟通" tabs={communicationHubTabs} /></ErrorBoundary>} />
        <Route path="hr" element={<ErrorBoundary><ResourceHub title="人事与设备" tabs={hrHubTabs} /></ErrorBoundary>} />
        <Route path="system" element={<ErrorBoundary><ResourceHub title="系统管理" tabs={systemHubTabs} /></ErrorBoundary>} />
        <Route path="analytics" element={<ErrorBoundary><ResourceHub title="经营分析" tabs={analyticsHubTabs} /></ErrorBoundary>} />
        <Route path="resources/:resource" element={<ErrorBoundary><DynamicResourcePage /></ErrorBoundary>} />
        <Route path="appointments" element={<Navigate to="/patients" replace />} />
        <Route path="charges" element={<Navigate to="/finance" replace />} />
        <Route path="follow-ups" element={<Navigate to="/communication" replace />} />
        <Route path="backups" element={<Navigate to="/system" replace />} />
        <Route path="settings" element={<Navigate to="/system" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
