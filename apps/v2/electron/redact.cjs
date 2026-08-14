// 日志脱敏规则（与 src/server/infrastructure/redact.ts 保持同一套规则）：
// 请求日志本身不记 body/header；此处只对可能混入错误消息/栈里的
// 手机号、18 位身份证号做掩码。掩码有误伤可能（如纯数字订单号），
// 但宁可多掩不可泄漏。
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const ID_CARD_RE = /\b\d{17}[\dXx]\b/g;

function redactSensitiveText(text) {
  return String(text)
    .replace(PHONE_RE, (match) => `${match.slice(0, 3)}****${match.slice(-4)}`)
    .replace(ID_CARD_RE, (match) => `${match.slice(0, 4)}**********${match.slice(-4)}`);
}

module.exports = { redactSensitiveText };
