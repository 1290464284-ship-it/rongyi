export async function copyText(text: string): Promise<void> {
  const desktop = (window as unknown as { desktop?: { copyText?: (value: string) => Promise<unknown> } }).desktop;
  if (desktop?.copyText) {
    await desktop.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
