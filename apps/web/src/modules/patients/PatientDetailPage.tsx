import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, BellRing, Pill, Receipt, Image as ImageIcon, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Timeline } from '@/components/patient/Timeline';
import { usePatient } from '@/lib/api/patients/patients';
import { useAppointments } from '@/lib/api/clinical/appointments';
import { useVisits } from '@/lib/api/clinical/visits';
import { useTreatments } from '@/lib/api/clinical/treatments';
import { useToothRecords } from '@/lib/api/content/tooth-records';
import { useCharges } from '@/lib/api/financial/charges';
import { usePrescriptions } from '@/lib/api/content/prescriptions';
import { useTreatmentPlans } from '@/lib/api/clinical/treatment-plans';
import { useImagingList } from '@/lib/api/content/imaging';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { PageLoading } from '@/components/ui/loading';
import PatientForm from './PatientForm';
import OralExaminationPanel from '../clinical/OralExaminationPanel';
import PeriodontalRecordPanel from '../clinical/PeriodontalRecordPanel';
import { PatientInfoCard, ToothChartPanel } from './components/patient-detail-tabs/PatientSidebar';
import { AppointmentsTab } from './components/patient-detail-tabs/AppointmentsTab';
import { ChargesTab } from './components/patient-detail-tabs/ChargesTab';
import { PrescriptionsTab } from './components/patient-detail-tabs/PrescriptionsTab';
import { TreatmentPlansTab } from './components/patient-detail-tabs/TreatmentPlansTab';
import { ImagingTab } from './components/patient-detail-tabs/ImagingTab';
import { ToothRecordsTab } from './components/patient-detail-tabs/ToothRecordsTab';
import { FollowUpPanel } from './components/patient-detail-tabs/FollowUpPanel';

type Tab = 'timeline' | 'tooth' | 'oral-exam' | 'perio' | 'appointments' | 'follow-ups' | 'charges' | 'prescriptions' | 'treatment-plans' | 'imaging';

const PatientDetailPage = React.memo(function PatientDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('timeline');
  const [selectedTooth, setSelectedTooth] = useState<number | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);

  const { data: patient, isLoading: patientLoading, isError: patientError, refetch: refetchPatient } = usePatient(id);
  const { data: apptData } = useAppointments({ patientId: id }, { enabled: tab === 'timeline' || tab === 'appointments' });
  const { data: visitData } = useVisits(id, { enabled: tab === 'timeline' });
  const { data: treatmentData } = useTreatments(id, undefined, { enabled: tab === 'timeline' });
  const { data: teethData } = useToothRecords({ patientId: id });
  const teeth = teethData?.items ?? [];
  const { data: chargesData } = useCharges({ patientId: id, pageSize: 50 }, { enabled: tab === 'charges' });
  const { data: rxData } = usePrescriptions({ patientId: id, pageSize: 50 }, { enabled: tab === 'prescriptions' });
  const { data: plansData } = useTreatmentPlans({ patientId: id, pageSize: 50 }, { enabled: tab === 'treatment-plans' });
  const { data: imagingData } = useImagingList({ patientId: id, pageSize: 50 }, { enabled: tab === 'imaging' });

  const appointments = apptData?.items ?? [];
  const visits = visitData?.items ?? [];
  const treatments = treatmentData?.items ?? [];
  const charges = chargesData?.items ?? [];
  const prescriptions = rxData?.items ?? [];
  const plans = plansData?.items ?? [];
  const imagings = imagingData?.items ?? [];

  const tabs: { key: Tab; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
    { key: 'timeline', label: '就诊时间轴' },
    { key: 'tooth', label: '牙位详情' },
    { key: 'oral-exam', label: '口腔检查' },
    { key: 'perio', label: '牙周检查' },
    { key: 'appointments', label: '预约记录' },
    { key: 'follow-ups', label: '随访', icon: BellRing },
    { key: 'treatment-plans', label: '治疗计划', icon: ClipboardList },
    { key: 'prescriptions', label: '处方', icon: Pill },
    { key: 'charges', label: '收费', icon: Receipt },
    { key: 'imaging', label: '影像', icon: ImageIcon },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => nav('/patients')} aria-label="返回">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">
            {patientLoading ? '加载中…' : patientError ? '加载失败' : patient?.name}
            {patient && <Badge className="ml-2 bg-muted text-muted-foreground font-mono">{patient.code}</Badge>}
          </h1>
        </div>
        {patientError && (
          <Button variant="outline" size="sm" onClick={() => refetchPatient()}>
            <RefreshCw className="h-4 w-4 mr-1" />重试
          </Button>
        )}
        {patient && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />编辑
          </Button>
        )}
      </div>

      {patientError && !patient && (
        <Card>
          <CardHeader><CardTitle className="text-destructive">加载失败</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">患者数据加载失败，请检查网络连接后重试。</p>
            <Button variant="outline" onClick={() => refetchPatient()}>
              <RefreshCw className="h-4 w-4 mr-1" />重新加载
            </Button>
          </CardContent>
        </Card>
      )}

      {patientLoading && !patient && <div className="space-y-4"><PageLoading /></div>}

      {patient && (
      <div className="grid grid-cols-[420px_1fr] gap-6">
        <div className="space-y-4">
          <PatientInfoCard patient={patient} />
          <ToothChartPanel teeth={teeth} selectedTooth={selectedTooth} onSelectTooth={setSelectedTooth} />
        </div>

        <div className="space-y-4">
          <div className="flex gap-1 border-b border-border flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(t.key)}
              >
                {t.icon && <t.icon className="w-3.5 h-3.5" />}
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="rounded-lg border border-border bg-white p-4">
              {selectedTooth && (
                <div className="mb-3 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
                  时间轴已按牙位 {selectedTooth} 过滤治疗记录
                </div>
              )}
              <Timeline appointments={appointments} visits={visits} treatments={treatments} toothFilter={selectedTooth} />
            </div>
          )}

          {tab === 'tooth' && <ToothRecordsTab teeth={teeth} />}
          {tab === 'oral-exam' && <div className="rounded-lg border border-border bg-white p-4"><OralExaminationPanel patientId={id} /></div>}
          {tab === 'perio' && <div className="rounded-lg border border-border bg-white p-4"><PeriodontalRecordPanel patientId={id} /></div>}
          {tab === 'appointments' && <AppointmentsTab appointments={appointments} />}
          {tab === 'follow-ups' && <FollowUpPanel patientId={id} />}
          {tab === 'treatment-plans' && <TreatmentPlansTab plans={plans} />}
          {tab === 'prescriptions' && <PrescriptionsTab prescriptions={prescriptions} />}
          {tab === 'charges' && <ChargesTab charges={charges} />}
          {tab === 'imaging' && <ImagingTab imagings={imagings} patientId={id} />}
        </div>
      </div>
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} className="max-w-2xl">
        <DialogHeader><DialogTitle>编辑患者</DialogTitle></DialogHeader>
        <DialogContent>
          {patient && (
            <PatientForm
              onClose={() => setEditOpen(false)}
              onSaved={() => setEditOpen(false)}
              initialPatient={patient}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
export default PatientDetailPage;
