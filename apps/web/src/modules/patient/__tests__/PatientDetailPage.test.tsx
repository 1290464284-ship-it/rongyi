import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUsePatient = vi.fn();
const mockUseUpdatePatient = vi.fn();
const mockUseAppointments = vi.fn();
const mockUseVisits = vi.fn();
const mockUseTreatments = vi.fn();
const mockUseToothRecords = vi.fn();
const mockUseCharges = vi.fn();
const mockUsePrescriptions = vi.fn();
const mockUseTreatmentPlans = vi.fn();
const mockUseImagingList = vi.fn();

vi.mock('@/lib/api/patients/patients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/patients/patients')>();
  return {
    ...actual,
    usePatient: (...args: unknown[]) => mockUsePatient(...args),
    useUpdatePatient: (...args: unknown[]) => mockUseUpdatePatient(...args),
  };
});

vi.mock('@/lib/api/clinical/appointments', () => ({
  useAppointments: (...args: unknown[]) => mockUseAppointments(...args),
}));
vi.mock('@/lib/api/clinical/visits', () => ({
  useVisits: (...args: unknown[]) => mockUseVisits(...args),
}));
vi.mock('@/lib/api/clinical/treatments', () => ({
  useTreatments: (...args: unknown[]) => mockUseTreatments(...args),
}));
vi.mock('@/lib/api/content/tooth-records', () => ({
  useToothRecords: (...args: unknown[]) => mockUseToothRecords(...args),
}));
vi.mock('@/lib/api/financial/charges', () => ({
  useCharges: (...args: unknown[]) => mockUseCharges(...args),
}));
vi.mock('@/lib/api/content/prescriptions', () => ({
  usePrescriptions: (...args: unknown[]) => mockUsePrescriptions(...args),
}));
vi.mock('@/lib/api/clinical/treatment-plans', () => ({
  useTreatmentPlans: (...args: unknown[]) => mockUseTreatmentPlans(...args),
}));
vi.mock('@/lib/api/content/imaging', () => ({
  useImagingList: (...args: unknown[]) => mockUseImagingList(...args),
}));

vi.mock('../PatientForm', () => ({ default: () => null }));
vi.mock('../../clinical/OralExaminationPanel', () => ({ default: () => null }));
vi.mock('../../clinical/PeriodontalRecordPanel', () => ({ default: () => null }));
vi.mock('../components/PatientSidebar', () => ({
  PatientInfoCard: () => null,
  ToothChartPanel: () => null,
}));
vi.mock('../components/AppointmentsTab', () => ({ AppointmentsTab: () => null }));
vi.mock('../components/ChargesTab', () => ({ ChargesTab: () => null }));
vi.mock('../components/PrescriptionsTab', () => ({ PrescriptionsTab: () => null }));
vi.mock('../components/TreatmentPlansTab', () => ({ TreatmentPlansTab: () => null }));
vi.mock('../components/ImagingTab', () => ({ ImagingTab: () => null }));
vi.mock('../components/ToothRecordsTab', () => ({ ToothRecordsTab: () => null }));
vi.mock('../components/FollowUpPanel', () => ({ FollowUpPanel: () => null }));
vi.mock('@/components/patient/Timeline', () => ({ Timeline: () => null }));
vi.mock('@/components/ui/loading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/loading')>();
  return { ...actual, PageLoading: () => <div>Loading...</div> };
});

import PatientDetailPage from '../PatientDetailPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/patients/1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PatientDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染患者详情页面', () => {
    mockUsePatient.mockReturnValue({ data: { id: '1', name: '张三', code: 'P001', gender: 'MALE', phone: '13800138000' }, isLoading: false, isError: false, refetch: vi.fn() });
    mockUseUpdatePatient.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseAppointments.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseVisits.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseTreatments.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseToothRecords.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseCharges.mockReturnValue({ data: { items: [], total: 0 } });
    mockUsePrescriptions.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseTreatmentPlans.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseImagingList.mockReturnValue({ data: { items: [], total: 0 } });

    renderWithProviders();

    expect(screen.getByText('张三')).toBeInTheDocument();
  });
});
