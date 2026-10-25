import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { requireRole, requireUser } from '../auth/sessions.js';
import { audit, publish } from '../lib/events.js';
import { conflict, id, localDate, notFound, nowIso, unprocessable } from '../lib/util.js';
import { getForecast } from '../services/forecast.js';
import { recordMovement } from '../services/inventory.js';
import { computeNeeds, createPlan, getPlan } from '../services/planning.js';
import { batches } from '../services/inventory.js';

// Master data, stock, forecast and plans (SRS FR-003 – FR-010, FR-020 – FR-045).
const IngredientBody = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40),
  unit: z.enum(['lb', 'oz', 'gal', 'qt', 'each']),
  perishable: z.boolean(),
  shelfLifeDays: z.number().int().min(1).max(365),
  safetyDays: z.number().min(0).max(7),
  serviceLevel: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.98)]),
  maxOverbuyDays: z.number().min(0).max(60).default(3),
});

const SupplierBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  minOrderValue: z.number().min(0),
  minOrderType: z.enum(['hard', 'soft']),
  belowMinFee: z.number().min(0),
  deliveryFee: z.number().min(0),
  orderCycleDays: z.number().int().min(1).max(14),
  deliveryWeekdays: z.string().regex(/^[0-6](,[0-6])*$/),
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/),
  trusted: z.boolean(),
  active: z.boolean(),
});

const OfferBody = z.object({
  supplierId: z.string(),
  ingredientId: z.string(),
  sku: z.string().trim().min(1).max(40),
  packSize: z.number().positive(),
  unitPrice: z.number().min(0),
  leadTimeDays: z.number().int().min(0).max(14),
  preferred: z.boolean(),
  active: z.boolean().default(true),
});

