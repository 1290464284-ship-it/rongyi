import type { ResourceDefinition, ResourceField } from '../../domain/contracts';
import {
  resourceLabels,
  fieldLabels,
  commonEnumLabels,
  hiddenFields,
  readOnlyFields,
  helpTexts,
} from './ui-meta-data';
import { STATE_MACHINE_PROTECTED_WRITE_FIELDS } from './security';

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (first) => first.toUpperCase());
}

function formatFor(type: ResourceField['type']): NonNullable<ResourceField['format']> {
  if (type === 'money') return 'money';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  if (type === 'json') return 'json';
  return 'text';
}

function inputTypeFor(type: ResourceField['type']): NonNullable<ResourceField['inputType']> {
  if (type === 'boolean') return 'checkbox';
  if (type === 'enum') return 'select';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  if (type === 'number' || type === 'money') return 'number';
  if (type === 'longText' || type === 'json') return 'textarea';
  return 'text';
}

export function applyUiMeta(definition: ResourceDefinition): ResourceDefinition {
  const resourceLabel = definition.label ?? resourceLabels[definition.name] ?? humanize(definition.name);
  const fields = definition.fields.map((field) => {
    const label = field.label ?? fieldLabels[field.name] ?? humanize(field.name);
    return {
      ...field,
      label,
      enumLabels: field.enumLabels ?? (field.type === 'enum' ? commonEnumLabels : undefined),
      format: field.format ?? formatFor(field.type),
      inputType: field.inputType ?? inputTypeFor(field.type),
      hidden: field.hidden ?? hiddenFields.has(field.name),
      readOnly: field.readOnly ?? (readOnlyFields.has(field.name) || STATE_MACHINE_PROTECTED_WRITE_FIELDS[definition.name]?.has(field.name)),
      placeholder: field.placeholder ?? label,
      helpText: field.helpText ?? helpTexts[field.name],
    };
  });
  return { ...definition, label: resourceLabel, fields };
}
