import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  useCreatePatient,
  useUpdatePatient,
  PATIENT_SOURCE_LABEL,
  type Patient,
  type CreatePatientDto,
  type PatientGender,
  type PatientSource,
} from '@/lib/api/patients/patients';

interface Props {
  onClose: () => void;
  onSaved: (p: Patient) => void;
  initialPatient?: Patient;
}

function TagInput({
  value,
  onChange,
  placeholder,
  color = 'bg-primary/10 text-primary',
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  color?: string;
  id?: string;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setInput('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          id={id}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? '输入后回车添加'}
        />
        <Button type="button" variant="outline" size="icon" onClick={add} aria-label="添加">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} className={`${color} gap-1`}>
              {tag}
              <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`删除${tag}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const patientSchema = z.object({
  name: z.string().min(1, '必填'),
  gender: z.enum(['UNKNOWN', 'MALE', 'FEMALE', 'OTHER']),
  phone: z.string().regex(/^\d{11}$/, '11位手机号'),
  birthDate: z.string().optional(),
  idCard: z.string().optional(),
  address: z.string().optional(),
  occupation: z.string().optional(),
  source: z.string().optional(),
  referrer: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().regex(/^\d*$/, '请输入数字').optional(),
  remark: z.string().optional(),
});

type PatientFormValues = z.infer<typeof patientSchema>;

export default function PatientForm({ onClose, onSaved, initialPatient }: Props) {
  const isEdit = !!initialPatient;
  const create = useCreatePatient();
  const update = useUpdatePatient();

  const [tags, setTags] = useState<string[]>(initialPatient?.tags ?? []);
  const [allergies, setAllergies] = useState<string[]>(initialPatient?.allergies ?? []);
  const [medicalHistory, setMedicalHistory] = useState<string[]>(initialPatient?.medicalHistory ?? []);
  const [medicationHistory, setMedicationHistory] = useState<string[]>(initialPatient?.medicationHistory ?? []);
  const [systemicDiseases, setSystemicDiseases] = useState<string[]>(initialPatient?.systemicDiseases ?? []);

  const { register, handleSubmit, formState: { errors } } = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      name: initialPatient?.name ?? '',
      gender: initialPatient?.gender ?? 'UNKNOWN',
      phone: initialPatient?.phone ?? '',
      birthDate: initialPatient?.birthDate ? initialPatient.birthDate.substring(0, 10) : '',
      idCard: initialPatient?.idCard ?? '',
      address: initialPatient?.address ?? '',
      occupation: initialPatient?.occupation ?? '',
      source: initialPatient?.source ?? 'WALK_IN',
      referrer: initialPatient?.referrer ?? '',
      emergencyContact: initialPatient?.emergencyContact ?? '',
      emergencyPhone: initialPatient?.emergencyPhone ?? '',
      remark: initialPatient?.remark ?? '',
    },
  });

  const onSubmit = async (data: PatientFormValues) => {
    const payload: CreatePatientDto = {
      ...data,
      gender: data.gender as PatientGender,
      source: (data.source || undefined) as PatientSource | undefined,
      birthDate: data.birthDate || undefined,
      idCard: data.idCard || undefined,
      address: data.address || undefined,
      occupation: data.occupation || undefined,
      referrer: data.referrer || undefined,
      emergencyContact: data.emergencyContact || undefined,
      emergencyPhone: data.emergencyPhone || undefined,
      remark: data.remark || undefined,
      tags,
      allergies,
      medicalHistory,
      medicationHistory,
      systemicDiseases,
    };

    if (isEdit && initialPatient) {
      const p = await update.mutateAsync({ id: initialPatient.id, data: payload });
      onSaved(p);
    } else {
      const p = await create.mutateAsync(payload);
      onSaved(p);
    }
    onClose();
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">基本信息</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">姓名 *</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gender">性别</Label>
            <Select id="gender" {...register('gender')}>
              <option value="UNKNOWN">未知</option>
              <option value="MALE">男</option>
              <option value="FEMALE">女</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">手机 *</Label>
            <Input id="phone" {...register('phone')} />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="birthDate">生日</Label>
            <Input id="birthDate" type="date" {...register('birthDate')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idCard">身份证号</Label>
            <Input id="idCard" {...register('idCard')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="occupation">职业</Label>
            <Input id="occupation" {...register('occupation')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address">地址</Label>
          <Input id="address" {...register('address')} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">医疗信息</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-allergies">过敏史</Label>
            <TagInput id="pf-allergies" value={allergies} onChange={setAllergies} placeholder="如：青霉素" color="bg-destructive/10 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-systemic">全身疾病</Label>
            <TagInput id="pf-systemic" value={systemicDiseases} onChange={setSystemicDiseases} placeholder="如：高血压" color="bg-warning/10 text-warning" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-history">既往史</Label>
            <TagInput id="pf-history" value={medicalHistory} onChange={setMedicalHistory} placeholder="如：根管治疗" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-medication">用药史</Label>
            <TagInput id="pf-medication" value={medicationHistory} onChange={setMedicationHistory} placeholder="如：阿司匹林" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">其他信息</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="source">患者来源</Label>
            <Select id="source" {...register('source')}>
              {Object.entries(PATIENT_SOURCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="referrer">推荐人</Label>
            <Input id="referrer" {...register('referrer')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContact">紧急联系人</Label>
            <Input id="emergencyContact" {...register('emergencyContact')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyPhone">紧急联系电话</Label>
            <Input id="emergencyPhone" {...register('emergencyPhone')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-tags">标签</Label>
          <TagInput id="pf-tags" value={tags} onChange={setTags} placeholder="如：VIP、老客户" color="bg-info/10 text-info" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="remark">备注</Label>
          <Textarea id="remark" {...register('remark')} rows={2} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-border">
        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={pending}>{isEdit ? '保存修改' : '创建患者'}</Button>
      </div>
    </form>
  );
}
