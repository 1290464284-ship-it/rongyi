import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Calendar, User, Briefcase, MapPin, AlertTriangle, Heart, ClipboardList, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToothChart } from '@/components/tooth/ToothChart';
import { formatDate } from '@/lib/utils';
import type { Patient } from '@/lib/api/patients/patients';
import { PATIENT_SOURCE_LABEL, PATIENT_SOURCE_COLOR } from '@/lib/api/patients/patients';
import type { ToothRecord } from '@/lib/api/content/tooth-records';

function calcAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

const genderText = (g?: string) =>
  ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as Record<string, string>)[g ?? ''] ?? g;

const maskIdCard = (idCard?: string | null) => {
  if (!idCard || idCard.length < 10) return idCard ?? undefined;
  return idCard.slice(0, 6) + '********' + idCard.slice(-4);
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <span className="text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function TagList({ items, color, emptyText }: { items?: string[]; color: string; emptyText: string }) {
  if (!items || items.length === 0) return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <Badge key={t} className={color}>{t}</Badge>
      ))}
    </div>
  );
}

export function PatientInfoCard({ patient }: { patient: Patient }) {
  const nav = useNavigate();
  const age = calcAge(patient.birthDate);

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold flex-shrink-0">
          {patient.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-base">{patient.name}</div>
          <div className="text-sm text-muted-foreground">
            {genderText(patient.gender)}{age !== null && ` · ${age}岁`}
          </div>
          <div className="mt-1">
            <Badge className={PATIENT_SOURCE_COLOR[patient.source] ?? 'bg-muted text-muted-foreground'}>
              {PATIENT_SOURCE_LABEL[patient.source] ?? patient.source}
            </Badge>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <InfoRow icon={Phone} label="手机" value={patient.phone} />
        <InfoRow icon={Calendar} label="生日" value={patient.birthDate ? formatDate(patient.birthDate) : undefined} />
        <InfoRow icon={User} label="身份证" value={maskIdCard(patient.idCard)} />
        <InfoRow icon={Briefcase} label="职业" value={patient.occupation} />
        <InfoRow icon={MapPin} label="地址" value={patient.address} />
        <InfoRow icon={User} label="紧急联系人" value={patient.emergencyContact} />
        <InfoRow icon={Phone} label="紧急电话" value={patient.emergencyPhone} />
        <InfoRow icon={User} label="推荐人" value={patient.referrer} />
      </div>

      {patient.tags && patient.tags.length > 0 && (
        <div className="pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1.5">标签</div>
          <TagList items={patient.tags} color="bg-info/10 text-info" emptyText="" />
        </div>
      )}

      <div className="pt-2 border-t border-border space-y-2">
        <div>
          <div className="text-xs text-destructive mb-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />过敏史</div>
          <TagList items={patient.allergies} color="bg-destructive/10 text-destructive" emptyText="无" />
        </div>
        <div>
          <div className="text-xs text-warning mb-1.5 flex items-center gap-1"><Heart className="w-3 h-3" />全身疾病</div>
          <TagList items={patient.systemicDiseases} color="bg-warning/10 text-warning" emptyText="无" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><ClipboardList className="w-3 h-3" />既往史</div>
          <TagList items={patient.medicalHistory} color="bg-primary/10 text-primary" emptyText="无" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Activity className="w-3 h-3" />用药史</div>
          <TagList items={patient.medicationHistory} color="bg-primary/10 text-primary" emptyText="无" />
        </div>
      </div>

      {patient.remark && (
        <div className="pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">备注</div>
          <p className="text-sm text-foreground">{patient.remark}</p>
        </div>
      )}

      {patient.familyMembers && patient.familyMembers.length > 0 && (
        <div className="pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1.5">家庭成员</div>
          <div className="space-y-1">
            {patient.familyMembers.map((fm) => (
              <button
                key={fm.id}
                className="flex items-center justify-between w-full text-sm hover:bg-muted/50 rounded px-2 py-1"
                onClick={() => nav(`/patients/${fm.id}`)}
              >
                <span>{fm.name}</span>
                <span className="text-xs text-muted-foreground">{fm.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToothChartPanel({
  teeth,
  selectedTooth,
  onSelectTooth,
}: {
  teeth: ToothRecord[];
  selectedTooth?: number;
  onSelectTooth: (n: number | undefined) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">牙位图</h2>
        {selectedTooth && (
          <Button variant="ghost" size="sm" onClick={() => onSelectTooth(undefined)}>
            清除筛选（牙位 {selectedTooth}）
          </Button>
        )}
      </div>
      <ToothChart
        teeth={teeth ?? []}
        selectedTooth={selectedTooth}
        onSelectTooth={(n) => onSelectTooth(n)}
      />
      <p className="text-xs text-muted-foreground mt-2">
        {selectedTooth
          ? `已选牙位 ${selectedTooth}，右侧时间轴已过滤为该牙的治疗记录`
          : '点击牙位筛选右侧时间轴'}
      </p>
    </div>
  );
}
