import { FormEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { ConfirmDialog, DataTable, Dialog, LoadingState, PageError, SearchInput, SearchableSelect } from '../../components';
import { errorMessage } from '../../lib/messages';
import { toLocalInput } from '../../lib/format';
import { useToast } from '../../lib/toast-context';
import { useDebouncedValue } from '../../hooks/use-debounce';
import { APPOINTMENT_TYPE_LABELS } from '../../lib/labels';
import { parseLocalDateTime } from '../../appointments/date';
import { appointmentColumns } from '../../appointments/columns';
import { createInFlightGuard } from '../../lib/in-flight';
import type { AppointmentRow, AppointmentForm, PurposeRow, LookupRow } from '../../appointments/types';
import { AppointmentPurposePanel } from './AppointmentPurposePanel';

const transitionGuard = createInFlightGuard();

export function AppointmentsPage({ initialSearch }: { initialSearch?: string } = {}) {
  const { showToast } = useToast();
  const [searchInput, setSearchInput] = useState(initialSearch ?? '');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [chairId, setChairId] = useState('');
  const [type, setType] = useState('REGULAR');
  const [purpose, setPurpose] = useState('');
  const [page, setPage] = useState(1);
  const [tempPatientName, setTempPatientName] = useState('');
  const [tempPatientPhone, setTempPatientPhone] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const createBusyRef = useRef(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentRow | null>(null);
  // 编辑回填用原始电话缓存（列表行可能被服务端掩码，详情接口返回原始值）
  const [rawPhoneCache, setRawPhoneCache] = useState<Record<string, string>>({});
  const editingPhoneFetchRef = useRef(0);
  const [editForm, setEditForm] = useState<AppointmentForm>({
    patientId: '',
    doctorId: '',
    chairId: '',
    type: 'REGULAR',
    purpose: '',
    tempPatientName: '',
    tempPatientPhone: '',
    startTime: '',
    endTime: '',
  });
  const [deleteTarget, setDeleteTarget] = useState<AppointmentRow | null>(null);

  const doctors = useQuery({
    queryKey: ['appointment-doctors'],
    queryFn: () => apiRequest<Array<LookupRow>>('/doctors'),
  });
  const purposes = useQuery({
    queryKey: ['appointment-purposes'],
    queryFn: () => apiRequest<Page<PurposeRow>>('/resources/appointmentPurposes?page=1&pageSize=100'),
  });
  const query = useQuery({
    queryKey: ['appointments', page, debouncedSearch],
    queryFn: () => apiRequest<Page<AppointmentRow>>(
      `/resources/appointments?page=${page}&pageSize=20${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
    ),
    placeholderData: (previous) => previous,
  });
  const stale = query.isPlaceholderData;

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (createBusyRef.current) return;
    const tempName = tempPatientName.trim();
    const startDate = parseLocalDateTime(startTime);
    const endDate = parseLocalDateTime(endTime);
    if (!(patientId || tempName) || !doctorId || !startTime || !endTime || !startDate || !endDate) {
      showToast('请选择患者、医生并填写开始和结束时间', 'error');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      showToast('结束时间必须晚于开始时间', 'error');
      return;
    }
    createBusyRef.current = true;
    setSubmitting(true);
    try {
      await apiRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patientId || undefined,
          doctorId,
          chairId: chairId || undefined,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          type,
          purpose: purpose || undefined,
          tempPatientName: tempName || undefined,
          tempPatientPhone: tempPatientPhone.trim() || undefined,
        }),
      });
      showToast('预约已创建', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建预约失败'), 'error');
    } finally {
      createBusyRef.current = false;
      setSubmitting(false);
    }
  }

  async function transition(id: string, status: string) {
    if (stale) return;
    if (!transitionGuard.start(id)) return;
    try {
      await apiRequest(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('预约状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    } finally {
      transitionGuard.finish(id);
    }
  }

  function openEditAppointment(row: AppointmentRow) {
    if (stale) return;
    const appointmentId = String(row.id);
    const cachedPhone = rawPhoneCache[appointmentId];
    setEditForm({
      patientId: String(row.patientId ?? ''),
      doctorId: String(row.doctorId ?? ''),
      chairId: String(row.chairId ?? ''),
      type: String(row.type ?? 'REGULAR'),
      purpose: String(row.purpose ?? ''),
      tempPatientName: String(row.tempPatientName ?? ''),
      tempPatientPhone: cachedPhone ?? String(row.tempPatientPhone ?? ''),
      startTime: toLocalInput(row.startTime),
      endTime: toLocalInput(row.endTime),
    });
    setEditingAppointment(row);
    if (cachedPhone === undefined) {
      // 列表行电话可能被服务端掩码，详情接口返回原始值；异步回填并缓存，保存仍提交 editForm.tempPatientPhone
      const requestId = ++editingPhoneFetchRef.current;
      void apiRequest<AppointmentRow>(`/resources/appointments/${appointmentId}`)
        .then((detail) => {
          if (editingPhoneFetchRef.current !== requestId) return;
          const raw = detail?.tempPatientPhone;
          if (raw === null || raw === undefined) return;
          setRawPhoneCache((current) => ({ ...current, [appointmentId]: String(raw) }));
          setEditForm((current) => ({ ...current, tempPatientPhone: String(raw) }));
        })
        .catch(() => {
          // 详情加载失败时保留行内值（可能为掩码），不阻塞编辑
        });
    }
  }

  function closeEditAppointment() {
    // 使在途的详情回填失效，避免关闭后写入已不复存在的编辑表单
    editingPhoneFetchRef.current += 1;
    setEditingAppointment(null);
  }

  async function saveEditAppointment(event: FormEvent) {
    event.preventDefault();
    if (!editingAppointment || submitting) return;
    const startDate = parseLocalDateTime(editForm.startTime);
    const endDate = parseLocalDateTime(editForm.endTime);
    if (!editForm.doctorId || !editForm.startTime || !editForm.endTime || !startDate || !endDate) {
      showToast('请选择医生并填写开始和结束时间', 'error');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      showToast('结束时间必须晚于开始时间', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/resources/appointments/${editingAppointment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          patientId: editForm.patientId || undefined,
          doctorId: editForm.doctorId,
          chairId: editForm.chairId || undefined,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          type: editForm.type,
          purpose: editForm.purpose || undefined,
          tempPatientName: editForm.tempPatientName.trim() || undefined,
          tempPatientPhone: editForm.tempPatientPhone.trim() || undefined,
        }),
      });
      showToast('预约已更新', 'success');
      setEditingAppointment(null);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新预约失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteAppointment() {
    if (stale) return;
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/resources/appointments/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('预约已删除', 'success');
      setDeleteTarget(null);
      const refreshed = await query.refetch();
      // 删除末页最后一条时回退一页，避免停留在空页
      if (page > 1 && (refreshed.data?.items?.length ?? 0) === 0) {
        setPage(page - 1);
      }
    } catch (error) {
      showToast(errorMessage(error, '删除预约失败'), 'error');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  // appointmentColumns 仅存储回调供 DataTable 行点击时调用；ref 读取发生在事件处理器中，
  // 不在渲染期 —— react-hooks/refs 静态分析无法区分，属误报
  // eslint-disable-next-line react-hooks/refs
  const columns = appointmentColumns({
    onTransition: (id, status) => void transition(id, status),
    onEdit: (row) => openEditAppointment(row),
    onDelete: (row) => setDeleteTarget(row),
    disabled: stale,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>预约管理</h1>
        <SearchInput
          value={searchInput}
          onChange={(value) => { setSearchInput(value); setPage(1); }}
          placeholder="搜索预约..."
          ariaLabel="搜索预约"
        />
      </div>
      <form className="inline-form" onSubmit={create}>
        <SearchableSelect resource="patients" value={patientId} onChange={setPatientId} ariaLabel="患者" placeholder="选择患者" />
        <select aria-label="医生" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <SearchableSelect resource="chairs" value={chairId} onChange={setChairId} ariaLabel="椅位" placeholder="不指定椅位" />
        <select aria-label="预约类型" value={type} onChange={(event) => setType(event.target.value)}>
          {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select aria-label="预约事项" value={purpose} onChange={(event) => setPurpose(event.target.value)}>
          <option value="">不指定</option>
          {purposes.data?.items?.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <input aria-label="临时患者姓名" type="text" value={tempPatientName} onChange={(event) => setTempPatientName(event.target.value)} placeholder="临时患者姓名" />
        <input aria-label="临时患者电话" type="text" value={tempPatientPhone} onChange={(event) => setTempPatientPhone(event.target.value)} placeholder="临时患者电话" />
        <input aria-label="开始时间" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <input aria-label="结束时间" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        <button type="submit" disabled={submitting}>{submitting ? '创建中...' : '创建预约'}</button>
      </form>
      <AppointmentPurposePanel purposes={purposes} showToast={showToast} />
      <DataTable columns={columns} rows={query.data?.items ?? []} keyField="id" emptyText="暂无预约" />
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button disabled={!query.data || page * 20 >= query.data.total} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>

      <Dialog open={editingAppointment !== null} title="编辑预约" onClose={closeEditAppointment}>
        <form onSubmit={saveEditAppointment}>
          <SearchableSelect resource="patients" value={editForm.patientId} onChange={(value) => setEditForm((current) => ({ ...current, patientId: value }))} ariaLabel="患者" placeholder="选择患者（预约患者）" />
          <select aria-label="医生" value={editForm.doctorId} onChange={(event) => setEditForm((current) => ({ ...current, doctorId: event.target.value }))}>
            <option value="">选择医生</option>
            {doctors.data?.map((row) => (
              <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
            ))}
          </select>
          <SearchableSelect resource="chairs" value={editForm.chairId} onChange={(value) => setEditForm((current) => ({ ...current, chairId: value }))} ariaLabel="椅位" placeholder="不指定椅位" />
          <select aria-label="预约类型" value={editForm.type} onChange={(event) => setEditForm((current) => ({ ...current, type: event.target.value }))}>
            {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select aria-label="预约事项" value={editForm.purpose} onChange={(event) => setEditForm((current) => ({ ...current, purpose: event.target.value }))}>
            <option value="">不指定</option>
            {purposes.data?.items?.map((row) => (
              <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
            ))}
          </select>
          <input aria-label="临时患者姓名" type="text" value={editForm.tempPatientName} onChange={(event) => setEditForm((current) => ({ ...current, tempPatientName: event.target.value }))} placeholder="临时患者姓名" />
          <input aria-label="临时患者电话" type="text" value={editForm.tempPatientPhone} onChange={(event) => setEditForm((current) => ({ ...current, tempPatientPhone: event.target.value }))} placeholder="临时患者电话" />
          <input aria-label="开始时间" type="datetime-local" value={editForm.startTime} onChange={(event) => setEditForm((current) => ({ ...current, startTime: event.target.value }))} />
          <input aria-label="结束时间" type="datetime-local" value={editForm.endTime} onChange={(event) => setEditForm((current) => ({ ...current, endTime: event.target.value }))} />
          <div className="modal-actions">
            <button type="button" onClick={closeEditAppointment}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除预约"
        message={`确定删除该预约吗？删除后不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => deleteAppointment()}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  );
}
