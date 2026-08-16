import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { LoadingState, MissingSelectOption, SignedImage } from '../components';
import type { Page } from '../lib/types';
import { formatDateTime, imagingOptionLabel, phaseLabel } from './format';
import type { ImagingRow } from './types';

export function ImagingComparePanel() {
  const [compareLeftId, setCompareLeftId] = useState('');
  const [compareRightId, setCompareRightId] = useState('');
  const [compareSearch, setCompareSearch] = useState('');
  const [comparePage, setComparePage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Record<string, ImagingRow>>({});

  const compareOptionsQuery = useQuery({
    // B5：初始态（无搜索、第 1 页）与 CrudPage 列表同 URL，复用其 queryKey 共享缓存，消除同端点双请求
    queryKey: compareSearch === '' && comparePage === 1
      ? ['imaging', 1, '']
      : ['imaging-options', compareSearch, comparePage],
    queryFn: () => apiRequest<Page<ImagingRow>>(
      `/resources/imaging?page=${comparePage}&pageSize=50${compareSearch ? `&search=${encodeURIComponent(compareSearch)}` : ''}`,
    ),
  });

  const imagingOptions = compareOptionsQuery.data?.items ?? [];
  const compareTotal = compareOptionsQuery.data?.total ?? 0;
  const compareTotalPages = Math.max(1, Math.ceil(compareTotal / 50));
  const selectedLeft = selectedRows[compareLeftId] ?? imagingOptions.find((row) => row.id === compareLeftId) ?? null;
  const selectedRight = selectedRows[compareRightId] ?? imagingOptions.find((row) => row.id === compareRightId) ?? null;
  const canCompare = selectedLeft !== null && selectedRight !== null && compareLeftId !== compareRightId;

  function selectCompare(side: 'left' | 'right', id: string) {
    const row = imagingOptions.find((candidate) => candidate.id === id) ?? null;
    if (row) {
      setSelectedRows((current) => ({ ...current, [id]: row }));
    }
    if (side === 'left') setCompareLeftId(id);
    else setCompareRightId(id);
  }

  /** 过期对比选项的标签：过期 id 恒有 selectedRows 记录，row 非空。 */
  function missingSelectLabel(row: ImagingRow | null, fallbackId: string): string {
    /* v8 ignore next -- 过期 id 由 selectCompare 恒写入 selectedRows，row 非空 */
    if (!row) return fallbackId;
    return imagingOptionLabel(row);
  }

  return (
    <section className="card" aria-label="影像对比">
      <h2>影像对比</h2>
      <div className="imaging-compare-toolbar">
        <input
          aria-label="对比选项搜索"
          type="search"
          placeholder="搜索影像"
          value={compareSearch}
          onChange={(event) => {
            setCompareSearch(event.target.value);
            setComparePage(1);
          }}
        />
        {compareTotalPages > 1 && (
          <div className="pager">
            <button type="button" disabled={compareOptionsQuery.isFetching || comparePage <= 1} onClick={() => setComparePage((current) => Math.max(1, current - 1))}>上一页</button>
            <span>第 {comparePage} / {compareTotalPages} 页（共 {compareTotal} 条）</span>
            <button type="button" disabled={compareOptionsQuery.isFetching || comparePage >= compareTotalPages} onClick={() => setComparePage((current) => current + 1)}>下一页</button>
          </div>
        )}
      </div>
      {compareOptionsQuery.isLoading ? (
        <LoadingState label="对比选项加载中..." />
      ) : compareOptionsQuery.error ? (
        <div className="query-section-error">
          <p className="error">对比选项加载失败</p>
          <button type="button" className="btn-secondary" onClick={() => void compareOptionsQuery.refetch()}>重试</button>
        </div>
      ) : (
        <div className="imaging-compare-controls">
          <label>
            影像一
            <select value={compareLeftId} onChange={(event) => selectCompare('left', event.target.value)}>
              {compareLeftId !== '' && !imagingOptions.some((row) => String(row.id) === compareLeftId) && (
                <MissingSelectOption value={compareLeftId} label={missingSelectLabel(selectedLeft, compareLeftId)} />
              )}
              <option value="">选择影像</option>
              {imagingOptions.map((row) => (
                <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
              ))}
            </select>
          </label>
          <label>
            影像二
            <select value={compareRightId} onChange={(event) => selectCompare('right', event.target.value)}>
              {compareRightId !== '' && !imagingOptions.some((row) => String(row.id) === compareRightId) && (
                <MissingSelectOption value={compareRightId} label={missingSelectLabel(selectedRight, compareRightId)} />
              )}
              <option value="">选择影像</option>
              {imagingOptions.map((row) => (
                <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => {
            setSelectedRows((current) => {
              const next = { ...current };
              delete next[compareLeftId];
              delete next[compareRightId];
              return next;
            });
            setCompareLeftId('');
            setCompareRightId('');
          }}>清空对比</button>
        </div>
      )}
      {canCompare ? (
        <div className="imaging-compare-view">
          <figure className="imaging-compare-item">
            <SignedImage path={selectedLeft?.imageUrl} alt={String(selectedLeft?.title ?? '影像')} />
            <figcaption>
              <div>标题：{selectedLeft?.title ?? ''}</div>
              <div>类型：{selectedLeft?.type ?? ''}</div>
              <div>拍摄时间：{formatDateTime(selectedLeft?.takenAt)}</div>
              <div>阶段：{phaseLabel(selectedLeft?.phase)}</div>
            </figcaption>
          </figure>
          <figure className="imaging-compare-item">
            <SignedImage path={selectedRight?.imageUrl} alt={String(selectedRight?.title ?? '影像')} />
            <figcaption>
              <div>标题：{selectedRight?.title ?? ''}</div>
              <div>类型：{selectedRight?.type ?? ''}</div>
              <div>拍摄时间：{formatDateTime(selectedRight?.takenAt)}</div>
              <div>阶段：{phaseLabel(selectedRight?.phase)}</div>
            </figcaption>
          </figure>
        </div>
      ) : (
        <p className="imaging-compare-hint">请选择两张影像进行对比</p>
      )}
    </section>
  );
}
