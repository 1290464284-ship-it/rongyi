import { useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { LoadingState, PageError } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  ADMIN: '管理员',
  DOCTOR: '医生',
};

const PERMISSION_KEYS = [
  'dashboard',
  'frontDesk',
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
  frontDesk: '前台工作',
  patients: '患者档案',
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
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const roleEntries = Object.entries(ROLE_LABELS);

  const permissions = useQuery({
    queryKey: ['role-permissions', activeRole],
    queryFn: () => apiRequest<{
      items: Array<{ resource: string; allowed: boolean }>;
      defaults: string[];
      effective: string[];
    }>(`/role-permissions/${activeRole}`),
  });

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

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % roleEntries.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + roleEntries.length) % roleEntries.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = roleEntries.length - 1;
    else return;
    event.preventDefault();
    const [role] = roleEntries[next];
    changeRole(role);
    tabRefs.current.get(role)?.focus();
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
        {roleEntries.map(([value, label], index) => (
          <button
            key={value}
            ref={(node) => {
              if (node) tabRefs.current.set(value, node);
              else tabRefs.current.delete(value);
            }}
            id={`permission-tab-${value}`}
            role="tab"
            type="button"
            disabled={busy}
            aria-selected={value === activeRole}
            aria-controls="permissions-panel"
            tabIndex={value === activeRole ? 0 : -1}
            className={value === activeRole ? 'tab active' : 'tab'}
            onClick={() => changeRole(value)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="permissions-panel" role="tabpanel" aria-labelledby={`permission-tab-${activeRole}`} className="tab-panel">
        {permissions.isLoading ? (
          <LoadingState />
        ) : permissions.error ? (
          <PageError message={(permissions.error as Error).message} />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
