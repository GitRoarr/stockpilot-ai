import { db } from '../db/sqlite.js';
import { ingredientSigmaH } from '../engines/forecast/backtest.js';
import { computeNeed, expiryRisks, type ExpiryRisk, type ReorderTrace } from '../engines/reorder.js';
import { baselinePlan, explainPlan, optimise, type NeedInput, type OfferInput, type OptimiserInput, type Plan, type SupplierInput } from '../engines/optimiser/index.js';
import { getSettings } from '../lib/settings.js';
import { addDays, id, json, localDate, localTime, nowIso, round2 } from '../lib/util.js';
import { activeAgreements } from './agreements.js';
import { currentModelRun, getForecast, ingredientDemand, recipeMap, type ForecastView } from './forecast.js';
import { batches, stockSummary } from './inventory.js';

// Reorder needs + multi-supplier optimisation (SRS FR-030 – FR-045, Solution Design §D2.2 – §D2.4).

export type IngredientRow = {
  id: string;
  name: string;
  unit: string;
  category: string;
  perishable: number;
  shelf_life_days: number;
  safety_days: number;
  service_level: number;
  max_overbuy_days: number;
  reorder_level: number | null;
  active: number;
};
export type SupplierRow = {
  id: string;
  name: string;
  email: string;
  min_order_value: number;
  min_order_type: 'hard' | 'soft';
  below_min_fee: number;
  delivery_fee: number;
  order_cycle_days: number;
  delivery_weekdays: string;
  cutoff_time: string;
  trusted: number;
  active: number;
};
export type OfferRow = {
  id: string;
  supplier_id: string;
  ingredient_id: string;
  sku: string;
  pack_size: number;
  unit_price: number;
  lead_time_days: number;
  preferred: number;
  active: number;
  unavailable_until: string | null;
};

export type NeedRow = {
  ingredientId: string;
  name: string;
  unit: string;
  category: string;
  preferredOfferId: string | null;
  preferredSupplierId: string | null;
  leadTimeDays: number;
  demandByDay: number[];
  trace: ReorderTrace & { model: string; minOrderOverride?: number };
  onHand: number;
  expiredQty: number;
  expiry: (ExpiryRisk & { valueAtRisk: number })[];
  valueAtRisk: number;
  unitPrice: number | null;
};

