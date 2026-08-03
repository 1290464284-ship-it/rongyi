import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const applicationDir = path.resolve(import.meta.dirname);
const infrastructureDir = path.resolve(applicationDir, '..', 'infrastructure');

describe('architecture boundaries', () => {
  it('application use cases must not import legacy schema adapters', () => {
    const files = fs.readdirSync(applicationDir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(applicationDir, file), 'utf8');
      expect(content).not.toContain('legacy-registry');
      expect(content).not.toContain('../infrastructure/database');
    }
  });

  it('legacy adapters stay in infrastructure and depend only on domain contracts', () => {
    const file = path.join(infrastructureDir, 'legacy-registry.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('application/');
    expect(content).toContain('../../domain/contracts');
  });
});
