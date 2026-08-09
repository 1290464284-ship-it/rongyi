import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { LoadingState, PageError } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  DOCTOR: '医生',
};

const PERMISSION_KEYS = [
  'dashboard',
  'patients',
  'clinical',
  'finance',
  'inventory',
  'analytics',
  'communication',
  'hr',
  'system',
];

const PERMISSION_LABELS: Record<string, string> = {
  dashboard: '经营报表',
  patients: '患者与预约',
  clinical: '临床诊疗',
  finance: '收费财务',
  inventory: '库存采购',
  analytics: '经营分析',
  communication: '随访微信',
  hr: '人事排班',
  system: '系统管理',
};

export function PermissionsPage() {
  const { showToast } = useToast();
  const [activeRole, setActiveRole] = useState('DOCTOR');
  const [form, setForm] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const permissions = useQuery({
    queryKey: ['role-permissions', activeRole],
    queryFn: () => apiRequest<{
      items: Array<{ resource: string; allowed: boolean }>;
      defaults: string[];
      effective: string[];
    }>(`/role-permissions/${activeRole}`),
  });

  if (permissions.isLoading) return <LoadingState />;
  if (permissions.error) return <PageError message={(permissions.error as Error).message} />;

  const effectiveKeys = new Set(permissions.data?.effective ?? []);
  function checked(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(form, key)
      ? Boolean(form[key])
      : effectiveKeys.has(key);
  }

  function changeRole(role: string) {
    setForm({});
    setActiveRole(role);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest(`/role-permissions/${activeRole}`, {
        method: 'PUT',
        body: JSON.stringify({
          permissions: PERMISSION_KEYS.map((key) => ({
            resource: key,
            allowed: checked(key),
          })),
        }),
      });
      showToast('角色权限已更新', 'success');
      await permissions.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存角色权限失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>权限配置</h1>
      </div>
      <div className="tabs" role="tablist">
        {Object.entries(ROLE_LABELS).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            className={value === activeRole ? 'tab active' : 'tab'}
            onClick={() => changeRole(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        <h2>{ROLE_LABELS[activeRole] ?? activeRole}默认模块权限</h2>
        <p className="table-muted">勾选后该角色全部员工默认可访问对应模块，仍可在员工管理中按人单独调整。</p>
        <div className="role-checkbox-group">
          {PERMISSION_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checked(key)}
                disabled={busy}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {PERMISSION_LABELS[key] ?? key}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button disabled={busy} onClick={() => void save()}>
            {busy ? '保存中...' : '保存角色权限'}
          </button>
        </div>
      </div>
    </div>
  );
}
