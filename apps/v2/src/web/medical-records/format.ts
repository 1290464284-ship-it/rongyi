import type { MedicalRecordRow } from './types';

export function proposedEntries(row: MedicalRecordRow | null | undefined): Array<[string, unknown]> {
  let content: Record<string, unknown> | null | undefined = row?.proposedContent;
  if (!content && row?.proposedContentJson) {
    try {
      const parsed = JSON.parse(row.proposedContentJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        content = parsed as Record<string, unknown>;
      }
    } catch {
      content = undefined;
    }
  }
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return Object.entries(content);
  }
  return [];
}
