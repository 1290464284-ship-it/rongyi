import { Navigate, Route, Routes, useParams } from 'react-router';
import { Layout } from './Layout';
import { LoginPage } from './LoginPage';
import { DashboardPage } from './DashboardPage';
import { ResourceHub, patientHubTabs, clinicalHubTabs, financeHubTabs, inventoryHubTabs, communicationHubTabs, hrHubTabs, systemHubTabs, analyticsHubTabs } from './ResourceHub';
import { ResourcePage } from './ResourcePage';

function DynamicResourcePage() {
  const { resource } = useParams<{ resource: string }>();
  return <ResourcePage resource={resource} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="patients" element={<ResourceHub title="患者与预约" tabs={patientHubTabs} />} />
        <Route path="clinical" element={<ResourceHub title="临床记录" tabs={clinicalHubTabs} />} />
        <Route path="finance" element={<ResourceHub title="财务中心" tabs={financeHubTabs} />} />
        <Route path="inventory" element={<ResourceHub title="库存与采购" tabs={inventoryHubTabs} />} />
        <Route path="communication" element={<ResourceHub title="随访与沟通" tabs={communicationHubTabs} />} />
        <Route path="hr" element={<ResourceHub title="人事与设备" tabs={hrHubTabs} />} />
        <Route path="system" element={<ResourceHub title="系统管理" tabs={systemHubTabs} />} />
        <Route path="analytics" element={<ResourceHub title="经营分析" tabs={analyticsHubTabs} />} />
        <Route path="resources/:resource" element={<DynamicResourcePage />} />
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
