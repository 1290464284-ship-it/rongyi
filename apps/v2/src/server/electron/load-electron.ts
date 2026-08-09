import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;

const require = createRequire(import.meta.url);

export function loadElectronModule<T>(modulePath: string, mocks: Record<string, unknown>): T {
  const absolute = require.resolve(modulePath);
  const moduleRoot = `${path.sep}apps${path.sep}v2${path.sep}electron${path.sep}`;
  for (const cached of Object.keys(require.cache)) {
    if (cached.replaceAll('\\', '/').includes('/apps/v2/electron/') || cached.includes(moduleRoot)) {
      delete require.cache[cached];
    }
  }
  const original = (Module as unknown as { _load: ModuleLoad })._load;
  (Module as unknown as { _load: ModuleLoad })._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return original.call(Module, request, parent, isMain);
  };
  try {
    return require(absolute) as T;
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = original;
  }
}
