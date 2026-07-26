import sanitizeHtmlLib from 'sanitize-html';

const SANITIZE_OPTIONS = {
  allowedTags: ['b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'br', 'p', 'ul', 'ol', 'li'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard' as const,
};

export function sanitizeHtml(text: string): string {
  if (!text) return '';
  return sanitizeHtmlLib(text, SANITIZE_OPTIONS);
}

export function sanitizePlain(text: string): string {
  if (!text) return '';
  return sanitizeHtmlLib(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
}
