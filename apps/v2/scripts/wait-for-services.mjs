const apiUrl = process.env.V2_API_URL ?? 'http://localhost:3180/api/v2/health';
const webUrl = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const timeoutMs = Number(process.env.V2_WAIT_TIMEOUT_MS ?? 60_000);

async function waitFor(url, label, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (predicate(response)) {
        console.log(`${label} ready`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

await waitFor(apiUrl, 'api', async (response) => response.ok);
await waitFor(webUrl, 'web', async (response) => {
  const text = await response.text();
  return response.ok && text.includes('root');
});
