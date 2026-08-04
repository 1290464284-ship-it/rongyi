const base = process.env.V2_BASE_URL ?? 'http://localhost:3180/api/v2';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${path}: ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const session = await request('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: login.refreshToken }),
  });
  const headers = { authorization: `Bearer ${session.token}` };
  const device = await request('/sync/devices', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: 'smoke', name: 'Smoke Device' }),
  });
  const deviceToken = device.token;

  const health = await request('/health');
  if (health.status !== 'ok') throw new Error('health failed');

  const resources = await request('/resource-meta', { headers });
  if (resources.length < 80) throw new Error(`resource registry too small: ${resources.length}`);

  const patient = await request('/resources/patients', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: `SMK-${Date.now()}`,
      name: 'Smoke Patient',
      gender: 'MALE',
      phone: '13600000000',
      source: 'WALK_IN',
      active: true,
    }),
  });

  const appointmentStart = Date.UTC(2100, 0, 1) + Math.floor(Math.random() * 1_000_000_000_000);
  const appointment = await request('/appointments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      patientId: patient.id,
      doctorId: 'user-admin-001',
      startTime: new Date(appointmentStart).toISOString(),
      endTime: new Date(appointmentStart + 3_600_000).toISOString(),
      type: 'REGULAR',
    }),
  });
  await request(`/appointments/${appointment.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'ARRIVED' }),
  });

  const charge = await request('/charges', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      patientId: patient.id,
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }),
  });
  await request(`/charges/${charge.id}/pay`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ amount: 100, method: 'CASH', requestId: `smoke-${Date.now()}` }),
  });
  await request(`/charges/${charge.id}/refund`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: 50, reason: 'smoke' }),
  });

  await request('/inventory/transactions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 1 }),
  });
  await request('/inventory/low-stock', { headers });
  await request('/inventory/expiring?days=30', { headers });

  const card = await request('/member-cards', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      patientId: patient.id,
      cardNo: `CARD-${Date.now()}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }),
  });
  await request(`/member-cards/${card.id}/recharge`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: 1000 }),
  });
  await request(`/member-cards/${card.id}/consume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: 200 }),
  });
  await request(`/member-cards/${card.id}/points`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ points: 10 }),
  });

  await request(`/patients/${patient.id}/risk`, { method: 'POST', headers });
  const registration = await request('/resources/registrations', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      patientId: patient.id,
      doctorId: 'user-admin-001',
      type: 'REGULAR',
      status: 'REGISTERED',
      registeredAt: new Date().toISOString(),
    }),
  });
  await request(`/registrations/${registration.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  await request(`/registrations/${registration.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'COMPLETED' }),
  });
  await request('/follow-ups/reminders', { headers });
  await request('/follow-ups/adherence', { headers });
  await request('/follow-ups/batch-generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ limit: 5 }),
  });

  const backup = await request('/backups', { method: 'POST', headers });
  await request(`/backups/${encodeURIComponent(backup.filename)}/verify`, { headers });
  const restore = await request(`/backups/${encodeURIComponent(backup.filename)}/restore`, {
    method: 'POST',
    headers,
  });
  if (!restore.stagedPath) throw new Error('backup restore staging failed');
  await request('/backups/cleanup', {
    method: 'POST',
    headers,
    body: JSON.stringify({ maxKeep: 10 }),
  });
  await request('/stats/dashboard', { headers });
  await request('/stats/revenue?groupBy=month', { headers });
  await request('/stats/doctor-workload', { headers });
  await request('/satisfaction/nps', { headers });
  await request('/satisfaction/trend', { headers });
  await request('/satisfaction/doctor-rankings', { headers });
  await request('/analytics/rfm', { headers });
  await request('/analytics/churn', { headers });
  await request('/analytics/doctor-anomalies', { headers });
  await request('/charge-assistant/frequent-items', { headers });
  await request('/print/templates', { headers });
  const replenishment = await request('/inventory/replenishment/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (typeof replenishment.generated !== 'number') throw new Error('replenishment generate failed');
  const wechat = await request('/resources/wechatMessages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ patientId: patient.id, type: 'TEXT', content: 'hello', status: 'PENDING' }),
  });
  await request(`/wechat/${wechat.id}/send`, { method: 'POST', headers });
  await request(`/sync/pull?since=2020-01-01T00:00:00.000Z&deviceId=smoke&deviceToken=${encodeURIComponent(deviceToken)}`, { headers });
  await request('/sync/push', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: 'smoke', deviceToken, changes: [] }),
  });
  await request('/sync/cleanup', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  await request('/hr/attendance', { headers });
  await request('/system/business-alerts', { headers });
  await request('/notifications', { headers });
  await request('/search?q=Smoke', { headers });
  const printResponse = await fetch(`${base}/print?kind=report&data=%7B%22title%22%3A%22Smoke%22%7D`, { headers });
  if (!printResponse.ok || !(await printResponse.text()).includes('Smoke')) {
    throw new Error('print failed');
  }

  const imported = await request('/bulk-import/patients', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      rows: [{
        code: `BULK-${Date.now()}`,
        name: 'Bulk Patient',
        gender: 'UNKNOWN',
        phone: '13500000000',
        source: 'OTHER',
      }],
    }),
  });
  if (imported.imported !== 1) throw new Error('bulk import failed');

  await request('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  console.log('API smoke passed', { resources: resources.length, patient: patient.id, charge: charge.id });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
