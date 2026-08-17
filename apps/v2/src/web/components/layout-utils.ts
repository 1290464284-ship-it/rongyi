export function readOnboardingDone(): boolean {
  try {
    return localStorage.getItem('v2-onboarding-done') === '1';
  } catch {
    // 隐私模式/存储被禁用时按“未完成新手引导”处理，不阻塞应用。
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem('v2-onboarding-done', '1');
  } catch {
    // 存储不可用时忽略，不影响主流程。
  }
}

export function backupTimeLabel(value: unknown): string {
  if (!value) return '暂无备份时间';
  const timestamp = Date.parse(String(value));
  if (Number.isNaN(timestamp)) return String(value);
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