export const ingredients = () => db().all<IngredientRow>(`SELECT * FROM ingredients WHERE active = 1 ORDER BY name`);
export const suppliers = () => db().all<SupplierRow>(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`);
export const offers = () => db().all<OfferRow>(`SELECT o.* FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id WHERE o.active = 1 AND s.active = 1`);

function onOrderQty(): Map<string, number> {
  const rows = db().all<{ ingredient_id: string; q: number }>(
    `SELECT l.ingredient_id, SUM(CASE WHEN l.unavailable = 1 THEN 0 ELSE COALESCE(l.confirmed_qty, l.qty) END) AS q
     FROM po_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id
     WHERE p.status IN ('approved','sent','confirmed','partially_confirmed') GROUP BY l.ingredient_id`,
  );
  return new Map(rows.map((r) => [r.ingredient_id, r.q ?? 0]));
}

/** Needs, safety stock, status and expiry risk for every active ingredient, with full traces (FR-030 – FR-036). */
export function computeNeeds(fc: ForecastView = getForecast(14)): NeedRow[] {
  const today = localDate();
  const run = currentModelRun();
  const recipe = recipeMap();
  const demand = ingredientDemand(fc);
  const sups = new Map(suppliers().map((s) => [s.id, s]));
  const allOffers = offers();
  const ordered = onOrderQty();
  const minOverrides = new Map(
    activeAgreements('min_order_override').map((a) => [String(a.params.ingredientId), Number(a.params.minQty)]),
  );
  const out: NeedRow[] = [];
  for (const ing of ingredients()) {
    const os = allOffers.filter((o) => o.ingredient_id === ing.id);
    const pref = os.find((o) => o.preferred) ?? [...os].sort((a, b) => a.unit_price - b.unit_price)[0];
    const sup = pref ? sups.get(pref.supplier_id) : undefined;
    const lead = pref?.lead_time_days ?? 1;
    const H = lead + (sup?.order_cycle_days ?? 2);
    const d = demand.get(ing.id) ?? new Array(fc.items[0]?.daily.length ?? 14).fill(0);
    const fromTomorrow = d.slice(1);
    const stock = stockSummary(ing.id, today);
    const trace = computeNeed({
      ingredientId: ing.id,
      demandByDay: fromTomorrow,
      H,
      leadTimeDays: lead,
      safetyDays: ing.safety_days,
      serviceLevel: ing.service_level,
      sigmaH: ingredientSigmaH(run.backtests, recipe, ing.id, H),
      usable: stock.usable,
      onOrder: ordered.get(ing.id) ?? 0,
      perishable: Boolean(ing.perishable),
      shelfLifeDays: ing.shelf_life_days,
      reorderLevel: ing.reorder_level,
    });
    const min = minOverrides.get(ing.id);
    const t: NeedRow['trace'] = { ...trace, model: modelsFor(fc, recipe, ing.id) };
    if (min && t.need > 0 && t.need < min) {
      t.need = min;
      t.minOrderOverride = min;
      t.flags = [...t.flags, 'min_order_override'];
    }
    const price = pref?.unit_price ?? null;
    const risks = expiryRisks(
      batches(ing.id).map((b) => ({ id: b.id, qty: b.qty, expiresAt: b.expires_at })),
      d,
      today,
      getSettings().expiryWindowDays,
    ).map((r) => ({ ...r, valueAtRisk: round2(r.atRisk * (price ?? 0)) }));
    out.push({
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      category: ing.category,
      preferredOfferId: pref?.id ?? null,
      preferredSupplierId: pref?.supplier_id ?? null,
      leadTimeDays: lead,
      demandByDay: fromTomorrow.slice(0, H).map((v) => Math.round(v * 10) / 10),
      trace: t,
      onHand: stock.onHand,
      expiredQty: stock.expired,
      expiry: risks,
      valueAtRisk: round2(risks.reduce((s, r) => s + r.valueAtRisk, 0)),
      unitPrice: price,
    });
  }
  return out;
}

function modelsFor(fc: ForecastView, recipe: Map<string, Map<string, number>>, ingredientId: string): string {
  const ms = new Set<string>();
  for (const it of fc.items) if (recipe.get(it.menuItemId)?.has(ingredientId)) ms.add(it.model);
  return [...ms].sort().join('/') || 'none';
}

export type PlanOptions = {
  trigger: string;
  /** Plan only these ingredients with these needs (shortage replanning, FR-076). */
  needsOverride?: { ingredientId: string; need: number }[];
  excludeOfferIds?: string[];
  excludeSupplierIds?: string[];
};

export type PlanRecord = {
  id: string;
  createdAt: string;
  trigger: string;
  needs: NeedRow[];
  solution: Plan;
  baseline: Plan;
  saving: number;
  savingPct: number;
  method: Plan['method'];
  violations: string[];
  explanations: Record<string, string>;
  fallbackReason?: string;
  excludedByAgreements: string[];
  /** Ingredients with a need but no feasible supplier offer (not part of the optimisation). */
  unsourced: { ingredientId: string; name: string; need: number }[];
  durationMs: number;
};

/** Builds the optimiser input from needs: feasible offers, caps, agreements (exclude/prefer/rounding). */
export function optimiserInput(needs: NeedRow[], opts: PlanOptions): { input: OptimiserInput; baselineInput: OptimiserInput; excluded: string[]; unsourced: { ingredientId: string; name: string; need: number }[] } {
  const today = localDate();
  const time = localTime();
  const sups = suppliers();
  const supMap = new Map(sups.map((s) => [s.id, s]));
  const ingMap = new Map(ingredients().map((i) => [i.id, i]));
  const agreements = activeAgreements();
  const excluded: string[] = [];
  const override = opts.needsOverride ? new Map(opts.needsOverride.map((n) => [n.ingredientId, n.need])) : undefined;

  const offerRows = offers().filter((o) => {
    if (o.unavailable_until && o.unavailable_until >= today) return false;
    if (opts.excludeOfferIds?.includes(o.id) || opts.excludeSupplierIds?.includes(o.supplier_id)) return false;
    const n = needs.find((x) => x.ingredientId === o.ingredient_id);
    const s = supMap.get(o.supplier_id);
    if (!n || !s) return false;
    // Lead time must allow delivery within the coverage horizon; after the cut-off the order goes out a day later.
    const lead = o.lead_time_days + (time > s.cutoff_time ? 1 : 0);
    return lead <= n.trace.H;
  });

  const isExcludedByAgreement = (o: OfferRow) =>
    agreements.some((a) => {
      if (a.type !== 'exclude_supplier' || a.params.supplierId !== o.supplier_id) return false;
      if (a.params.ingredientId) return a.params.ingredientId === o.ingredient_id;
      return a.params.category === ingMap.get(o.ingredient_id)?.category;
    });

  const toOffer = (o: OfferRow): OfferInput => {
    const ing = ingMap.get(o.ingredient_id);
    const prefer = agreements.find(
      (a) => a.type === 'prefer_supplier' && a.params.supplierId === o.supplier_id && (!a.params.category || a.params.category === ing?.category) && (!a.params.ingredientId || a.params.ingredientId === o.ingredient_id),
    );
    return {
      id: o.id,
      supplierId: o.supplier_id,
      ingredientId: o.ingredient_id,
      sku: o.sku,
      packSize: o.pack_size,
      unitPrice: o.unit_price,
      preferred: Boolean(o.preferred),
      objectiveFactor: prefer ? 1 - Number(prefer.params.maxPremiumPct ?? 0) / 100 : 1,
    };
  };

  const planNeeds: NeedInput[] = [];
  // A full plan should not be blocked by an ingredient nobody sells yet (e.g. just added): report it instead.
  const unsourced: { ingredientId: string; name: string; need: number }[] = [];
  for (const n of needs) {
    const need = override ? override.get(n.ingredientId) : n.trace.need;
    if (!need || need <= 0) continue;
    if (!override && !offerRows.some((o) => o.ingredient_id === n.ingredientId)) {
      unsourced.push({ ingredientId: n.ingredientId, name: n.name, need: Math.round(need * 10) / 10 });
      continue;
    }
    const ing = ingMap.get(n.ingredientId)!;
    const smallestPack = Math.min(...offerRows.filter((o) => o.ingredient_id === n.ingredientId).map((o) => o.pack_size), Infinity);
    let cap = ing.perishable && n.trace.shelfCap !== null ? n.trace.shelfCap - need : ing.max_overbuy_days * n.trace.avgDaily;
    // Whole packs need room above the need: allow at least one (smallest) pack of overbuy.
    if (Number.isFinite(smallestPack)) cap = Math.max(cap, smallestPack - 1e-6);
    const rounding = agreements.find((a) => a.type === 'rounding_preference' && a.params.category === ing.category);
    if (rounding?.params.direction === 'up' && Number.isFinite(smallestPack)) cap += smallestPack;
    planNeeds.push({ ingredientId: n.ingredientId, name: n.name, need: Math.round(need * 1000) / 1000, cap: Math.max(0, cap), category: ing.category });
  }

  const supplierInputs: SupplierInput[] = sups.map((s) => ({
    id: s.id,
    name: s.name,
    minOrderValue: s.min_order_value,
    minOrderType: s.min_order_type,
    belowMinFee: s.below_min_fee,
    deliveryFee: s.delivery_fee,
  }));
  const kept = offerRows.filter((o) => {
    if (isExcludedByAgreement(o)) {
      excluded.push(o.id);
      return false;
    }
    return true;
  });
  return {
    input: { needs: planNeeds, offers: kept.map(toOffer), suppliers: supplierInputs },
    baselineInput: { needs: planNeeds, offers: offerRows.map((o) => ({ ...toOffer(o), objectiveFactor: 1 })), suppliers: supplierInputs },
    excluded,
    unsourced,
  };
}

export async function createPlan(opts: PlanOptions, fc?: ForecastView): Promise<PlanRecord> {
  const t0 = Date.now();
  const needs = computeNeeds(fc);
  const { input, baselineInput, excluded, unsourced } = optimiserInput(needs, opts);
  const solution = await optimise(input);
  const baseline = baselinePlan(baselineInput);
  const saving = round2(baseline.total - solution.total);
  const explanations = explainPlan(baselineInput, solution, baseline);
  const rec: PlanRecord = {
    id: id('pln'),
    createdAt: nowIso(),
    trigger: opts.trigger,
    needs: needs.filter((n) => input.needs.some((x) => x.ingredientId === n.ingredientId)),
    solution,
    baseline,
    saving,
    savingPct: baseline.total > 0 ? Math.round((saving / baseline.total) * 1000) / 10 : 0,
    method: solution.method,
    violations: solution.violations,
    explanations,
    fallbackReason: solution.fallbackReason,
    excludedByAgreements: excluded,
    unsourced,
    durationMs: Date.now() - t0,
  };
  db().run(
    `INSERT INTO plans (id, created_at, trigger, needs_json, solution_json, baseline_json, method, total, baseline_total, saving, violations_json, explanations_json, fallback_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rec.id,
    rec.createdAt,
    rec.trigger,
    JSON.stringify({ needs: rec.needs, excludedByAgreements: excluded, unsourced, input: input.needs, durationMs: rec.durationMs }),
    JSON.stringify(solution),
    JSON.stringify(baseline),
    solution.method,
    solution.total,
    baseline.total,
    saving,
    JSON.stringify(solution.violations),
    JSON.stringify(explanations),
    solution.fallbackReason ?? null,
  );
  return rec;
}

