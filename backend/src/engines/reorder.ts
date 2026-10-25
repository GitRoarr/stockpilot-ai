// Reorder needs and risk status (Solution Design §D2.2–D2.3). Pure functions.

export const Z_TABLE: Record<string, number> = { '0.9': 1.2816, '0.95': 1.6449, '0.98': 2.0537 };
export const zFor = (serviceLevel: number) => Z_TABLE[String(serviceLevel)] ?? 1.6449;

export type ReorderInput = {
  ingredientId: string;
  demandByDay: number[]; // D(i,d) for d = tomorrow, tomorrow+1, …
  H: number;
  leadTimeDays: number;
  safetyDays: number;
  serviceLevel: number;
  sigmaH: number;
  usable: number;
  onOrder: number;
  perishable: boolean;
  shelfLifeDays: number;
  /** Optional minimum stock the restaurant always wants usable (reorder level); a floor for safety stock. */
  reorderLevel?: number | null;
};

export type ReorderTrace = {
  ingredientId: string;
  H: number;
  demandH: number;
  avgDaily: number;
  safetyDaysTerm: number;
  safetyStatTerm: number;
  reorderLevel: number | null;
  z: number;
  sigmaH: number;
  safety: number;
  usable: number;
  onOrder: number;
  net: number;
  shelfCap: number | null;
  need: number;
  daysOfCover: number | null;
  status: 'critical' | 'low' | 'ok';
  flags: string[];
};

export function computeNeed(i: ReorderInput): ReorderTrace {
  const H = Math.max(1, i.H);
  const demandH = sum(i.demandByDay.slice(0, H));
  const avgDaily = demandH / H;
  const z = zFor(i.serviceLevel);
  const safetyDaysTerm = i.safetyDays * avgDaily;
  const safetyStatTerm = z * i.sigmaH;
  const reorderLevel = i.reorderLevel && i.reorderLevel > 0 ? i.reorderLevel : null;
  const safety = Math.max(safetyDaysTerm, safetyStatTerm, reorderLevel ?? 0);
  const net = demandH + safety - i.usable - i.onOrder;
  const shelfCap = i.perishable ? avgDaily * i.shelfLifeDays + safety : null;
  let need = Math.max(0, net);
  const flags: string[] = [];
  if (reorderLevel !== null && reorderLevel > Math.max(safetyDaysTerm, safetyStatTerm)) flags.push('reorder_level_floor');
  if (shelfCap !== null && need > shelfCap) {
    need = shelfCap;
    flags.push('capped_by_shelf_life');
  }
  const daysOfCover = avgDaily > 0 ? i.usable / avgDaily : null;
  let status: ReorderTrace['status'] = 'ok';
  if (daysOfCover !== null) {
    if (daysOfCover < i.leadTimeDays) status = 'critical';
    else if (daysOfCover < i.leadTimeDays + i.safetyDays) status = 'low';
  }
  return {
    ingredientId: i.ingredientId,
    H,
    demandH: r1(demandH),
    avgDaily: r1(avgDaily),
    safetyDaysTerm: r1(safetyDaysTerm),
    safetyStatTerm: r1(safetyStatTerm),
    reorderLevel,
    z,
    sigmaH: r1(i.sigmaH),
    safety: r1(safety),
    usable: r1(i.usable),
    onOrder: r1(i.onOrder),
    net: r1(net),
    shelfCap: shelfCap === null ? null : r1(shelfCap),
    need: r1(need),
    daysOfCover: daysOfCover === null ? null : r1(daysOfCover),
    status,
    flags,
  };
}

export type Batch = { id: string; qty: number; expiresAt: string };

export type ExpiryRisk = { batchId: string; expiresAt: string; qty: number; projectedUse: number; atRisk: number };

/**
 * FIFO simulation (FR-035). Day 0 is today. A batch can be used on days strictly before its expiry date; demand is
 * served from the earliest-expiring usable batch first. Whatever a batch has left when it expires is at risk.
 * Only batches expiring within the window are reported.
 */
export function expiryRisks(batches: Batch[], demandFromToday: number[], today: string, windowDays: number): ExpiryRisk[] {
  const sorted = [...batches].filter((b) => b.qty > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const remaining = sorted.map((b) => b.qty);
  for (let d = 0; d < demandFromToday.length; d++) {
    const date = addDaysIso(today, d);
    let need = demandFromToday[d];
    for (let k = 0; k < sorted.length && need > 0; k++) {
      if (date >= sorted[k].expiresAt) continue;
      const take = Math.min(remaining[k], need);
      remaining[k] -= take;
      need -= take;
    }
  }
  const windowEnd = addDaysIso(today, windowDays);
  const out: ExpiryRisk[] = [];
  sorted.forEach((b, k) => {
    if (b.expiresAt > windowEnd || remaining[k] < 1e-9) return;
    out.push({ batchId: b.id, expiresAt: b.expiresAt, qty: b.qty, projectedUse: r1(b.qty - remaining[k]), atRisk: r1(remaining[k]) });
  });
  return out;
}

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
