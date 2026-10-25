import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Demo script in the browser (SRS §16, Solution Design §D12): morning run → approve → portal shortage → replan →
// receive → invoice → dispute. No Gemini key, no Brevo key: every step runs on the labelled fallbacks.
const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('stockpilot-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('morning run → approve → supplier shortage → replan → receive → invoice → dispute', async ({ page, browser }) => {
  await login(page, 'daniel@harborvine.example');
  await expect(page.getByText('ILLUSTRATIVE DEMO DATA').first()).toBeVisible();
  await shot(page, '01-today-empty');

  // E2E-2: morning run with no key — live trace, then the standup.
  await page.getByRole('button', { name: 'Run morning now' }).first().click();
  await expect(page.getByText('Pilot · manual')).toBeVisible();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Morning run complete/).first()).toBeVisible();
  await shot(page, '02-run-trace');

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Standup' })).toBeVisible();
  await expect(page.getByText(/rule-based \(no_api_key\)/).first()).toBeVisible();
  await shot(page, '03-today-standup');

  // E2E-3: the Golden Gate order in the Inbox — $366.92, saving $18.48 — approve.
  await page.getByRole('link', { name: /^Inbox/ }).first().click();
  const gg = page.locator('li', { hasText: 'Golden Gate Foodservice' }).filter({ hasText: 'send_purchase_order' }).first();
  await expect(gg).toContainText('$366.92');
  await expect(gg).toContainText('saves $18.48');
  await shot(page, '04-inbox');
  await gg.getByRole('button', { name: 'Approve' }).click();
  await expect(gg).toBeHidden();

  // The PO shows "Why this supplier?" and the portal link (email not configured → manual link).
  await page.getByRole('link', { name: 'Orders' }).first().click();
  await page.locator('tr', { hasText: 'Golden Gate Foodservice' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Why this supplier?' })).toBeVisible();
  await expect(page.getByText('$385.40').first()).toBeVisible();
  // Plan-level comparison across all of today's orders: the optimiser saves exactly the worked-example amount.
  const saving = page.locator('div', { hasText: /^Saving/ }).filter({ hasText: '$' }).last();
  await expect(saving).toContainText('$18.48');
  await expect(page.getByText('sent', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const portalHref = await page.locator('a', { hasText: '/s/' }).first().getAttribute('href');
  expect(portalHref).toMatch(/^\/s\//);
  await shot(page, '05-po-detail');

  // E2E-4: the supplier (no login) confirms 30 of 40 lb chicken in the portal.
  const supplier = await browser.newPage();
  await supplier.goto(portalHref!);
  await expect(supplier.getByRole('heading', { name: /Purchase order PO-/ })).toBeVisible();
  const chickenLine = supplier.locator('.line', { hasText: 'Chicken thigh' });
  await chickenLine.locator('select').selectOption('reduce');
  await chickenLine.getByLabel(/Qty you can deliver/).fill('30');
  await supplier.getByLabel('Delivery ETA').fill('10:00');
  await shot(supplier, '06-portal');
  await supplier.getByRole('button', { name: 'Send response' }).click();
  await expect(supplier.getByText(/response v1 received/)).toBeVisible();
  await supplier.close();

  // Buyer replans the shortfall: Bay Meat Supply, $49.00, waiting for approval.
  await page.getByRole('link', { name: /^Inbox/ }).first().click();
  const bay = page.locator('li', { hasText: 'Bay Meat Supply' }).filter({ hasText: 'send_purchase_order' }).first();
  await expect(bay).toContainText('$49.00', { timeout: 20_000 });
  await shot(page, '07-replan-proposal');

  // E2E-6: Staff receives the delivery (pre-filled 30 lb) and uploads the sample invoice.
  await page.context().clearCookies();
  await login(page, 'leo@harborvine.example');
  await page.goto('/receiving');
  await page.locator('li', { hasText: 'Golden Gate Foodservice' }).getByRole('link', { name: 'Receive' }).click();
  await expect(page.locator('li', { hasText: 'Chicken thigh' }).getByLabel(/Received/)).toHaveValue('30');
  await shot(page, '08-receive');
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByRole('heading', { name: 'Receiving & invoices' })).toBeVisible();

  await page.getByLabel('Supplier').selectOption({ label: 'Golden Gate Foodservice' });
  await page.getByLabel('Purchase order').selectOption({ index: 1 });
  await page.getByLabel('Invoice photo').setInputFiles(path.resolve('data/sample-invoice/INV-GG-20817.png'));
  await page.getByRole('button', { name: 'Upload & extract' }).click();
  await expect(page.getByText(/recorded_sample/).first()).toBeVisible();
  await shot(page, '09-invoice-review');
  const confirm = page.getByRole('button', { name: /match anyway|Confirm & match/ });
  await confirm.last().click();
  await expect(page.getByRole('heading', { name: 'Three-way match' })).toBeVisible();
  await expect(page.getByText('$9.60').first()).toBeVisible();
  await expect(page.getByText('$32.50').first()).toBeVisible();
  await expect(page.getByText('$42.10').first()).toBeVisible();
  await shot(page, '10-three-way-match');

  // AP Clerk drafted the dispute.
  await page.goto('/disputes');
  await expect(page.locator('tr', { hasText: 'Golden Gate Foodservice' })).toContainText('$42.10', { timeout: 20_000 });
  await shot(page, '11-disputes');
});

test('mobile Inbox and Team render at 360 px (NFR-USE-1)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await login(page, 'sara@harborvine.example');
  await page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, '12-mobile-inbox');
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Your AI purchasing team' })).toBeVisible();
  await shot(page, '13-mobile-team');
});

test('every page renders without errors (D8.2)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'sara@harborvine.example');
  const pages: [string, RegExp][] = [
    ['/team', /Your AI purchasing team/],
    ['/team?tab=chat', /Team chat/],
    ['/tasks', /^Tasks$/],
    ['/inbox', /^Inbox$/],
    ['/orders', /Purchase orders/],
    ['/receiving', /Receiving & invoices/],
    ['/disputes', /^Disputes$/],
    ['/forecast', /^Forecast$/],
    ['/inventory', /^Inventory$/],
    ['/inventory?tab=offers', /Supplier offers/],
    ['/inventory?tab=menu', /Menu and recipes/],
    ['/savings', /^Savings$/],
    ['/activity', /^Activity$/],
    ['/activity?tab=audit', /Audit timeline/],
    ['/activity?tab=outbox', /Email outbox/],
    ['/settings', /^Settings$/],
  ];
  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (url === '/forecast') await expect(page.locator('.recharts-surface').first()).toBeVisible();
    await shot(page, `page${url.replace(/[/?=]/g, '_')}`);
  }
  expect(errors).toEqual([]);
});
