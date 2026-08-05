import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page, ResourceField } from './types';

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
      <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择...</option>
        {field.enumValues?.map((option) => (
          <option key={option} value={option}>{field.enumLabels?.[option] ?? option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'relation' && field.relation) {
    return <RelationSelect fieldId={field.name} relation={field.relation} value={value} onChange={onChange} />;
  }
  if (field.inputType === 'textarea' || field.type === 'longText' || field.type === 'json') {
    return <textarea value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
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
  onChange,
}: {
  fieldId: string;
  relation: { resource: string; labelField: string };
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['relation-options', relation.resource, search, page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/${relation.resource}?page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    ),
  });
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? items.length;

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
        }}
      />
      <select id={fieldId} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择...</option>
        {items.map((item) => (
          <option key={String(item.id)} value={String(item.id)}>{String(item[relation.labelField] ?? item.id)}</option>
        ))}
      </select>
      {page * 50 < total && (
        <button type="button" className="relation-load-more" onClick={() => setPage((current) => current + 1)}>
          加载更多
        </button>
      )}
    </>
  );
}
