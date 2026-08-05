import { pathToFileURL } from 'node:url';

export async function waitForService({ url, text = 'ok', timeoutMs = 30_000, intervalMs = 500 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const body = await response.text();
        if (body.includes(text)) return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiUrl = process.env.V2_API_URL ?? 'http://localhost:3180/api/v2/health';
  const webUrl = process.env.V2_WEB_URL ?? 'http://localhost:5180';
  const timeoutMs = Number(process.env.V2_WAIT_TIMEOUT_MS ?? 60_000);

  await waitForService({ url: apiUrl, text: '', timeoutMs });
  console.log('api ready');
  await waitForService({ url: webUrl, text: 'root', timeoutMs });
  console.log('web ready');
}
