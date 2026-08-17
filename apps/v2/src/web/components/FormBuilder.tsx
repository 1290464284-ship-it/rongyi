import { friendlyError } from '../lib/messages';
import type { ResourceField } from '../lib/types';
import { MissingSelectOption } from '../components';
import { useRemoteSearch, type RemoteSearchRow } from '../hooks/use-remote-search';

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
  const {
    search,
    setSearch,
    page,
    loadMore,
    loaded,
    isFetching,
    error,
    canLoadMore,
    loadCapped,
  } = useRemoteSearch<RemoteSearchRow>({
    resource: relation.resource,
    pageSize: 50,
    keepPreviousData: true,
    queryKeyPrefix: 'relation-options',
    mergeMode: 'replace',
    canLoadMore: ({ page, pageSize, total }) => page * pageSize < total,
  });
  const selectedMissing = value !== undefined && value !== null && String(value) !== ''
    && !loaded.some((item) => String(item.id) === String(value));

  return (
    <>
      <input
        className="relation-search"
        id={`${fieldId}-search`}
        aria-label={`搜索${relation.resource}`}
        placeholder="搜索关联记录"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select id={fieldId} value={String(value ?? '')} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择...</option>
        {loaded.map((item) => (
          <option key={String(item.id)} value={String(item.id)}>{String(item[relation.labelField] ?? item.id)}</option>
        ))}
        {selectedMissing && <MissingSelectOption value={value} />}
      </select>
      {canLoadMore && (loadCapped ? (
        <span className="relation-load-cap">数据较多，仅展示前 {page * 50} 条，请使用搜索筛选</span>
      ) : (
        <button type="button" className="relation-load-more" disabled={isFetching} onClick={loadMore}>
          {isFetching ? '加载中...' : '加载更多'}
        </button>
      ))}
      {error && <span className="error">{friendlyError(error)}</span>}
    </>
  );
}
