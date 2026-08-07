import { useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../lib/api';
import { CrudPage } from '../components/CrudPage';
import type { DataTableColumn } from '../components';
import { errorMessage } from '../lib/messages';
import type { Page } from '../lib/types';

const GENDER_LABELS: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

const SOURCE_LABELS: Record<string, string> = {
  WALK_IN: '到店',
  REFERRAL: '转介绍',
  ONLINE: '线上',
  OTHER: '其他',
};

type PatientRow = Record<string, unknown> & {
  id: string;
  code?: string;
  name?: string;
  gender?: string;
  phone?: string;
  birthDate?: string;
  source?: string;
  active?: boolean;
};

interface PatientForm {
  code: string;
  name: string;
  gender: string;
  phone: string;
  birthDate: string;
  idCard: string;
  address: string;
  occupation: string;
  source: string;
  active: boolean;
  avatar: string;
  allergies: string;
  medicalHistory: string;
  medicationHistory: string;
  systemicDiseases: string;
  tags: string;
  remark: string;
}

const emptyForm: PatientForm = {
  code: '',
  name: '',
  gender: 'UNKNOWN',
  phone: '',
  birthDate: '',
  idCard: '',
  address: '',
  occupation: '',
  source: 'WALK_IN',
  active: true,
  avatar: '',
  allergies: '',
  medicalHistory: '',
  medicationHistory: '',
  systemicDiseases: '',
  tags: '',
  remark: '',
};

const patientColumns: DataTableColumn<PatientRow>[] = [
  { key: 'code', label: '编号' },
  { key: 'name', label: '姓名' },
  {
    key: 'gender',
    label: '性别',
    render: (row) => GENDER_LABELS[String(row.gender ?? '')] ?? String(row.gender ?? ''),
  },
  { key: 'phone', label: '电话' },
  { key: 'birthDate', label: '出生日期' },
  {
    key: 'source',
    label: '来源',
    render: (row) => SOURCE_LABELS[String(row.source ?? '')] ?? String(row.source ?? ''),
  },
  {
    key: 'active',
    label: '启用',
    render: (row) => row.active ? '是' : '否',
  },
];

export function PatientsPage() {
  const editingIdRef = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const urlSearch = searchParams.get('q') ?? undefined;
  return (
    <CrudPage<PatientRow, PatientForm>
      title="患者档案"
      createLabel="新建患者"
      emptyMessage="暂无患者"
      queryKey={['patients']}
      endpoint="/resources/patients"
      pageSize={20}
      initialSearch={urlSearch}
      initialForm={() => {
        editingIdRef.current = null;
        return { ...emptyForm };
      }}
      formFromRow={(row) => {
        editingIdRef.current = String(row.id);
        return {
          code: String(row.code ?? ''),
          name: String(row.name ?? ''),
          gender: String(row.gender ?? 'UNKNOWN'),
          phone: String(row.phone ?? ''),
          birthDate: String(row.birthDate ?? ''),
          idCard: String(row.idCard ?? ''),
          address: String(row.address ?? ''),
          occupation: String(row.occupation ?? ''),
          source: String(row.source ?? 'WALK_IN'),
          active: Boolean(row.active),
          avatar: String(row.avatar ?? ''),
          allergies: joinLines(row.allergies),
          medicalHistory: joinLines(row.medicalHistory),
          medicationHistory: joinLines(row.medicationHistory),
          systemicDiseases: joinLines(row.systemicDiseases),
          tags: joinLines(row.tags),
          remark: String(row.remark ?? ''),
        };
      }}
      toPayload={(form) => ({
        code: form.code,
        name: form.name,
        gender: form.gender,
        phone: form.phone,
        birthDate: form.birthDate || undefined,
        idCard: form.idCard || undefined,
        address: form.address || undefined,
        occupation: form.occupation || undefined,
        source: form.source,
        active: form.active,
        avatar: form.avatar || undefined,
        allergies: splitLines(form.allergies),
        medicalHistory: splitLines(form.medicalHistory),
        medicationHistory: splitLines(form.medicationHistory),
        systemicDiseases: splitLines(form.systemicDiseases),
        tags: splitLines(form.tags),
        remark: form.remark || undefined,
      })}
      onBeforeSubmit={async (form) => {
        if (!form.phone && !form.code) return null;
        try {
          const duplicateCheck = await apiRequest<Page<PatientRow>>(
            `/resources/patients?page=1&pageSize=10&search=${encodeURIComponent(form.phone || form.code)}`,
          );
          const duplicate = duplicateCheck.items.find((row) => row.id !== editingIdRef.current && (
            (form.phone && String(row.phone ?? '') === form.phone) ||
            (form.code && String(row.code ?? '') === form.code)
          ));
          if (duplicate) return '手机号或患者编号已存在，请检查后重试';
          return null;
        } catch (error) {
          return errorMessage(error, '保存失败');
        }
      }}
      messages={{ create: '患者档案已创建', update: '患者档案已更新', delete: '患者档案已删除' }}
      errorMessages={{ create: '保存失败', update: '保存失败', delete: '删除失败' }}
      columns={patientColumns}
      canEdit
      canDelete
      searchable
      searchPlaceholder="搜索编号、姓名或手机号"
      searchAriaLabel="搜索患者"
      paged
      dialogTitle={(editing) => (editing ? '编辑患者' : '新建患者')}
      deleteTitle="删除患者"
      deleteMessage="确定删除该患者档案吗？"
      renderForm={(ctx) => {
        const form = ctx.form;
        const update = ctx.update;
        return (
          <>
            <label>
              患者编号
              <input value={form.code} onChange={(event) => update({ code: event.target.value })} />
            </label>
            <label>
              姓名
              <input value={form.name} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label>
              性别
              <select value={form.gender} onChange={(event) => update({ gender: event.target.value })}>
                {Object.entries(GENDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              手机号
              <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} />
            </label>
            <label>
              出生日期
              <input type="date" value={form.birthDate} onChange={(event) => update({ birthDate: event.target.value })} />
            </label>
            <label>
              身份证号
              <input value={form.idCard} onChange={(event) => update({ idCard: event.target.value })} />
            </label>
            <label>
              地址
              <input value={form.address} onChange={(event) => update({ address: event.target.value })} />
            </label>
            <label>
              职业
              <input value={form.occupation} onChange={(event) => update({ occupation: event.target.value })} />
            </label>
            <label>
              来源
              <select value={form.source} onChange={(event) => update({ source: event.target.value })}>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              头像地址
              <input value={form.avatar} onChange={(event) => update({ avatar: event.target.value })} />
            </label>
            <label>
              过敏史（每行一条）
              <textarea value={form.allergies} onChange={(event) => update({ allergies: event.target.value })} />
            </label>
            <label>
              既往病史（每行一条）
              <textarea value={form.medicalHistory} onChange={(event) => update({ medicalHistory: event.target.value })} />
            </label>
            <label>
              用药史（每行一条）
              <textarea value={form.medicationHistory} onChange={(event) => update({ medicationHistory: event.target.value })} />
            </label>
            <label>
              全身疾病（每行一条）
              <textarea value={form.systemicDiseases} onChange={(event) => update({ systemicDiseases: event.target.value })} />
            </label>
            <label>
              标签（每行一条）
              <textarea value={form.tags} onChange={(event) => update({ tags: event.target.value })} />
            </label>
            <label>
              备注
              <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
            </label>
            <label>
              <input type="checkbox" checked={form.active} onChange={(event) => update({ active: event.target.checked })} />
              启用档案
            </label>
          </>
        );
      }}
    />
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n');
  if (value === null || value === undefined) return '';
  return String(value);
}