export function getPlan(planId: string): PlanRecord | undefined {
  const r = db().get<any>(`SELECT * FROM plans WHERE id = ?`, planId);
  if (!r) return undefined;
  const n = json<{ needs: NeedRow[]; excludedByAgreements: string[]; unsourced?: PlanRecord['unsourced']; durationMs: number }>(r.needs_json, { needs: [], excludedByAgreements: [], durationMs: 0 });
  return {
    id: r.id,
    createdAt: r.created_at,
    trigger: r.trigger,
    needs: n.needs,
    solution: json(r.solution_json, {} as Plan),
    baseline: json(r.baseline_json, {} as Plan),
    saving: r.saving,
    savingPct: r.baseline_total > 0 ? Math.round((r.saving / r.baseline_total) * 1000) / 10 : 0,
    method: r.method,
    violations: json(r.violations_json, []),
    explanations: json(r.explanations_json, {}),
    fallbackReason: r.fallback_reason ?? undefined,
    excludedByAgreements: n.excludedByAgreements,
    unsourced: n.unsourced ?? [],
    durationMs: n.durationMs,
  };
}

/** Delivery date for an order placed now (lead time, after cut-off +1 day). */
export function deliveryDate(supplierId: string, leadDays: number): string {
  const s = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, supplierId);
  const extra = s && localTime() > s.cutoff_time ? 1 : 0;
  return addDays(localDate(), Math.max(1, leadDays + extra));
}
