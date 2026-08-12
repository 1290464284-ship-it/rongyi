import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { useDebouncedValue } from '../hooks/use-debounce';
import { friendlyError } from '../lib/messages';
import type { Page, ResourceField } from '../lib/types';

interface FormBuilderProps {
  fields: ResourceField[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

export function FormBuilder({ fields, values, onChange }: FormBuilderProps) {
  return (
    <>
      {fields.map((field) => field.type === 'relation' ? (
        <div className="field-group" key={field.name}>
          <label htmlFor={field.name}>{field.label ?? field.name}</label>
          {renderField(field, values[field.name], (value) => onChange(field.name, value))}
          {field.helpText && <small>{field.helpText}</small>}
        </div>
      ) : (
        <label key={field.name}>
          {field.label ?? field.name}
          {renderField(field, values[field.name], (value) => onChange(field.name, value))}
          {field.helpText && <small>{field.helpText}</small>}
        </label>
      ))}
    </>
  );
}

function renderField(field: ResourceField, value: unknown, onChange: (value: unknown) => void) {
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (field.type === 'enum') {
    return (
      <select value={String(value ?? '')} required={field.required} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择...</option>
        {field.enumValues?.map((option) => (
          <option key={option} value={option}>{field.enumLabels?.[option] ?? option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'relation' && field.relation) {
    return <RelationSelect fieldId={field.name} relation={field.relation} value={value} required={field.required} onChange={onChange} />;
  }
  if (field.inputType === 'textarea' || field.type === 'longText' || field.type === 'json') {
    return (
      <textarea
        value={String(value ?? '')}
        required={field.required}
        maxLength={field.maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const inputType = field.inputType === 'datetime' || field.type === 'datetime'
    ? 'datetime-local'
    : field.inputType === 'date' || field.type === 'date'
      ? 'date'
      : field.type === 'number' || field.type === 'money' || field.type === 'decimal'
        ? 'number'
        : 'text';
  return (
    <input
      type={inputType}
      value={String(value ?? '')}
      required={field.required}
      maxLength={field.maxLength}
      step={field.type === 'money' || field.type === 'decimal' ? '0.01' : undefined}
      placeholder={field.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RelationSelect({
  fieldId,
  relation,
  value,
  required,
  onChange,
}: {
  fieldId: string;
  relation: { resource: string; labelField: string };
  value: unknown;
  required?: boolean;
  onChange: (value: unknown) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<Record<string, unknown>[]>([]);
  const debouncedSearch = useDebouncedValue(search, 300);
  const queryKey = ['relation-options', relation.resource, debouncedSearch, page];
  const queryKeyJson = JSON.stringify(queryKey);
  const query = useQuery({
    queryKey,
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/${relation.resource}?page=${page}&pageSize=50${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
    ),
    placeholderData: (previous) => previous,
  });
  // Accumulate options across pages so「加载更多」never drops previously selected rows.
  // 渲染期调整（React 官方模式）：仅同一查询键的新数据到达时合并，搜索变化后的旧数据不再合并回来。
  const [prevSnapshot, setPrevSnapshot] = useState<{ key: string; data: Page<Record<string, unknown>> | undefined } | undefined>(undefined);
  if (!prevSnapshot || prevSnapshot.key !== queryKeyJson || prevSnapshot.data !== query.data) {
    const previous = prevSnapshot;
    setPrevSnapshot({ key: queryKeyJson, data: query.data });
    if ((previous === undefined || previous.key === queryKeyJson) && query.data) {
      const incoming = query.data.items;
      if (incoming) {
      setAccumulated((current) => {
        if (page === 1 || current.length === 0) return incoming;
        const seen = new Set(current.map((item) => String(item.id)));
        const fresh = incoming.filter((item) => !seen.has(String(item.id)));
        return fresh.length > 0 ? [...current, ...fresh] : current;
      });
      }
    }
  }
  const items = accumulated;
  const total = query.isPlaceholderData ? accumulated.length : (query.data?.total ?? accumulated.length);
  const MAX_LOAD_PAGES = 10;
  const canLoadMore = page * 50 < total;
  const loadCapped = canLoadMore && page >= MAX_LOAD_PAGES;

  return (
    <>
      <input
        className="relation-search"
        id={`${fieldId}-search`}
        aria-label={`搜索${relation.resource}`}
        placeholder="搜索关联记录"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
          setAccumulated([]);
        }}
      />
      <select id={fieldId} value={String(value ?? '')} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择...</option>
        {items.map((item) => (
          <option key={String(item.id)} value={String(item.id)}>{String(item[relation.labelField] ?? item.id)}</option>
        ))}
      </select>
      {canLoadMore && (loadCapped ? (
        <span className="relation-load-cap">数据较多，仅展示前 {page * 50} 条，请使用搜索筛选</span>
      ) : (
        <button type="button" className="relation-load-more" disabled={query.isFetching} onClick={() => setPage((current) => current + 1)}>
          {query.isFetching ? '加载中...' : '加载更多'}
        </button>
      ))}
      {query.error && <span className="error">{friendlyError(query.error)}</span>}
    </>
  );
}
