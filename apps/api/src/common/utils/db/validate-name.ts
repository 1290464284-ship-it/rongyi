const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateTableName(name: string): boolean {
  return TABLE_NAME_REGEX.test(name);
}

export function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}

export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}
