export function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function listToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }
  return textValue(value);
}
