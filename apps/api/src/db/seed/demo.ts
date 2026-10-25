import { db } from '../sqlite.js';
import { hashPassword } from '../../auth/password.js';
import { saveSettings, DEFAULT_SETTINGS } from '../../lib/settings.js';
import { addDays, id, localDate, nowIso, resetClockCache, round2, weekday } from '../../lib/util.js';
import { RAIN_THRESHOLD_IN, refreshContext } from '../../services/context.js';
import { fitModels, HISTORY_DAYS } from '../../services/forecast.js';
import { deployTemplate } from '../../services/onboarding.js';
import { computeNeeds, createPlan } from '../../services/planning.js';
import { DEMO_PASSWORD, INGREDIENTS, MENU, NEED_TARGETS, OFFERS, RAIN_EFFECT, RECIPES, STOCK_COVER, SUPPLIERS, USERS, WEEKDAY_FACTOR } from './data.js';

// Seed / "Reset demo data" (SRS FR-001, AC-001). Deterministic RNG; weather from the Open-Meteo archive when reachable,
// otherwise a deterministic synthetic series (labelled `synthetic_demo`).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clearAll(): void {
  const tables = db()
    .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .map((t) => t.name);
  db().exec('PRAGMA foreign_keys = OFF');
  try {
    db().tx(() => {
      for (const t of tables) db().run(`DELETE FROM ${t}`);
    });
  } finally {
    db().exec('PRAGMA foreign_keys = ON');
  }
  resetClockCache();
}

export type SeedReport = {
  users: { email: string; role: string; password: string }[];
  counts: Record<string, number>;
  weatherSource: string;
  holidays: number;
  demoPlan: { total: number; baseline: number; saving: number; goldenGateLines: string[]; method: string } | null;
  warnings: string[];
};

