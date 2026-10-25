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
  await page.getByLabel('Password', { exact: true }).fill('harborvine2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('morning run → approve → supplier shortage → replan → receive → invoice → dispute', async ({ page, browser }) => {
  await login(page, 'daniel@harborvine.com');
  await expect(page.getByText('Harbor & Vine Bistro').first()).toBeVisible();
  await shot(page, '01-today-empty');

  // E2E-2: morning run with no key — live trace, then the standup.
  await page.getByRole('button', { name: 'Run morning plan' }).first().click();
  await expect(page.getByText('Pilot · manual')).toBeVisible();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Morning run complete/).first()).toBeVisible();
  await shot(page, '02-run-trace');

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Standup' })).toBeVisible();
  await expect(page.getByText('Rules engine', { exact: true }).first()).toBeVisible();
  await shot(page, '03-today-standup');

  // E2E-3: the Golden Gate order in the Inbox — $366.92, saving $18.48 — approve.
  await page.getByRole('link', { name: /^Inbox/ }).first().click();
  const gg = page.locator('li', { hasText: 'Golden Gate Foodservice' }).filter({ hasText: 'Send purchase order' }).first();
  await expect(gg).toContainText('$366.92');
  await expect(gg).toContainText('saves $18.48');
  await shot(page, '04-inbox');
  await gg.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & send' }).click();
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
  const bay = page.locator('li', { hasText: 'Bay Meat Supply' }).filter({ hasText: 'Send purchase order' }).first();
  await expect(bay).toContainText('$49.00', { timeout: 20_000 });
  await shot(page, '07-replan-proposal');

  // E2E-6: Staff receives the delivery (pre-filled 30 lb) and uploads the sample invoice.
  await page.context().clearCookies();
  await login(page, 'leo@harborvine.com');
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
  await expect(page.getByText(/Stored extraction/).first()).toBeVisible();
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
  await login(page, 'sara@harborvine.com');
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
  await login(page, 'sara@harborvine.com');
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
    ['/inventory?tab=suppliers', /^Suppliers$/],
    ['/inventory?tab=sales', /Daily sales sheet/],
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

