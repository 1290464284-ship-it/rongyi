import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { ConfirmDialog, DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

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

export function PatientsPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PatientForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const query = useQuery({
    queryKey: ['patients-page', search, page],
    queryFn: () => apiRequest<Page<PatientRow>>(
      `/resources/patients?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    ),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(row: PatientRow) {
    setEditingId(row.id);
    setForm({
      code: row.code ?? '',
      name: row.name ?? '',
      gender: row.gender ?? 'UNKNOWN',
      phone: row.phone ?? '',
      birthDate: row.birthDate ?? '',
      idCard: String(row.idCard ?? ''),
      address: String(row.address ?? ''),
      occupation: String(row.occupation ?? ''),
      source: row.source ?? 'WALK_IN',
      active: Boolean(row.active),
      avatar: String(row.avatar ?? ''),
      allergies: joinLines(row.allergies),
      medicalHistory: joinLines(row.medicalHistory),
      medicationHistory: joinLines(row.medicationHistory),
      systemicDiseases: joinLines(row.systemicDiseases),
      tags: joinLines(row.tags),
      remark: String(row.remark ?? ''),
    });
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (form.phone || form.code) {
        const duplicateCheck = await apiRequest<Page<PatientRow>>(
          `/resources/patients?page=1&pageSize=10&search=${encodeURIComponent(form.phone || form.code)}`,
        );
        const duplicate = duplicateCheck.items.find((row) => row.id !== editingId && (
          (form.phone && String(row.phone ?? '') === form.phone) ||
          (form.code && String(row.code ?? '') === form.code)
        ));
        if (duplicate) {
          showToast('手机号或患者编号已存在，请检查后重试', 'error');
          return;
        }
      }
      const payload = {
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
      };
      if (editingId) {
        await apiRequest(`/resources/patients/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/resources/patients', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      showToast(editingId ? '患者档案已更新' : '患者档案已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/resources/patients/${deleteTarget}`, { method: 'DELETE' });
      setDeleteTarget(null);
      showToast('患者档案已删除', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const rows = query.data?.items ?? [];
  const columns = [
    { key: 'code', label: '编号' },
    { key: 'name', label: '姓名' },
    {
      key: 'gender',
      label: '性别',
      render: (row: PatientRow) => GENDER_LABELS[String(row.gender ?? '')] ?? String(row.gender ?? ''),
    },
    { key: 'phone', label: '电话' },
    { key: 'birthDate', label: '出生日期' },
    {
      key: 'source',
      label: '来源',
      render: (row: PatientRow) => SOURCE_LABELS[String(row.source ?? '')] ?? String(row.source ?? ''),
    },
    {
      key: 'active',
      label: '启用',
      render: (row: PatientRow) => row.active ? '是' : '否',
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: PatientRow) => (
        <>
          <button onClick={() => openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => setDeleteTarget(row.id)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>患者档案</h1>
        <button onClick={openCreate}>新建患者</button>
      </div>
      <input
        className="search"
        placeholder="搜索编号、姓名或手机号"
        aria-label="搜索患者"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {rows.length === 0 ? (
        <EmptyState message="暂无患者" />
      ) : (
        <DataTable columns={columns} rows={rows} keyField="id" />
      )}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button disabled={!query.data || page * 20 >= query.data.total} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>

      <Dialog open={showForm} title={editingId ? '编辑患者' : '新建患者'} onClose={() => setShowForm(false)}>
        <form onSubmit={submit}>
          <label>
            患者编号
            <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
          </label>
          <label>
            姓名
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            性别
            <select value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}>
              {Object.entries(GENDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            手机号
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </label>
          <label>
            出生日期
            <input type="date" value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} />
          </label>
          <label>
            身份证号
            <input value={form.idCard} onChange={(event) => setForm((current) => ({ ...current, idCard: event.target.value }))} />
          </label>
          <label>
            地址
            <input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          </label>
          <label>
            职业
            <input value={form.occupation} onChange={(event) => setForm((current) => ({ ...current, occupation: event.target.value }))} />
          </label>
          <label>
            来源
            <select value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            头像地址
            <input value={form.avatar} onChange={(event) => setForm((current) => ({ ...current, avatar: event.target.value }))} />
          </label>
          <label>
            过敏史（每行一条）
            <textarea value={form.allergies} onChange={(event) => setForm((current) => ({ ...current, allergies: event.target.value }))} />
          </label>
          <label>
            既往病史（每行一条）
            <textarea value={form.medicalHistory} onChange={(event) => setForm((current) => ({ ...current, medicalHistory: event.target.value }))} />
          </label>
          <label>
            用药史（每行一条）
            <textarea value={form.medicationHistory} onChange={(event) => setForm((current) => ({ ...current, medicationHistory: event.target.value }))} />
          </label>
          <label>
            全身疾病（每行一条）
            <textarea value={form.systemicDiseases} onChange={(event) => setForm((current) => ({ ...current, systemicDiseases: event.target.value }))} />
          </label>
          <label>
            标签（每行一条）
            <textarea value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} />
          </label>
          <label>
            备注
            <textarea value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} />
          </label>
          <label>
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
            启用档案
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除患者"
        message="确定删除该患者档案吗？"
        confirmText="确认删除"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
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
