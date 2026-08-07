const base = process.env.V2_BASE_URL ?? 'http://localhost:3180/api/v2';
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'REDACTED';
const iterations = Number(process.env.V2_LOAD_ITERATIONS ?? 100);

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body.data;
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
const headers = { authorization: `Bearer ${login.token}` };

const samples = [];
for (let i = 0; i < iterations; i += 1) {
  const startedAt = performance.now();
  await request('/stats/dashboard', { headers });
  samples.push(performance.now() - startedAt);
}
samples.sort((a, b) => a - b);
const total = samples.reduce((sum, value) => sum + value, 0);
const average = total / samples.length;
const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
if (p95 > 2000) throw new Error(`p95 too high: ${p95.toFixed(1)}ms`);
console.log(`load smoke passed avg=${average.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${samples.length}`);

