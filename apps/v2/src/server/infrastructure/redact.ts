// 与 electron/redact.cjs 保持同一套规则；只掩码明显 PII 模式。
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const ID_CARD_RE = /\b\d{17}[\dXx]\b/g;

/** 掩码手机号（1[3-9] 开头 11 位）与 18 位身份证号；其余文本原样返回。 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(PHONE_RE, (match) => `${match.slice(0, 3)}****${match.slice(-4)}`)
    .replace(ID_CARD_RE, (match) => `${match.slice(0, 4)}**********${match.slice(-4)}`);
}
