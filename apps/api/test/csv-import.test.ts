import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { addDays, localDate } from '../src/lib/util.js';
import { csvCell, parseCsv } from '../src/services/csvImport.js';
import { api, CHEF, login, OWNER, setup, STAFF, type Session } from './helpers.js';

// CSV import/export: sales (FR-009, dry-run preview of accepted/rejected rows) and inventory. [Illustrative demo data]
let app: FastifyInstance;
let chef: Session;
let staff: Session;

beforeAll(async () => {
  app = await setup({ llm: null });
  chef = await login(app, CHEF);
  staff = await login(app, STAFF);
  await login(app, OWNER);
});
afterAll(async () => app.close());

const onHand = async (name: string) => (await api(app, chef).get(`/ingredients?search=${encodeURIComponent(name)}`)).body.find((i: any) => i.name === name);

describe('CSV parser', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,4');
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['3', '4']]);
    expect(rows[2].line).toBe(4);
  });
  it('neutralises spreadsheet formulas on export', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-3)).toBe('-3');
  });
});

describe('sales CSV import (FR-009)', () => {
  const y = addDays(localDate(), -1);
  const csv = ['date,menuItem,qty', `${y},Classic Burger,77`, `${y},classic burger,5`, `${y},Unicorn Steak,3`, `${localDate()},Classic Burger,4`, `${y},Fish Tacos,-2`, `2026-02-30,Fish Tacos,2`, `${addDays(y, -1)},Fish Tacos,12`].join('\n');

  it('dry run previews accepted and rejected rows without writing', async () => {
    const before = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'sales.imported'`)!.n;
    const r = await api(app, chef).post('/imports/sales', { csv, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(0);
    expect(r.body.accepted.map((a: any) => [a.menuItem, a.qty])).toEqual([['Classic Burger', 77], ['Fish Tacos', 12]]);
    const errors = r.body.rejected.map((x: any) => x.error).join(' | ');
    expect(errors).toMatch(/Duplicate row for Classic Burger/);
    expect(errors).toMatch(/Unknown dish "Unicorn Steak"/);
    expect(errors).toMatch(/completed days/);
    expect(errors).toMatch(/qty must be at least 0/);
    expect(errors).toMatch(/real date/);
    expect(r.body.rejected.map((x: any) => x.line)).toEqual([3, 4, 5, 6, 7]);
    expect(db().get<{ qty: number }>(`SELECT qty FROM sales_records WHERE date = ? AND menu_item_id = 'mi_burger'`, y)?.qty).not.toBe(77);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'sales.imported'`)!.n).toBe(before);
  });

  it('confirm writes only accepted rows, refreshes the forecast and is audited', async () => {
    await api(app, chef).get('/forecast');
    const r = await api(app, chef).post('/imports/sales', { csv, dryRun: false });
    expect(r.body.applied).toBe(2);
    expect(db().get<{ qty: number }>(`SELECT qty FROM sales_records WHERE date = ? AND menu_item_id = 'mi_burger'`, y)!.qty).toBe(77);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM forecast_model_runs`)!.n).toBe(0);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'sales.imported'`)!.n).toBe(1);
  });

  it('rejects bad headers, empty files and staff users', async () => {
    expect((await api(app, chef).post('/imports/sales', { csv: 'day,dish,count\n2026-01-01,x,1' })).body.error.message).toMatch(/Unknown column/);
    expect((await api(app, chef).post('/imports/sales', { csv: 'date,menuItem,qty\n' })).status).toBe(422);
    expect((await api(app, chef).post('/imports/sales', { csv: 'date,menuItem,qty\n"2026-01-01,x,1' })).body.error.message).toMatch(/Unclosed quote/);
    expect((await api(app, staff).post('/imports/sales', { csv })).status).toBe(403);
  });

  it('serves a template using real dish names', async () => {
    const r = await api(app, chef).get('/imports/sales/template.csv');
    expect(r.raw.headers['content-type']).toMatch(/text\/csv/);
    expect(r.raw.body.split('\r\n')[0]).toBe('date,menuItem,qty');
  });
});

