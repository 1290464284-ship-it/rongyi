import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/lib/auth-store';

const LoginPage = lazy(() => import('@/modules/auth/LoginPage'));
const PatientListPage = lazy(() => import('@/modules/patient/PatientListPage'));
const PatientDetailPage = lazy(() => import('@/modules/patient/PatientDetailPage'));
const AppointmentCalendarPage = lazy(() => import('@/modules/appointment/AppointmentCalendarPage'));
const UnifiedChargePage = lazy(() => import('@/modules/charge/UnifiedChargePage'));
const PrescriptionPage = lazy(() => import('@/modules/prescription/PrescriptionPage'));
const TreatmentPlanPage = lazy(() => import('@/modules/treatment-plan/TreatmentPlanPage'));
const ClinicalPage = lazy(() => import('@/modules/clinical/ClinicalPage'));
const DashboardPage = lazy(() => import('@/modules/dashboard/DashboardPage'));
const ReportPage = lazy(() => import('@/modules/report/ReportPage'));
const StaffPage = lazy(() => import('@/modules/staff/StaffPage'));
const ImagingPage = lazy(() => import('@/modules/imaging/ImagingPage'));
const PriceListPage = lazy(() => import('@/modules/settings/PriceListPage'));
const MemberCardPage = lazy(() => import('@/modules/finance/MemberCardPage'));
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage'));
const InventoryPage = lazy(() => import('@/modules/inventory/InventoryPage'));
const SuppliersPage = lazy(() => import('@/modules/inventory/SuppliersPage'));
const PurchaseOrderPage = lazy(() => import('@/modules/inventory/PurchaseOrderPage'));
const BackupPage = lazy(() => import('@/modules/settings/BackupPage'));
const RegistrationPage = lazy(() => import('@/modules/registration/RegistrationPage'));
const MedicalRecordsPage = lazy(() => import('@/modules/medical-records/MedicalRecordsPage'));
const FollowUpsV2Page = lazy(() => import('@/modules/follow-ups-v2/FollowUpsV2Page'));
const ProcessingOrdersPage = lazy(() => import('@/modules/processing-orders/ProcessingOrdersPage'));
const FirstExamsPage = lazy(() => import('@/modules/first-exams/FirstExamsPage'));
const WechatPage = lazy(() => import('@/modules/wechat/WechatPage'));
const EquipmentPage = lazy(() => import('@/modules/equipment/EquipmentPage'));
const OperationLogPage = lazy(() => import('@/modules/settings/OperationLogPage'));
const NotFoundPage = lazy(() => import('@/components/NotFoundPage'));

const SuspenseElement = ({ element }: { element: React.ReactNode }) => (
  <ErrorBoundary variant="inline">
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">加载中...</div>}>
      {element}
    </Suspense>
  </ErrorBoundary>
);

/** Role-gated route wrapper — redirects to dashboard if user's role is not in allowed list */
function RoleRoute({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export const routes = [
  {
    path: '/login',
    element: <SuspenseElement element={<LoginPage />} />
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to='/dashboard' replace /> },
      { path: 'dashboard', element: <SuspenseElement element={<DashboardPage />} /> },
      { path: 'patients', element: <SuspenseElement element={<PatientListPage />} /> },
      { path: 'patients/:id', element: <SuspenseElement element={<PatientDetailPage />} /> },
      { path: 'appointments', element: <SuspenseElement element={<AppointmentCalendarPage />} /> },
      { path: 'clinical', element: <SuspenseElement element={<ClinicalPage />} /> },
      { path: 'charge', element: <Navigate to="/charge-v2" replace /> },
      { path: 'charge-v2', element: <RoleRoute roles={['BOSS', 'RECEPTIONIST', 'DOCTOR']}><SuspenseElement element={<UnifiedChargePage />} /></RoleRoute> },
      { path: 'prescriptions', element: <RoleRoute roles={['BOSS', 'DOCTOR']}><SuspenseElement element={<PrescriptionPage />} /></RoleRoute> },
      { path: 'treatment-plans', element: <RoleRoute roles={['BOSS', 'DOCTOR']}><SuspenseElement element={<TreatmentPlanPage />} /></RoleRoute> },
      { path: 'reports', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<ReportPage />} /></RoleRoute> },
      { path: 'staff', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<StaffPage />} /></RoleRoute> },
      { path: 'backups', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<BackupPage />} /></RoleRoute> },
      { path: 'settings', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<SettingsPage />} /></RoleRoute> },
      { path: 'imaging', element: <RoleRoute roles={['BOSS', 'DOCTOR']}><SuspenseElement element={<ImagingPage />} /></RoleRoute> },
      { path: 'price-list', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<PriceListPage />} /></RoleRoute> },
      { path: 'member-cards', element: <RoleRoute roles={['BOSS', 'RECEPTIONIST']}><SuspenseElement element={<MemberCardPage />} /></RoleRoute> },
      { path: 'inventory', element: <RoleRoute roles={['BOSS', 'RECEPTIONIST']}><SuspenseElement element={<InventoryPage />} /></RoleRoute> },
      { path: 'suppliers', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<SuppliersPage />} /></RoleRoute> },
      { path: 'purchase-orders', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<PurchaseOrderPage />} /></RoleRoute> },
      { path: 'registration', element: <SuspenseElement element={<RegistrationPage />} /> },
      { path: 'medical-records', element: <RoleRoute roles={['BOSS', 'DOCTOR']}><SuspenseElement element={<MedicalRecordsPage />} /></RoleRoute> },
      { path: 'follow-ups', element: <RoleRoute roles={['BOSS', 'DOCTOR', 'RECEPTIONIST']}><SuspenseElement element={<FollowUpsV2Page />} /></RoleRoute> },
      { path: 'follow-ups-v2', element: <Navigate to="/follow-ups" replace /> },
      { path: 'processing-orders', element: <RoleRoute roles={['BOSS', 'DOCTOR', 'RECEPTIONIST']}><SuspenseElement element={<ProcessingOrdersPage />} /></RoleRoute> },
      { path: 'first-exams', element: <RoleRoute roles={['BOSS', 'DOCTOR']}><SuspenseElement element={<FirstExamsPage />} /></RoleRoute> },
      { path: 'wechat', element: <RoleRoute roles={['BOSS', 'RECEPTIONIST']}><SuspenseElement element={<WechatPage />} /></RoleRoute> },
      { path: 'equipment', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<EquipmentPage />} /></RoleRoute> },
      { path: 'operation-logs', element: <RoleRoute roles={['BOSS']}><SuspenseElement element={<OperationLogPage />} /></RoleRoute> },
      { path: '*', element: <SuspenseElement element={<NotFoundPage />} /> },
    ],
  },
];
