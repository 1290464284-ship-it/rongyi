interface RouteLayer {
  path?: string;
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
  handle?: {
    stack?: unknown[];
  };
}

export interface RouteEntry {
  method: string;
  path: string;
}

export function collectRoutes(layers: unknown[], output: RouteEntry[] = []): RouteEntry[] {
  return collectRoutesWithPrefix(layers, '', output);
}

function collectRoutesWithPrefix(
  layers: unknown[],
  prefix: string,
  output: RouteEntry[],
): RouteEntry[] {
  for (const rawLayer of layers) {
    const layer = rawLayer as RouteLayer;
    if (layer.route?.path && layer.route.methods) {
      const fullPath = prefix
        ? `${prefix.replace(/\/$/, '')}/${String(layer.route.path).replace(/^\//, '')}`
        : layer.route.path;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method !== 'head') {
          output.push({ method: method.toUpperCase(), path: fullPath });
        }
      }
    }
    const nested = layer.handle?.stack;
    if (nested) {
      const childPrefix = prefix
        ? `${prefix.replace(/\/$/, '')}/${String(layer.path ?? '').replace(/^\//, '')}`
        : layer.path ?? '';
      collectRoutesWithPrefix(nested, childPrefix, output);
    }
  }
  return output;
}
