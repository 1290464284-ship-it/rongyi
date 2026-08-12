import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const specPath = path.resolve(import.meta.dirname, '../../../openapi.json');

describe('OpenAPI contract document', () => {
  it('parses as a valid OpenAPI 3 document with core paths', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
      openapi?: string;
      info?: { version?: string };
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info?.version).toBe('2.2.0');
    expect(spec.paths).toMatchObject({
      '/health': expect.any(Object),
      '/auth/login': expect.any(Object),
      '/resource-meta': expect.any(Object),
      '/resources/patients': expect.any(Object),
      '/resources/patients/{id}': expect.any(Object),
    });
    expect(spec.components?.schemas).toMatchObject({
      HealthEnvelope: expect.any(Object),
      LoginEnvelope: expect.any(Object),
      ResourceMetaEnvelope: expect.any(Object),
      ResourceListEnvelope: expect.any(Object),
      ResourceDetailEnvelope: expect.any(Object),
      ErrorEnvelope: expect.any(Object),
    });
  });

  it('keeps documented $ref targets present', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
      components?: { schemas?: Record<string, unknown> };
    };
    const names = Object.keys(spec.components?.schemas ?? {});
    const text = fs.readFileSync(specPath, 'utf8');
    const refs = [...text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    for (const ref of new Set(refs)) expect(names).toContain(ref);
  });
});
