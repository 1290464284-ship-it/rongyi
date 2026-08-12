import { SignedImage, type DataTableColumn } from '../components';
import { CATEGORY_TYPE_LABELS } from './constants';
import { categoryName, formatDateTime, phaseLabel } from './format';
import type { ImagingCategoryRow, ImagingRow } from './types';

export function imagingColumns(categories: ImagingCategoryRow[]): DataTableColumn<ImagingRow>[] {
  return [
    {
      key: 'preview',
      label: '预览',
      render: (row) => (
        <SignedImage
          path={row.imageUrl}
          alt={String(row.title ?? '影像')}
          className="imaging-thumb"
          fallback="无图片"
        />
      ),
    },
    { key: 'title', label: '标题' },
    { key: 'type', label: '类型' },
    { key: 'categoryId', label: '分类', render: (row) => categoryName(row, categories) },
    { key: 'phase', label: '阶段', render: (row) => phaseLabel(row.phase) },
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
    {
      key: 'takenAt',
      label: '拍摄时间',
      render: (row) => formatDateTime(row.takenAt),
    },
  ];
}

export function categoryColumns(handlers: {
  onEdit: (row: ImagingCategoryRow) => void;
  onToggle: (row: ImagingCategoryRow) => void;
  onDelete: (row: ImagingCategoryRow) => void;
  toggleBusyId?: string | null;
}): DataTableColumn<ImagingCategoryRow>[] {
  return [
    { key: 'name', label: '名称' },
    {
      key: 'type',
      label: '类型',
      render: (row) => CATEGORY_TYPE_LABELS[String(row.type ?? '')] ?? String(row.type ?? ''),
    },
    { key: 'sortOrder', label: '排序', render: (row) => String(row.sortOrder ?? 0) },
    { key: 'active', label: '状态', render: (row) => (row.active ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button type="button" onClick={() => handlers.onEdit(row)}>编辑</button>
          <button
            type="button"
            disabled={handlers.toggleBusyId === String(row.id)}
            onClick={() => handlers.onToggle(row)}
          >
            {row.active ? '停用' : '启用'}
          </button>
          <button type="button" className="danger" onClick={() => handlers.onDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}
