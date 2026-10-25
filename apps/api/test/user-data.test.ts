import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { addDays, localDate } from '../src/lib/util.js';
import { api, CHEF, login, OWNER, setup, type Session } from './helpers.js';

// Data entered through the dashboard forms (the same API endpoints) drives the real workflow: forecast, supplier
// selection, purchase order with approval, and invoice reconciliation. [Illustrative demo data]
let app: FastifyInstance;
let owner: Session;
let chef: Session;
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await setup({ llm: null });
  owner = await login(app, OWNER);
  chef = await login(app, CHEF);
});
afterAll(async () => app.close());

const ing = async (name: string) => (await api(app, chef).get(`/ingredients?search=${encodeURIComponent(name)}`)).body.find((i: any) => i.name === name);

describe('user-entered restaurant data drives StockPilot AI', () => {
  it('supplier form: a new supplier and a cheaper salmon offer are saved', async () => {
    const s = await api(app, owner).post('/suppliers', { name: 'Sunset Seafood Co.', email: 'orders@sunsetseafood.example', minOrderValue: 50, minOrderType: 'hard', belowMinFee: 0, deliveryFee: 0, orderCycleDays: 2, deliveryWeekdays: '1,2,3,4,5,6', cutoffTime: '23:59', trusted: true, active: true });
    expect(s.status).toBe(200);
    ids.supplier = s.body.id;
    const o = await api(app, owner).post('/offers', { supplierId: ids.supplier, ingredientId: 'ing_salmon', sku: 'SS-SAL10', packSize: 10, unitPrice: 9.5, leadTimeDays: 1, preferred: false });
    expect(o.status).toBe(200);
    ids.offer = o.body.id;
    // Validation: negative prices and unknown fields are rejected.
    expect((await api(app, owner).post('/offers', { supplierId: ids.supplier, ingredientId: 'ing_salmon', sku: 'X', packSize: 10, unitPrice: -1, leadTimeDays: 1, preferred: false })).status).toBe(400);
  });

  it('menu form: a new dish with its recipe, including a brand-new ingredient that no supplier sells yet', async () => {
    const rice = await api(app, chef).post('/ingredients', { name: 'Sushi rice', category: 'dry', unit: 'lb', perishable: false, shelfLifeDays: 365, safetyDays: 2, serviceLevel: 0.95 });
    expect(rice.status).toBe(200);
    ids.rice = rice.body.id;
    const dish = await api(app, chef).post('/menu-items', { name: 'Salmon Poke Bowl', price: 19, recipe: [{ ingredientId: 'ing_salmon', qty: 0.3 }, { ingredientId: 'ing_avocado', qty: 0.5 }, { ingredientId: ids.rice, qty: 0.25 }] });
    expect(dish.status).toBe(200);
    ids.dish = dish.body.id;
    expect((await api(app, chef).post('/menu-items', { name: 'salmon poke bowl', price: 19, recipe: [{ ingredientId: 'ing_salmon', qty: 0.3 }] })).status).toBe(409);
    expect((await api(app, chef).post('/menu-items', { name: 'Bad', price: 5, recipe: [{ ingredientId: 'ing_nope', qty: 1 }] })).status).toBe(422);
  });

  it('sales form: two weeks of entered sales change the forecast', async () => {
    const before = (await api(app, chef).get('/forecast?days=7')).body.items.find((i: any) => i.menuItemId === ids.dish);
    expect(before.daily[1].value).toBe(0); // no history yet
    for (let d = 14; d >= 1; d--) {
      const r = await api(app, chef).post('/sales', { date: addDays(localDate(), -d), lines: [{ menuItemId: ids.dish, qty: 30 }] });
      expect(r.status).toBe(200);
    }
    expect((await api(app, chef).post('/sales', { date: localDate(), lines: [{ menuItemId: ids.dish, qty: 5 }] })).status).toBe(422); // only completed days
    const after = (await api(app, chef).get('/forecast?days=7')).body.items.find((i: any) => i.menuItemId === ids.dish);
    expect(after.daily[1].value).toBeGreaterThan(20);
    expect(db().get(`SELECT 1 FROM audit_events WHERE action = 'sales.recorded'`)).toBeTruthy();
  });

  it('inventory form: stock, expiry and reorder level feed the reorder calculation', async () => {
    const m = await api(app, chef).post('/ingredients/ing_salmon/movements', { type: 'count_adjust', countedQty: 2, expiresAt: addDays(localDate(), 2) });
    expect(m.status).toBe(200);
    // Counting 2 lb (down from the seeded stock) leaves exactly 2 lb on hand; the entered expiry applies to stock the count adds.
    expect(m.body.onHand).toBe(2);
    const up = await api(app, chef).post('/ingredients/ing_avocado/movements', { type: 'count_adjust', countedQty: (await ing('Avocados')).onHand + 12, expiresAt: addDays(localDate(), 3) });
    expect(up.status).toBe(200);
    const added = (await api(app, chef).get('/ingredients/ing_avocado/batches')).body.find((b: any) => b.source === 'count_adjust');
    expect(added).toMatchObject({ qty: 12, expires_at: addDays(localDate(), 3) });
    const without = (await ing('Salmon fillet')).need;
    await api(app, chef).patch('/ingredients/ing_salmon', { reorderLevel: 60 });
    const salmon = await ing('Salmon fillet');
    expect(salmon.reorderLevel).toBe(60);
    expect(salmon.trace.flags).toContain('reorder_level_floor');
    expect(salmon.need).toBeGreaterThan(without);
    // The poke bowl's salmon demand is in the trace.
    expect(salmon.trace.demandH).toBeGreaterThan(20);
  });

  it('optimiser: chooses the user-entered cheaper supplier; an unsourced ingredient does not block the plan', async () => {
    const plan = (await api(app, chef).post('/plans')).body;
    expect(plan.violations).toEqual([]);
    const salmonLine = plan.solution.lines.find((l: any) => l.ingredientId === 'ing_salmon');
    expect(salmonLine.supplierId).toBe(ids.supplier);
    expect(salmonLine.unitPrice).toBe(9.5);
    expect(plan.unsourced.map((u: any) => u.ingredientId)).toContain(ids.rice);
  });

  it('morning run: drafts a PO to that supplier and asks a human to approve it', async () => {
    expect((await api(app, chef).post('/agent-runs', { kind: 'morning' })).status).toBe(200);
    await drainJobs();
    const po = db().get<any>(`SELECT * FROM purchase_orders WHERE supplier_id = ? AND status = 'pending_approval'`, ids.supplier);
    expect(po).toBeTruthy();
    ids.po = po.id;
    const lines = (await api(app, chef).get(`/purchase-orders/${po.id}`)).body.lines;
    expect(lines.map((l: any) => [l.sku, l.unit_price])).toEqual([['SS-SAL10', 9.5]]);
    const proposal = (await api(app, chef).get('/inbox')).body.proposals.find((p: any) => p.args.poId === po.id);
    expect(proposal.tool).toBe('send_purchase_order');
    const buyer = db().get<{ final_message: string }>(`SELECT final_message FROM agent_runs WHERE agent_id = 'buyer' ORDER BY started_at DESC LIMIT 1`)!;
    expect(buyer.final_message).toContain('Sushi rice');
    ids.proposal = proposal.id;
  });

  it('receiving + entered invoice: reconciliation uses the agreed price from the user\'s offer', async () => {
    await api(app, chef).post(`/actions/${ids.proposal}/approve`);
    await drainJobs();
    const form = (await api(app, chef).get(`/receipts/form/${ids.po}`)).body;
    const qty = form.lines[0].prefill;
    expect((await api(app, chef).post('/receipts', { purchaseOrderId: ids.po, lines: [{ poLineId: form.lines[0].poLineId, qtyReceived: qty, condition: 'ok' }] })).status).toBe(200);
    const inv = (await api(app, chef).post('/invoices/manual', { supplierId: ids.supplier, purchaseOrderId: ids.po })).body;
    const saved = await api(app, chef).put(`/invoices/${inv.id}/extraction`, {
      supplierName: 'Sunset Seafood Co.',
      invoiceNumber: 'SS-1001',
      date: localDate(),
      currency: 'USD',
      lines: [{ description: 'Salmon fillet', sku: 'SS-SAL10', qty, unit: 'lb', unitPrice: 10.5, extended: Math.round(qty * 10.5 * 100) / 100, confidence: 1 }],
      deliveryFee: 0,
      tax: 0,
      total: Math.round(qty * 10.5 * 100) / 100,
    });
    expect(saved.status).toBe(200);
    const matched = (await api(app, chef).post(`/invoices/${inv.id}/confirm`, { acceptIssues: false })).body;
    expect(matched.status).toBe('variances');
    expect(matched.variances.map((v: any) => [v.type, v.amount])).toEqual([['price_over', Math.round(qty * 1.0 * 100) / 100]]);
    await drainJobs();
    expect(db().get<{ amount_claimed: number }>(`SELECT amount_claimed FROM disputes WHERE invoice_id = ?`, inv.id)!.amount_claimed).toBe(Math.round(qty * 100) / 100);
  });
});