export async function seedDemo(opts: { offline?: boolean; log?: (s: string) => void } = {}): Promise<SeedReport> {
  const log = opts.log ?? (() => {});
  const warnings: string[] = [];
  clearAll();
  saveSettings({ ...DEFAULT_SETTINGS, demoData: true });
  const today = localDate();
  const historyStart = addDays(today, -HISTORY_DAYS);

  // Users (NFR-SEC-3: scrypt with per-user salt).
  const pw = await hashPassword(DEMO_PASSWORD);
  for (const u of USERS) db().run(`INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?,?,?,?,?,?)`, u.id, u.name, u.email, u.role, pw, nowIso());

  db().tx(() => {
    for (const s of SUPPLIERS)
      db().run(
        `INSERT INTO suppliers (id, name, email, min_order_value, min_order_type, below_min_fee, delivery_fee, order_cycle_days, delivery_weekdays, cutoff_time, trusted) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        s.id,
        s.name,
        s.email,
        s.min,
        s.type,
        s.fee,
        s.delivery,
        s.cycle,
        '1,2,3,4,5,6',
        s.cutoff,
        s.trusted,
      );
    for (const i of INGREDIENTS)
      db().run(
        `INSERT INTO ingredients (id, name, unit, category, perishable, shelf_life_days, safety_days, service_level, max_overbuy_days) VALUES (?,?,?,?,?,?,?,0.95,?)`,
        i.id,
        i.name,
        i.unit,
        i.category,
        i.perishable,
        i.shelf,
        i.safety,
        i.overbuy,
      );
    for (const [sup, ing, sku, pack, price, lead, pref] of OFFERS)
      db().run(`INSERT INTO supplier_offers (id, supplier_id, ingredient_id, sku, pack_size, unit_price, lead_time_days, preferred) VALUES (?,?,?,?,?,?,?,?)`, `off_${sku.toLowerCase()}`, sup, ing, sku, pack, price, lead, pref);
    for (const [mid, name, price] of MENU) db().run(`INSERT INTO menu_items (id, name, price) VALUES (?,?,?)`, mid, name, price);
    for (const [mid, lines] of Object.entries(RECIPES)) for (const [ing, q] of lines) db().run(`INSERT INTO recipe_lines (menu_item_id, ingredient_id, qty) VALUES (?,?,?)`, mid, ing, q);
  });

  // Team template (FR-111) with the Balanced preset; onboarding tasks go to the Owner.
  deployTemplate({ autonomy: { preset: 'balanced' } }, { type: 'system' }, 'usr_sara');
  db().run(`UPDATE tasks SET status = 'done' WHERE created_by_type = 'system'`);

  // Context: real weather + holidays when online (FR-022 – FR-024).
  let weatherSource = 'synthetic_demo';
  if (!opts.offline) {
    const st = await refreshContext({ force: true, historyStart });
    if (st.weather_history?.status === 'ok') weatherSource = 'open-meteo archive';
    else warnings.push(`Historical weather unavailable (${st.weather_history?.message}); using synthetic demo weather`);
    if (st.holidays?.status !== 'ok') warnings.push('Holidays unavailable — no holiday feature');
  }
  const rand = mulberry32(20261024);
  const have = new Set(db().all<{ date: string }>(`SELECT date FROM weather_days`).map((r) => r.date));
  db().tx(() => {
    for (let d = historyStart; d < today; d = addDays(d, 1)) {
      if (have.has(d)) continue;
      // Synthetic SF-like weather: mild, ~15% rain days (labelled synthetic_demo).
      const doy = (Date.parse(d) / 86400000) % 365;
      const tmax = 64 + 6 * Math.sin((2 * Math.PI * (doy - 200)) / 365) + gaussian(rand) * 4;
      const precip = rand() < 0.15 ? 0.2 + rand() * 0.6 : rand() < 0.1 ? rand() * 0.15 : 0;
      db().run(`INSERT INTO weather_days (date, tmax_f, precip_in, weather_code, source, fetched_at) VALUES (?,?,?,?,'synthetic_demo',?)`, d, Math.round(tmax * 10) / 10, Math.round(precip * 100) / 100, precip >= 0.2 ? 61 : 3, nowIso());
    }
  });

  // 180 days of sales: weekday seasonality, slow trend, noise, planted −10% rain effect, temperature and holiday effects.
  const weather = new Map(db().all<{ date: string; tmax_f: number; precip_in: number }>(`SELECT date, tmax_f, precip_in FROM weather_days`).map((r) => [r.date, r]));
  const holidays = new Set(db().all<{ date: string }>(`SELECT date FROM holidays`).map((r) => r.date));
  db().tx(() => {
    let k = 0;
    for (let d = historyStart; d < today; d = addDays(d, 1), k++) {
      const w = weather.get(d);
      const trailing: number[] = [];
      for (let j = 1; j <= 28; j++) {
        const t = weather.get(addDays(d, -j))?.tmax_f;
        if (t !== undefined && t !== null) trailing.push(t);
      }
      const anomaly = w && trailing.length ? (w.tmax_f - trailing.reduce((a, b) => a + b, 0) / trailing.length) / 10 : 0;
      const rain = w && w.precip_in >= RAIN_THRESHOLD_IN ? 1 : 0;
      const hol = holidays.has(d) ? 0.15 : holidays.has(addDays(d, 1)) ? 0.1 : 0;
      for (const [mid, , , base, tempSens] of MENU) {
        const trend = 1 + 0.0004 * k;
        const mult = WEEKDAY_FACTOR[weekday(d)] * trend * (1 + RAIN_EFFECT * rain) * (1 + tempSens * anomaly) * (1 + hol) * (1 + 0.12 * gaussian(rand));
        db().run(`INSERT INTO sales_records (date, menu_item_id, qty) VALUES (?,?,?)`, d, mid, Math.max(0, Math.round(base * mult)));
      }
    }
  });

  // A few past closed orders (4-week history for the auto-send rule and price-creep medians).
  seedHistory(today);

  // Forecast + calibrated opening stock (AC-001: one critical, one near-expiry, one shelf-capped item).
  fitModels();
  calibrateStock(today);
  let demoPlan: SeedReport['demoPlan'] = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const plan = await createPlan({ trigger: 'seed_check' });
    const ggLines = plan.solution.lines.filter((l) => l.supplierId === 'sup_gg');
    const extra = ggLines.filter((l) => !NEED_TARGETS[l.ingredientId]);
    // Suppliers whose minimum makes the plan infeasible: their small needs are topped up (the demo morning must be feasible).
    const blocked = plan.violations.length ? plan.solution.lines.filter((l) => plan.violations.some((v) => v.startsWith(plan.solution.suppliers.find((s) => s.supplierId === l.supplierId)?.name ?? '#'))) : [];
    demoPlan = { total: plan.solution.total, baseline: plan.baseline.total, saving: plan.saving, goldenGateLines: ggLines.map((l) => `${l.sku} ${l.packs}×${l.packSize}`), method: plan.method };
    const fix = [...extra, ...blocked.filter((l) => !NEED_TARGETS[l.ingredientId])];
    if (!fix.length && plan.method === 'milp' && !plan.violations.length) break;
    if (!fix.length) {
      warnings.push(`Demo plan is ${plan.method} with violations: ${plan.violations.join('; ')}`);
      break;
    }
    // Keep the demo Golden Gate order to the three documented items: top up the others so they need nothing today.
    for (const l of fix) topUp(l.ingredientId, today);
    warnings.push(`Adjusted stock of ${fix.map((l) => l.ingredientId).join(', ')} so the demo order matches the worked example`);
  }
  db().run(`DELETE FROM plans`);
  db().run(`DELETE FROM forecast_model_runs`);
  fitModels();

  const counts = Object.fromEntries(['ingredients', 'suppliers', 'supplier_offers', 'menu_items', 'recipe_lines', 'sales_records', 'stock_batches', 'users', 'agents', 'weather_days', 'holidays', 'purchase_orders'].map((t) => [t, db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n]));
  const multi = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT ingredient_id FROM supplier_offers GROUP BY ingredient_id HAVING COUNT(DISTINCT supplier_id) >= 2)`)!.n;
  counts.multiSupplierIngredients = multi;
  log(`Seeded: ${JSON.stringify(counts)}`);
  return {
    users: USERS.map((u) => ({ email: u.email, role: u.role, password: DEMO_PASSWORD })),
    counts,
    weatherSource,
    holidays: counts.holidays,
    demoPlan,
    warnings,
  };
}

function addStock(ingredientId: string, qty: number, expiresAt: string, today: string): void {
  if (qty <= 0) return;
  db().run(`INSERT INTO stock_batches (id, ingredient_id, qty, received_at, expires_at, source) VALUES (?,?,?,?,?,'seed')`, id('bat'), ingredientId, Math.ceil(qty * 10) / 10, addDays(today, -1), expiresAt);
}

function calibrateStock(today: string): void {
  db().run(`DELETE FROM stock_batches`);
  const shelf = new Map(INGREDIENTS.map((i) => [i.id, i]));
  for (const n of computeNeeds()) {
    const ing = shelf.get(n.ingredientId)!;
    const base = n.trace.demandH + n.trace.safety; // need with nothing usable or on order
    const avg = n.trace.avgDaily;
    // Ample stock arrived today (fresh); risk-case items arrived yesterday.
    const fresh = NEED_TARGETS[n.ingredientId] === undefined && STOCK_COVER[n.ingredientId] === undefined;
    const expires = addDays(today, Math.max(2, ing.perishable ? ing.shelf - (fresh ? 0 : 1) : 120));
    let usable: number;
    if (NEED_TARGETS[n.ingredientId] !== undefined) usable = base - NEED_TARGETS[n.ingredientId];
    else if (STOCK_COVER[n.ingredientId] !== undefined) usable = STOCK_COVER[n.ingredientId] * avg;
    // Ample: no need today even if a weather/holiday refresh moves the forecast (dry goods get a wider margin).
    else usable = Math.ceil((base + Math.max((ing.perishable ? 0.3 : 1.5) * avg, 0.3)) * 10) / 10;
    if (n.ingredientId === 'ing_cream') {
      // Near-expiry: a batch that cannot be used up before it expires (FR-035).
      addStock('ing_cream', 10, addDays(today, 2), today);
      usable = Math.max(0, usable - 10);
    }
    addStock(n.ingredientId, usable, expires, today);
  }
  // An expired batch for the write-off list (FR-036).
  addStock('ing_greens', 1.5, today, today);
}

function topUp(ingredientId: string, today: string): void {
  const n = computeNeeds().find((x) => x.ingredientId === ingredientId);
  if (!n) return;
  const ing = INGREDIENTS.find((i) => i.id === ingredientId)!;
  addStock(ingredientId, n.trace.need + 0.5 * n.trace.avgDaily, addDays(today, Math.max(2, ing.perishable ? ing.shelf - 1 : 120)), today);
}

function seedHistory(today: string): void {
  const plan: [string, string, number][] = [
    ['sup_gg', 'off_gg-44120', 2],
    ['sup_gg', 'off_gg-81002', 2],
    ['sup_gg', 'off_gg-23310', 1],
    ['sup_bay', 'off_bm-bac', 2],
    ['sup_bay', 'off_bm-sal', 3],
    ['sup_mission', 'off_mp-rom24', 2],
    ['sup_mission', 'off_mp-tov25', 1],
    ['sup_sonoma', 'off_sc-but36', 1],
  ];
  let n = 988;
  for (const daysAgo of [21, 14, 7]) {
    for (const sup of ['sup_gg', 'sup_bay', 'sup_mission', 'sup_sonoma']) {
      const lines = plan.filter((p) => p[0] === sup);
      const at = `${addDays(today, -daysAgo)}T14:00:00.000Z`;
      const poId = id('po');
      let subtotal = 0;
      const rows = lines.map(([, offerId, packs]) => {
        const o = db().get<{ ingredient_id: string; pack_size: number; unit_price: number }>(`SELECT * FROM supplier_offers WHERE id = ?`, offerId)!;
        const qty = packs * o.pack_size;
        subtotal += qty * o.unit_price;
        return { offerId, o, packs, qty };
      });
      const s = SUPPLIERS.find((x) => x.id === sup)!;
      const fees = s.delivery + (s.type === 'soft' && subtotal < s.min ? s.fee : 0);
      db().run(
        `INSERT INTO purchase_orders (id, number, supplier_id, status, delivery_date, subtotal, fees, total, created_by_type, approved_by, approved_at, sent_at, send_channel, created_at, updated_at)
         VALUES (?,?,?,'closed',?,?,?,?,'agent','usr_daniel',?,?,'email',?,?)`,
        poId,
        `PO-${++n}`,
        sup,
        addDays(today, -daysAgo + 1),
        round2(subtotal),
        fees,
        round2(subtotal + fees),
        at,
        at,
        at,
        at,
      );
      for (const r of rows)
        db().run(
          `INSERT INTO po_lines (id, purchase_order_id, offer_id, ingredient_id, need, packs, pack_size, qty, unit_price, line_total, confirmed_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          id('pol'),
          poId,
          r.offerId,
          r.o.ingredient_id,
          r.qty,
          r.packs,
          r.o.pack_size,
          r.qty,
          r.o.unit_price,
          round2(r.qty * r.o.unit_price),
          r.qty,
        );
    }
  }
}
