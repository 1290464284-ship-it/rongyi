import { FormEvent, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { apiRequest } from './api';
import type { Page, ResourceDefinition, ResourceField } from './types';

const PROTECTED_UI_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'tokenHash',
  'role',
  'loginAttempts',
  'lockedUntil',
  'tokenVersion',
  'balance',
  'totalRecharge',
  'totalConsume',
  'points',
  'totalPoints',
  'stock',
  'minStock',
  'paidAmount',
  'refundedAmount',
]);

function fieldValue(field: ResourceField, value: unknown): unknown {
  if (field.type === 'json') {
    if (typeof value !== 'string') return JSON.stringify(value ?? '{}');
    return value;
  }
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'number' || field.type === 'money') return Number(value ?? 0);
  return value ?? '';
}

function fieldToForm(field: ResourceField, value: unknown): string | boolean {
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'json') return JSON.stringify(value ?? '', null, 2);
  if (value === null || value === undefined) return '';
  return String(value);
}

export function ResourcePage({ resource: fixedResource }: { resource?: string }) {
  const params = useParams<{ resource: string }>();
  const resource = fixedResource ?? params.resource ?? 'patients';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  const metaQuery = useQuery({
    queryKey: ['resource-meta'],
    queryFn: () => apiRequest<ResourceDefinition[]>('/resource-meta'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const definition = metaQuery.data?.find((item) => item.name === resource);

  const listQuery = useQuery({
    queryKey: ['resource', resource, search, page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/${resource}?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    ),
    enabled: Boolean(definition),
  });

  const editableFields = useMemo(
    () => (definition?.fields ?? []).filter((field) => !PROTECTED_UI_FIELDS.has(field.name)),
    [definition],
  );

  function openCreate() {
    const initial: Record<string, unknown> = {};
    for (const field of editableFields) {
      if (field.type === 'boolean') initial[field.name] = false;
      else if (field.type === 'json') initial[field.name] = '{}';
    }
    setEditingId(null);
    setForm(initial);
    setShowForm(true);
  }

  function openEdit(row: Record<string, unknown>) {
    const initial: Record<string, unknown> = {};
    for (const field of editableFields) {
      initial[field.name] = fieldToForm(field, row[field.name]);
    }
    setEditingId(String(row.id));
    setForm(initial);
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const field of editableFields) {
      if (form[field.name] === '' && !field.required) continue;
      payload[field.name] = fieldValue(field, form[field.name]);
    }
    if (editingId) {
      await apiRequest(`/resources/${resource}/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await apiRequest(`/resources/${resource}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    setShowForm(false);
    await listQuery.refetch();
  }

  async function remove(id: string) {
    if (!confirm('Delete this record?')) return;
    await apiRequest(`/resources/${resource}/${id}`, { method: 'DELETE' });
    await listQuery.refetch();
  }

  if (metaQuery.isLoading || listQuery.isLoading) return <div className="page">Loading...</div>;
  if (!definition || listQuery.error) {
    return <div className="page error">{(listQuery.error as Error)?.message ?? 'Resource not found'}</div>;
  }

  const rows = listQuery.data?.items ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]).filter((column) => !PROTECTED_UI_FIELDS.has(column)) : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{resource}</h1>
        {definition.capabilities.create && <button onClick={openCreate}>Create</button>}
      </div>
      <input
        className="search"
        placeholder="Search..."
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {rows.length === 0 ? (
        <p>No records.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}<th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
                  <td>
                    {definition.capabilities.update && (
                      <button onClick={() => openEdit(row)}>Edit</button>
                    )}
                    {definition.capabilities.delete && (
                      <button className="danger" onClick={() => remove(String(row.id))}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>Page {page}</span>
        <button disabled={!listQuery.data || page * 20 >= listQuery.data.total} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={submit}>
            <h2>{editingId ? 'Edit' : 'Create'} {resource}</h2>
            {editableFields.map((field) => (
              <label key={field.name}>
                {field.name}
                {renderField(field, form[field.name], (value) => setForm((current) => ({ ...current, [field.name]: value })))}
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function renderField(field: ResourceField, value: unknown, onChange: (value: unknown) => void) {
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (field.type === 'enum') {
    return (
      <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select...</option>
        {field.enumValues?.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === 'relation' && field.relation) {
    return <RelationSelect relation={field.relation} value={value} onChange={onChange} />;
  }
  if (field.type === 'longText' || field.type === 'json') {
    return <textarea value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
}

function RelationSelect({
  relation,
  value,
  onChange,
}: {
  relation: { resource: string; labelField: string };
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { data } = useQuery({
    queryKey: ['relation-options', relation.resource],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/${relation.resource}?page=1&pageSize=200`),
  });
  return (
    <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select...</option>
      {data?.items.map((item) => (
        <option key={String(item.id)} value={String(item.id)}>{String(item[relation.labelField] ?? item.id)}</option>
      ))}
    </select>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