test('data entry forms: dish, sales, supplier, offer and reorder level are saved and used', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'daniel@harborvine.com');

  // Menu: a new dish with its recipe.
  await page.goto('/inventory?tab=menu');
  await page.getByRole('button', { name: 'New dish' }).click();
  await page.getByLabel('Dish name').fill('Salmon Poke Bowl');
  await page.getByLabel('Menu price (USD)').fill('19');
  await page.getByLabel('Ingredient').first().selectOption({ label: 'Salmon fillet' });
  await page.getByLabel('Quantity per serving').first().fill('0.3');
  await page.getByRole('button', { name: '+ Add ingredient' }).click();
  await page.getByLabel('Ingredient').nth(1).selectOption({ label: 'Avocados' });
  await page.getByLabel('Quantity per serving').nth(1).fill('0.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Salmon Poke Bowl')).toBeVisible();

  // Sales: yesterday's portions for the new dish.
  await page.goto('/inventory?tab=sales');
  await page.getByLabel('Portions of Salmon Poke Bowl').fill('30');
  await page.getByRole('button', { name: 'Save sales' }).click();
  await expect(page.getByText(/Saved — the forecast and reorder plan now use these sales/)).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Salmon Poke Bowl' })).toContainText('30');

  // Supplier and offer.
  await page.goto('/inventory?tab=suppliers');
  await page.getByRole('button', { name: 'New supplier' }).click();
  await page.getByLabel('Name').fill('Sunset Seafood Co.');
  await page.getByLabel('Order email').fill('orders@sunsetseafood.example');
  await page.getByLabel('Minimum order value (USD)').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr', { hasText: 'Sunset Seafood Co.' })).toBeVisible();
  await page.goto('/inventory?tab=offers');
  await page.getByRole('button', { name: 'Add offer' }).click();
  await page.getByRole('combobox', { name: /^Supplier/ }).selectOption({ label: 'Sunset Seafood Co.' });
  await page.getByRole('combobox', { name: /^Ingredient/ }).selectOption({ label: 'Salmon fillet (lb)' });
  await page.getByLabel('Supplier SKU').fill('SS-SAL10');
  await page.getByLabel(/Pack size/).fill('10');
  await page.getByLabel(/Unit price/).fill('9.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr', { hasText: 'SS-SAL10' })).toContainText('$9.50');

  // Inventory: reorder level.
  await page.goto('/inventory');
  await page.locator('tr', { hasText: 'Salmon fillet' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/Reorder level/).fill('40');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr', { hasText: 'Salmon fillet' }).getByRole('cell', { name: '40 lb', exact: true })).toBeVisible();

  // The forecast now includes the new dish.
  await page.goto('/forecast');
  await expect(page.getByRole('combobox', { name: 'Dish' }).locator('option', { hasText: 'Salmon Poke Bowl' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('CSV: inventory export, inventory import and sales import with preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'daniel@harborvine.com');

  await page.goto('/inventory');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^stockpilot-inventory-.*\.csv$/);

  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByLabel('CSV file').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from('name,unit,category,onHand,reorderLevel\nMatcha powder,oz,Dry goods,16,4\nLemons,lb,,5,\n') });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('1 accepted')).toBeVisible();
  await expect(page.getByText(/unit cannot change by import/)).toBeVisible();
  await shot(page, '14-csv-preview');
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText(/Imported 1 row/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('tr', { hasText: 'Matcha powder' })).toBeVisible();

  await page.goto('/inventory?tab=sales');
  const y = await page.evaluate(async () => {
    const h = await (await fetch('/api/health')).json();
    const d = new Date(`${h.localDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  await page.getByRole('button', { name: 'Import sales CSV' }).click();
  await page.getByLabel('CSV file').setInputFiles({ name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from(`date,menuItem,qty\n${y},Classic Burger,64\n${y},Nope Dish,3\n`) });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(/Unknown dish "Nope Dish"/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText(/Imported 1 row/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('theme: light, dark and system preferences apply everywhere and persist across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page, 'daniel@harborvine.com');
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await isDark()).toBe(false);
  const lightBg = await bg();

  await page.getByRole('button', { name: /^Theme/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  expect(await isDark()).toBe(true);
  expect(await bg()).not.toBe(lightBg);

  // Persisted, and applied before first paint by the inline script in index.html (no flash of the light theme).
  await page.goto('/orders', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await isDark()).toBe(true);
  await page.reload();
  expect(await isDark()).toBe(true);

  // System follows the operating system, including changes while the page is open.
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'System' }).click();
  expect(await isDark()).toBe(false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(isDark).toBe(true);
  await page.reload();
  expect(await isDark()).toBe(true);
  await page.getByRole('radio', { name: 'Light' }).click();
  expect(await isDark()).toBe(false);
});

test('settings: time travel and workspace data reset, with confirmation', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, 'sara@harborvine.com');
  await page.goto('/settings#clock');
  await page.getByRole('button', { name: '+1 h' }).click();
  await expect(page.getByText(/^Clock now/)).toBeVisible();
  await expect(page.getByText(/Simulated clock:/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to real time' }).click();
  await expect(page.getByText(/Simulated clock:/)).toBeHidden();

  await page.getByRole('button', { name: 'Reset workspace data…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Reset workspace data…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete and reset' }).click();
  await expect(page.getByText('Data reset complete. Sign in again to continue.')).toBeVisible({ timeout: 150_000 });
  await login(page, 'sara@harborvine.com');
  await expect(page.getByText('No morning plan yet today')).toBeVisible();
});

test('login: empty email by default; one-click sample accounts sign in directly', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toHaveValue('');
  await page.getByRole('button', { name: /Continue as Staff/ }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Leo/ })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: /Continue as Owner/ }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Sara/ })).toBeVisible();
});
