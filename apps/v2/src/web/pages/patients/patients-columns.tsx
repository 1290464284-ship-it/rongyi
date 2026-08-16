import type { DataTableColumn } from '../../components';
import { GENDER_LABELS, PREFERRED_CONTACT_LABELS, SOURCE_LABELS } from './patients-constants';
import type { PatientRow } from './patients-types';

export const patientColumns: DataTableColumn<PatientRow>[] = [
  { key: 'code', label: '编号' },
  { key: 'name', label: '姓名' },
  {
    key: 'gender',
    label: '性别',
    render: (row) => GENDER_LABELS[String(row.gender ?? '')] ?? String(row.gender ?? ''),
  },
  { key: 'phone', label: '电话' },
  { key: 'wechatId', label: '微信号' },
  {
    key: 'preferredContact',
    label: '首选联系',
    // 兜底仅在 preferredContact 为非空未知值时求值（空值时 `?? 'PHONE'` 恒命中标签表 PHONE），故兜底不再 `?? 'PHONE'`。
    render: (row) => PREFERRED_CONTACT_LABELS[String(row.preferredContact ?? 'PHONE')] ?? String(row.preferredContact),
  },
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