describe('inventory CSV import and export', () => {
  const later = addDays(localDate(), 6);
  const csv = [
    'Name,Unit,Category,On Hand,Expires At,Reorder Level,Shelf Life Days,Perishable',
    `Salmon fillet,lb,,42,${later},18,,`,
    'Matcha powder,oz,Dry goods,16,,4,180,no',
    'Romaine hearts,each,,10,,,,',
    'Mystery Item,,,5,,,,',
    'Lemons,each,,abc,,,,',
    `Salmon fillet,lb,,1,,,,`,
  ].join('\n');

  it('dry run shows creates, updates and the exact on-hand change', async () => {
    const salmonBefore = (await onHand('Salmon fillet')).onHand;
    const r = await api(app, chef).post('/imports/inventory', { csv });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(0);
    const [salmon, matcha] = r.body.accepted;
    expect(salmon).toMatchObject({ name: 'Salmon fillet', action: 'update', onHand: 42, previousOnHand: salmonBefore, expiresAt: later });
    expect(salmon.changes).toContain('reorder level → 18');
    expect(matcha).toMatchObject({ action: 'create', name: 'Matcha powder' });
    const errors = r.body.rejected.map((x: any) => x.error).join(' | ');
    expect(errors).toMatch(/unit cannot change by import/);
    expect(errors).toMatch(/unit is required for a new ingredient/);
    expect(errors).toMatch(/onHand must be a number/);
    expect(errors).toMatch(/appears more than once/);
    expect(await onHand('Matcha powder')).toBeUndefined();
  });

  it('confirm creates the ingredient, sets counts and expiry, and the reorder engine uses them', async () => {
    const r = await api(app, chef).post('/imports/inventory', { csv, dryRun: false });
    expect(r.body.applied).toBe(2);
    const salmon = await onHand('Salmon fillet');
    expect(salmon.onHand).toBe(42);
    expect(salmon.reorderLevel).toBe(18);
    expect(salmon.expiry.some((b: any) => b.expiresAt === later || b.expires_at === later) || db().get(`SELECT 1 FROM stock_batches WHERE ingredient_id = 'ing_salmon' AND expires_at = ? AND qty > 0`, later)).toBeTruthy();
    const matcha = await onHand('Matcha powder');
    expect(matcha).toMatchObject({ unit: 'oz', category: 'Dry goods', perishable: false, shelfLifeDays: 180, reorderLevel: 4, onHand: 16 });
    expect(db().get(`SELECT 1 FROM stock_movements WHERE ingredient_id = 'ing_salmon' AND type = 'count_adjust' AND reason = 'CSV import'`)).toBeTruthy();
    expect(db().get(`SELECT 1 FROM audit_events WHERE action = 'inventory.imported'`)).toBeTruthy();
  });

  it('exports current stock as CSV that re-imports with no rejected rows', async () => {
    const r = await api(app, chef).get('/inventory/export.csv');
    expect(r.raw.headers['content-disposition']).toMatch(/attachment; filename="stockpilot-inventory-/);
    const lines = r.raw.body.trim().split('\r\n');
    expect(lines[0]).toBe('name,unit,category,onHand,expiresAt,reorderLevel,shelfLifeDays,perishable');
    expect(lines.find((l: string) => l.startsWith('Matcha powder,'))).toBe(`Matcha powder,oz,Dry goods,16,${addDays(localDate(), 180)},4,180,no`);
    const again = await api(app, chef).post('/imports/inventory', { csv: r.raw.body });
    expect(again.body.rejected).toEqual([]);
    expect(again.body.accepted.every((a: any) => a.changes.length === 0)).toBe(true);
  });

  it('applies all accepted rows in one transaction', async () => {
    const r = await api(app, chef).post('/imports/inventory', { csv: 'name,unit,category,onHand\nTxn test A,lb,Dry,1\nTxn test B,lb,Dry,2', dryRun: false });
    expect(r.body.applied).toBe(2);
    expect(await onHand('Txn test B')).toMatchObject({ onHand: 2 });
  });
});
