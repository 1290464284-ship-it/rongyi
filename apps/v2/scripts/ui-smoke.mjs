import { chromium } from '@playwright/test';

const base = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const adminPassword = process.env.V2_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('V2_ADMIN_PASSWORD must be set to run UI smoke');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const title = await page.title();
  const heading = await page.getByRole('heading').allTextContents();
  console.log('login page', { title, heading });
  await page.fill('input', 'admin');
  await page.fill('input[type="password"]', adminPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/');
  await page.getByText('工作台').first().waitFor();

  await page.goto(`${base}/#/patients`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '患者与预约' }).waitFor();
  await page.getByRole('tab', { name: '预约', exact: true }).click();
  await page.getByRole('tab', { name: '风险评分' }).click();
  await page.getByRole('heading', { name: '患者风险评分' }).waitFor();

  await page.goto(`${base}/#/clinical`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '临床记录' }).waitFor();
  await page.getByRole('tab', { name: '工作流' }).click();
  await page.getByRole('heading', { name: '就诊工作台' }).waitFor();

  await page.goto(`${base}/#/finance`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '财务中心' }).waitFor();
  await page.getByRole('tab', { name: '操作' }).click();
  await page.getByRole('heading', { name: '财务操作' }).waitFor();

  await page.goto(`${base}/#/inventory`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '库存与采购', exact: true }).waitFor();
  await page.getByRole('tab', { name: '采购加工' }).click();
  await page.getByRole('heading', { name: '库存与采购操作' }).waitFor();

  await page.goto(`${base}/#/analytics`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '经营分析' }).waitFor();

  await page.goto(`${base}/#/communication`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '随访与沟通', exact: true }).waitFor();
  await page.getByRole('tab', { name: '微信发送' }).click();
  await page.getByRole('heading', { name: '微信消息' }).waitFor();

  await page.goto(`${base}/#/hr`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '人事与设备' }).waitFor();
  await page.getByRole('tab', { name: '审批' }).click();
  await page.getByRole('heading', { name: '人事审批' }).waitFor();

  await page.goto(`${base}/#/system`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '系统管理' }).waitFor();
  await page.getByRole('tab', { name: '桌面端' }).click();
  await page.getByRole('heading', { name: '桌面端设置' }).waitFor();
  await page.getByRole('tab', { name: '系统操作' }).click();
  await page.getByRole('heading', { name: '系统操作' }).waitFor();

  console.log('UI smoke passed');
} finally {
  await browser.close();
}