function uniqueName(name: string, exceptId?: string): void {
  const r = db().get<{ id: string }>(`SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE`, name);
  if (r && r.id !== exceptId) throw conflict(`An ingredient named "${name}" already exists`);
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ingredients', async (req) => {
    const q = req.query as { search?: string; category?: string; status?: string; includeInactive?: string };
    const needs = new Map(computeNeeds().map((n) => [n.ingredientId, n]));
    const rows = db().all<any>(`SELECT * FROM ingredients ${q.includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`);
    return rows
      .filter((r) => (!q.search || r.name.toLowerCase().includes(q.search.toLowerCase())) && (!q.category || r.category === q.category))
      .map((r) => {
        const n = needs.get(r.id);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          perishable: Boolean(r.perishable),
          shelfLifeDays: r.shelf_life_days,
          safetyDays: r.safety_days,
          serviceLevel: r.service_level,
          maxOverbuyDays: r.max_overbuy_days,
          active: Boolean(r.active),
          onHand: n?.onHand ?? 0,
          usable: n?.trace.usable ?? 0,
          status: n?.trace.status ?? 'ok',
          daysOfCover: n?.trace.daysOfCover ?? null,
          need: n?.trace.need ?? 0,
          valueAtRisk: n?.valueAtRisk ?? 0,
          expiredQty: n?.expiredQty ?? 0,
          trace: n?.trace ?? null,
          demandByDay: n?.demandByDay ?? [],
          expiry: n?.expiry ?? [],
        };
      })
      .filter((r) => !q.status || r.status === q.status);
  });
  app.post('/ingredients', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = IngredientBody.parse(req.body);
    uniqueName(b.name);
    const iid = id('ing');
    db().run(
      `INSERT INTO ingredients (id, name, unit, category, perishable, shelf_life_days, safety_days, service_level, max_overbuy_days) VALUES (?,?,?,?,?,?,?,?,?)`,
      iid,
      b.name,
      b.unit,
      b.category,
      b.perishable,
      b.shelfLifeDays,
      b.safetyDays,
      b.serviceLevel,
      b.maxOverbuyDays,
    );
    audit({ type: 'user', id: u.id }, 'ingredient.created', 'ingredient', iid, { after: b });
    return { id: iid };
  });
  app.patch('/ingredients/:id', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const { id: iid } = req.params as { id: string };
    const before = db().get<any>(`SELECT * FROM ingredients WHERE id = ?`, iid);
    if (!before) throw notFound('Ingredient not found');
    const b = IngredientBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    if (b.name) uniqueName(b.name, iid);
    const map: Record<string, string> = { name: 'name', category: 'category', unit: 'unit', perishable: 'perishable', shelfLifeDays: 'shelf_life_days', safetyDays: 'safety_days', serviceLevel: 'service_level', maxOverbuyDays: 'max_overbuy_days', active: 'active' };
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (keys.length) db().run(`UPDATE ingredients SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (b as any)[k]), iid);
    audit({ type: 'user', id: u.id }, b.active === false ? 'ingredient.deactivated' : 'ingredient.updated', 'ingredient', iid, { before, after: b });
    publish('stock.updated', { ingredientId: iid });
    return { ok: true };
  });
  app.get('/ingredients/:id/batches', async (req) => batches((req.params as { id: string }).id));
  app.post('/ingredients/:id/movements', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    const b = z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('receive'), qty: z.number().positive().max(100000), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().max(200).optional() }),
        z.object({ type: z.literal('waste'), qty: z.number().positive().max(100000), reason: z.string().min(2).max(200) }),
        z.object({ type: z.literal('count_adjust'), countedQty: z.number().min(0).max(100000), reason: z.string().max(200).optional() }),
        z.object({ type: z.literal('write_off'), reason: z.string().max(200).optional() }),
      ])
      .parse(req.body);
    return recordMovement((req.params as { id: string }).id, b, { type: 'user', id: u.id });
  });
  app.get('/stock-movements', async () => db().all(`SELECT m.*, i.name AS ingredient, i.unit FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id ORDER BY m.created_at DESC LIMIT 200`));

  // Suppliers and offers (FR-004).
  app.get('/suppliers', async () =>
    db()
      .all<any>(`SELECT * FROM suppliers ORDER BY name`)
      .map((s) => ({ ...s, trusted: Boolean(s.trusted), active: Boolean(s.active), offers: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM supplier_offers WHERE supplier_id = ? AND active = 1`, s.id)!.n })),
  );
  app.patch('/suppliers/:id', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const { id: sid } = req.params as { id: string };
    const before = db().get(`SELECT * FROM suppliers WHERE id = ?`, sid);
    if (!before) throw notFound('Supplier not found');
    const b = SupplierBody.partial().parse(req.body);
    const map: Record<string, string> = { name: 'name', email: 'email', minOrderValue: 'min_order_value', minOrderType: 'min_order_type', belowMinFee: 'below_min_fee', deliveryFee: 'delivery_fee', orderCycleDays: 'order_cycle_days', deliveryWeekdays: 'delivery_weekdays', cutoffTime: 'cutoff_time', trusted: 'trusted', active: 'active' };
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (keys.length) db().run(`UPDATE suppliers SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (b as any)[k]), sid);
    audit({ type: 'user', id: u.id }, 'supplier.updated', 'supplier', sid, { before, after: b });
    return { ok: true };
  });
  app.post('/suppliers', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = SupplierBody.parse(req.body);
    const sid = id('sup');
    db().run(
      `INSERT INTO suppliers (id, name, email, min_order_value, min_order_type, below_min_fee, delivery_fee, order_cycle_days, delivery_weekdays, cutoff_time, trusted, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      sid,
      b.name,
      b.email,
      b.minOrderValue,
      b.minOrderType,
      b.belowMinFee,
      b.deliveryFee,
      b.orderCycleDays,
      b.deliveryWeekdays,
      b.cutoffTime,
      b.trusted,
      b.active,
    );
    audit({ type: 'user', id: u.id }, 'supplier.created', 'supplier', sid, { after: b });
    return { id: sid };
  });
  app.get('/offers', async (req) => {
    const q = req.query as { ingredientId?: string; supplierId?: string };
    return db().all(
      `SELECT o.*, s.name AS supplier, i.name AS ingredient, i.unit FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id JOIN ingredients i ON i.id = o.ingredient_id
       WHERE (? IS NULL OR o.ingredient_id = ?) AND (? IS NULL OR o.supplier_id = ?) ORDER BY i.name, o.unit_price`,
      q.ingredientId ?? null,
      q.ingredientId ?? null,
      q.supplierId ?? null,
      q.supplierId ?? null,
    );
  });
  const setPreferred = (ingredientId: string, offerId: string) => db().run(`UPDATE supplier_offers SET preferred = 0 WHERE ingredient_id = ? AND id <> ?`, ingredientId, offerId);
  app.post('/offers', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = OfferBody.parse(req.body);
    const oid = id('off');
    db().tx(() => {
      if (b.preferred) setPreferred(b.ingredientId, oid);
      db().run(`INSERT INTO supplier_offers (id, supplier_id, ingredient_id, sku, pack_size, unit_price, lead_time_days, preferred, active) VALUES (?,?,?,?,?,?,?,?,?)`, oid, b.supplierId, b.ingredientId, b.sku, b.packSize, b.unitPrice, b.leadTimeDays, b.preferred, b.active);
    });
    audit({ type: 'user', id: u.id }, 'offer.created', 'supplier_offer', oid, { after: b });
    return { id: oid };
  });
  app.patch('/offers/:id', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const { id: oid } = req.params as { id: string };
    const before = db().get<any>(`SELECT * FROM supplier_offers WHERE id = ?`, oid);
    if (!before) throw notFound('Offer not found');
    const b = OfferBody.omit({ supplierId: true, ingredientId: true }).partial().parse(req.body);
    const map: Record<string, string> = { sku: 'sku', packSize: 'pack_size', unitPrice: 'unit_price', leadTimeDays: 'lead_time_days', preferred: 'preferred', active: 'active' };
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    db().tx(() => {
      if (b.preferred) setPreferred(before.ingredient_id, oid);
      if (keys.length) db().run(`UPDATE supplier_offers SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (b as any)[k]), oid);
    });
    audit({ type: 'user', id: u.id }, 'offer.updated', 'supplier_offer', oid, { before, after: b });
    return { ok: true };
  });

  // Menu, recipes and sales (FR-007, FR-008).
  app.get('/menu-items', async () =>
    db()
      .all<any>(`SELECT * FROM menu_items ORDER BY name`)
      .map((m) => {
        const lines = db().all<any>(`SELECT r.qty, i.id, i.name, i.unit, (SELECT unit_price FROM supplier_offers o WHERE o.ingredient_id = i.id AND o.preferred = 1) AS price FROM recipe_lines r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id = ?`, m.id);
        const cost = Math.round(lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0) * 100) / 100;
        return { ...m, recipe: lines, plateCost: cost, foodCostPct: m.price ? Math.round((cost / m.price) * 1000) / 10 : null };
      }),
  );
  app.get('/sales', async (req) => {
    const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    return db().all(`SELECT s.date, s.menu_item_id, m.name, s.qty FROM sales_records s JOIN menu_items m ON m.id = s.menu_item_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date, m.name`, q.from, q.to);
  });

  // Demand events (FR-010) and forecast (FR-020 – FR-029).
  app.get('/demand-events', async () => db().all(`SELECT * FROM demand_events ORDER BY date DESC`));
  app.post('/demand-events', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().min(3).max(200), covers: z.number().int().min(1).max(500).optional(), items: z.record(z.string(), z.number().int().min(1).max(500)).optional() })
      .refine((x) => x.covers || (x.items && Object.keys(x.items).length), 'Give covers or items')
      .parse(req.body);
    if (b.date < localDate()) throw unprocessable('Date must be today or later');
    const eid = id('dev');
    db().run(`INSERT INTO demand_events (id, date, description, extra_json, created_by, created_at) VALUES (?,?,?,?,?,?)`, eid, b.date, b.description, JSON.stringify({ covers: b.covers, items: b.items ?? {} }), u.id, nowIso());
    audit({ type: 'user', id: u.id }, 'demand_event.created', 'demand_event', eid, { after: b });
    publish('forecast.updated', {});
    return { id: eid };
  });
  app.post('/demand-events/:id/cancel', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    db().run(`UPDATE demand_events SET status = 'cancelled' WHERE id = ?`, (req.params as { id: string }).id);
    audit({ type: 'user', id: u.id }, 'demand_event.cancelled', 'demand_event', (req.params as { id: string }).id);
    return { ok: true };
  });
  app.get('/forecast', async (req) => {
    const days = Math.min(14, Math.max(1, Number((req.query as { days?: string }).days ?? 7)));
    return getForecast(days);
  });
  app.get('/forecast/backtest', async () => {
    const f = getForecast(1);
    return { modelRunId: f.modelRunId, historyEnd: f.historyEnd, durationMs: f.backtestMs, items: f.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, selected: i.model, wape: i.wape, m4Eligible: i.m4Eligible, beta: i.beta, lowHistory: i.lowHistory })) };
  });

  // Reorder needs and plans (FR-030 – FR-045).
  app.get('/reorder', async () => computeNeeds());
  app.post('/plans', async (req) => {
    requireRole(req, 'owner', 'chef');
    const plan = await createPlan({ trigger: 'manual' });
    return plan;
  });
  app.get('/plans/:id', async (req) => {
    requireUser(req);
    const p = getPlan((req.params as { id: string }).id);
    if (!p) throw notFound('Plan not found');
    return p;
  });
}
