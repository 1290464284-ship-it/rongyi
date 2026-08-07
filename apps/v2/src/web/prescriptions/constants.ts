export const PRESCRIPTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  PROCESSED: '已处理',
};

export function statusLabel(status: string | null | undefined): string {
  const value = status ?? 'DRAFT';
  return PRESCRIPTION_STATUS_LABELS[value] ?? value;
}
