process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});
process.on('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  setTimeout(() => process.exit(1), 250);
});

const base = process.env.V2_BASE_URL ?? 'http://127.0.0.1:3180/api/v2';
const adminPassword = process.env.V2_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('V2_ADMIN_PASSWORD must be set to run state-machine concurrency smoke');
  process.exit(1);
}
console.log(`state-machine concurrency smoke base=${base}`);

const scale = Math.max(1, Number(process.env.V2_CONCURRENCY_SCALE ?? 1));
const ITEM_COUNT = 50 * scale;
const TRANSFER_CONCURRENCY = 20;
const STOCKTAKE_CONCURRENCY = 10;
const SETTLE_CONCURRENCY = 10;
const TRANSFER_QUANTITY = 10;

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const cause = error?.cause;
    throw new Error(
      `fetch failed ${method} ${path}: ${error?.message}; cause=${cause?.code ?? cause?.message ?? String(cause)}`,
    );
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON response
  }
  return { status: response.status, data, text };
}

async function listAllItems(headers) {
  const items = [];
  let page = 1;
  while (page <= 20 && items.length < ITEM_COUNT) {
    const result = await request(`/resources/inventoryItems?page=${page}&pageSize=200`, { headers });
    if (result.status !== 200 || !result.data?.success) {
      throw new Error(`inventory list failed: ${result.text}`);
    }
    const rows = result.data.data?.items ?? [];
    items.push(...rows.filter((row) => String(row.code ?? '').startsWith('CC-')));
    if (rows.length === 0) break;
    page += 1;
  }
  return items.slice(0, ITEM_COUNT);
}

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  if (login.status !== 200 || !login.data?.success) {
    throw new Error(`login failed: ${login.text}`);
  }
  const headers = { authorization: `Bearer ${login.data.data.token}` };

  const patient = await request('/resources/patients', {
    method: 'POST',
    headers,
    body: {
      code: `CC-PATIENT-${Date.now()}`,
      name: 'Concurrency Patient',
      gender: 'UNKNOWN',
      phone: '13900000000',
      source: 'OTHER',
      active: true,
    },
  });
  if (patient.status !== 201 || !patient.data?.success) {
    throw new Error(`patient create failed: ${patient.text}`);
  }
  const patientId = patient.data.data.id;

  const rows = Array.from({ length: ITEM_COUNT }, (_, index) => ({
    code: `CC-${String(index).padStart(5, '0')}`,
    name: `Concurrency Item ${index}`,
    spec: 'SMOKE',
    unit: '个',
    category: 'OTHER',
    price: 1000,
    stock: 1000,
    minStock: 0,
    active: true,
    batchManaged: false,
  }));
  for (const row of rows) {
    const created = await request('/resources/inventoryItems', {
      method: 'POST',
      headers,
      body: row,
    });
    if (created.status !== 201) {
      throw new Error(`inventory item create failed: ${created.text}`);
    }
    const stocked = await request('/inventory/transactions', {
      method: 'POST',
      headers,
      body: { itemId: created.data.data.id, type: 'IN', quantity: 1000 },
    });
    if (stocked.status !== 201) {
      throw new Error(`inventory stock-in failed: ${stocked.text}`);
    }
  }

  const items = await listAllItems(headers);
  if (items.length < 2) {
    throw new Error(`not enough inventory items for concurrency smoke: ${items.length}`);
  }
  const itemA = String(items[0].id);
  const itemB = String(items[1].id);

  const transferResults = await Promise.all(
    Array.from({ length: TRANSFER_CONCURRENCY }, () => request('/inventory-docs/transfer', {
      method: 'POST',
      headers,
      body: { items: [{ fromItemId: itemA, toItemId: itemB, quantity: TRANSFER_QUANTITY }] },
    })),
  );
  const transferSuccess = transferResults.filter((result) => result.status === 200).length;
  if (transferSuccess !== TRANSFER_CONCURRENCY) {
    const failures = transferResults
      .filter((result) => result.status !== 200)
      .slice(0, 5)
      .map((result) => `${result.status}:${result.text}`)
      .join(' | ');
    throw new Error(`transfer concurrency mismatch: ${transferSuccess}/${TRANSFER_CONCURRENCY} (${failures})`);
  }

  const stocktake = await request('/stocktakes', {
    method: 'POST',
    headers,
    body: { number: `CC-ST-${Date.now()}`, note: 'concurrency smoke' },
  });
  if (stocktake.status !== 201 || !stocktake.data?.success) {
    throw new Error(`stocktake create failed: ${stocktake.text}`);
  }
  const stocktakeId = String(stocktake.data.data.id);
  for (const item of items) {
    const recorded = await request(`/stocktakes/${stocktakeId}/items/${String(item.id)}`, {
      method: 'PATCH',
      headers,
      body: { countedStock: 1000 },
    });
    if (recorded.status !== 200) {
      throw new Error(`stocktake record failed: ${recorded.text}`);
    }
  }
  const locked = await request(`/stocktakes/${stocktakeId}/lock`, { method: 'POST', headers });
  if (locked.status !== 200) {
    throw new Error(`stocktake lock failed: ${locked.text}`);
  }
  const completeResults = await Promise.all(
    Array.from({ length: STOCKTAKE_CONCURRENCY }, () => request(`/stocktakes/${stocktakeId}/complete`, {
      method: 'POST',
      headers,
    })),
  );
  const completeSuccess = completeResults.filter((result) => result.status === 200).length;
  if (completeSuccess !== 1) {
    throw new Error(`stocktake complete concurrency mismatch: ${completeSuccess}/1`);
  }

  const processingOrder = await request('/processing-orders', {
    method: 'POST',
    headers,
    body: {
      patientId,
      number: `CC-PO-${Date.now()}`,
      totalFee: 10000,
      items: [{ name: '并发加工', quantity: 1, unitPrice: 10000 }],
    },
  });
  if (processingOrder.status !== 201 || !processingOrder.data?.success) {
    throw new Error(`processing order create failed: ${processingOrder.text}`);
  }
  const orderId = String(processingOrder.data.data.id);
  for (const status of ['SENT', 'IN_PROGRESS', 'COMPLETED']) {
    const transition = await request(`/processing-orders/${orderId}/status`, {
      method: 'PATCH',
      headers,
      body: { status },
    });
    if (transition.status !== 200) {
      throw new Error(`processing order transition ${status} failed: ${transition.text}`);
    }
  }
  const settleResults = await Promise.all(
    Array.from({ length: SETTLE_CONCURRENCY }, () => request(`/processing-orders/${orderId}/settle`, {
      method: 'POST',
      headers,
      body: { amount: 10000 },
    })),
  );
  const settleSuccess = settleResults.filter((result) => result.status === 200).length;
  if (settleSuccess !== 1) {
    throw new Error(`settle concurrency mismatch: ${settleSuccess}/1`);
  }

  console.log(
    `state-machine concurrency smoke passed: transfers=${transferSuccess}/${TRANSFER_CONCURRENCY} ` +
    `stocktakeComplete=1/${STOCKTAKE_CONCURRENCY} settle=1/${SETTLE_CONCURRENCY} items=${items.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
