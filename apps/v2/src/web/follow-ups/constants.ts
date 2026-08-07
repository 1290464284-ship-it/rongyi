export const DICT_TYPES = [
  { value: 'TYPE', label: 'TYPE 回访类型' },
  { value: 'PROJECT', label: 'PROJECT 回访项目' },
  { value: 'CONTENT', label: 'CONTENT 回访内容' },
  { value: 'RESULT', label: 'RESULT 回访结果' },
  { value: 'COMMUNICATION', label: 'COMMUNICATION 沟通方式' },
];

export const DICT_TYPE_LABELS: Record<string, string> = Object.fromEntries(DICT_TYPES.map((entry) => [entry.value, entry.label]));
