import sanitizeHtmlLib from 'sanitize-html';

const RICH_TEXT_OPTIONS = {
  allowedTags: ['b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'br', 'p', 'ul', 'ol', 'li'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard' as const,
};

const PLAIN_TEXT_OPTIONS = {
  allowedTags: [],
  allowedAttributes: {},
};

export function sanitizeRichText(text: string): string {
  if (!text) return '';
  return sanitizeHtmlLib(text, RICH_TEXT_OPTIONS);
}

export function sanitizePlainText(text: string): string {
  if (!text) return '';
  return sanitizeHtmlLib(text, PLAIN_TEXT_OPTIONS);
}

export function escapeHtml(text: string): string {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function validateInput(text: string, maxLength?: number): boolean {
  if (!text) return true;
  if (maxLength && text.length > maxLength) return false;
  return true;
}
