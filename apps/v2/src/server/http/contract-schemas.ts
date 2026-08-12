import Ajv from 'ajv';

const healthDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'time'],
  properties: {
    status: { const: 'ok' },
    time: { type: 'string', format: 'date-time' },
  },
};

export const healthEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'data'],
  properties: {
    success: { const: true },
    data: healthDataSchema,
  },
};

export const errorEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'code', 'message'],
  properties: {
    success: { const: false },
    code: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    traceId: { type: 'string', minLength: 8 },
    details: {},
  },
};

export const resourceListEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'data'],
  properties: {
    success: { const: true },
    data: {
      type: 'object',
      additionalProperties: true,
      required: ['items', 'total', 'page', 'pageSize'],
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        total: { type: 'number', minimum: 0 },
        page: { type: 'number', minimum: 1 },
        pageSize: { type: 'number', minimum: 1 },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });

export function validateContract(schema: object, data: unknown): string[] {
  const validate = ajv.compile(schema);
  validate(data);
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}
