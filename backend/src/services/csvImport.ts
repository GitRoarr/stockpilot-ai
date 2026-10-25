import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { addDays, id, localDate, round2, unprocessable } from '../lib/util.js';
import { invalidateForecast } from './forecast.js';
import { recordMovement, stockSummary } from './inventory.js';

// CSV import/export: sales (SRS FR-009, dry-run preview of accepted and rejected rows) and inventory (approved addition).
// Accepted rows are written in one transaction; rejected rows are listed with their reason and never written.
export const MAX_ROWS = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Rejected = { line: number; raw: string; error: string };
export type ImportResult<A> = { dryRun: boolean; columns: string[]; accepted: A[]; rejected: Rejected[]; applied: number };

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, optional BOM. Returns rows with their 1-based line number. */
export function parseCsv(text: string): { line: number; cells: string[]; raw: string }[] {
  const src = text.replace(/^﻿/, '');
  const rows: { line: number; cells: string[]; raw: string }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 0;
  let rowLine = 1;
  const endRow = (end: number) => {
    cells.push(cell);
    const raw = src.slice(start, end);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells, raw });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') cells.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      endRow(i);
      if (ch === '\r' && src[i + 1] === '\n') i++;
      line++;
      start = i + 1;
      rowLine = line;
    } else cell += ch;
  }
  if (quoted) throw unprocessable(`Unclosed quote starting on line ${rowLine}`);
  endRow(src.length);
  return rows;
}

/** Splits the header row off and maps it to known column names (case- and space-insensitive). */
function table(text: string, known: readonly string[], required: readonly string[]) {
  const rows = parseCsv(text);
  if (!rows.length) throw unprocessable('The file is empty');
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]/g, '');
  const byNorm = new Map(known.map((k) => [norm(k), k]));
  const columns = rows[0].cells.map((h) => byNorm.get(norm(h)) ?? h.trim());
  const unknownCols = columns.filter((c) => !known.includes(c));
  if (unknownCols.length) throw unprocessable(`Unknown column(s): ${unknownCols.join(', ')}. Expected: ${known.join(', ')}`);
  const missing = required.filter((r) => !columns.includes(r));
  if (missing.length) throw unprocessable(`Missing required column(s): ${missing.join(', ')}`);
  if (new Set(columns).size !== columns.length) throw unprocessable('A column appears twice in the header');
  const body = rows.slice(1);
  if (!body.length) throw unprocessable('The file has a header but no data rows');
  if (body.length > MAX_ROWS) throw unprocessable(`Too many rows (${body.length}); the limit is ${MAX_ROWS} per import`);
  return {
    columns,
    rows: body.map((r) => ({ line: r.line, raw: r.raw, get: (c: string) => (columns.indexOf(c) >= 0 ? (r.cells[columns.indexOf(c)] ?? '').trim() : ''), extra: r.cells.length > columns.length })),
  };
}

const numberCell = (v: string, label: string, opts: { int?: boolean; min?: number; max?: number } = {}) => {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`${label} must be a number (got "${v}")`);
  const n = Number(v);
  if (opts.int && !Number.isInteger(n)) throw new Error(`${label} must be a whole number`);
  if (opts.min !== undefined && n < opts.min) throw new Error(`${label} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`${label} must be at most ${opts.max}`);
  return n;
};
const dateCell = (v: string, label: string) => {
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new Error(`${label} must be a real date as YYYY-MM-DD (got "${v}")`);
  return v;
};

// ---- Sales: date,menuItem,qty ----
export const SALES_COLUMNS = ['date', 'menuItem', 'qty'] as const;
export type SalesRow = { line: number; date: string; menuItem: string; menuItemId: string; qty: number; previousQty: number | null };

export function importSales(csv: string, dryRun: boolean, actor: Actor): ImportResult<SalesRow> {
  const t = table(csv, SALES_COLUMNS, SALES_COLUMNS);
  const today = localDate();
  const menu = db().all<{ id: string; name: string }>(`SELECT id, name FROM menu_items`);
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const m of menu) byName.set(m.name.toLowerCase(), [...(byName.get(m.name.toLowerCase()) ?? []), m]);
  const seen = new Set<string>();
  const accepted: SalesRow[] = [];
  const rejected: Rejected[] = [];
  for (const r of t.rows) {
    try {
      if (r.extra) throw new Error('Row has more cells than the header');
      const date = dateCell(r.get('date'), 'date');
      if (date >= today) throw new Error('Sales can only be imported for completed days (before today)');
      if (date < addDays(today, -365)) throw new Error('Sales older than one year are not used');
      const name = r.get('menuItem');
      const matches = byName.get(name.toLowerCase()) ?? [];
      if (!name) throw new Error('menuItem is empty');
      if (!matches.length) throw new Error(`Unknown dish "${name}" — add it in Inventory → Menu first`);
      if (matches.length > 1) throw new Error(`Dish name "${name}" is ambiguous`);
      const qty = numberCell(r.get('qty'), 'qty', { int: true, min: 0, max: 10000 });
      const key = `${date}|${matches[0].id}`;
      if (seen.has(key)) throw new Error(`Duplicate row for ${matches[0].name} on ${date}`);
      seen.add(key);
      const prev = db().get<{ qty: number }>(`SELECT qty FROM sales_records WHERE date = ? AND menu_item_id = ?`, date, matches[0].id);
      accepted.push({ line: r.line, date, menuItem: matches[0].name, menuItemId: matches[0].id, qty, previousQty: prev?.qty ?? null });
    } catch (e) {
      rejected.push({ line: r.line, raw: r.raw.slice(0, 200), error: (e as Error).message });
    }
  }
  if (dryRun || !accepted.length) return { dryRun, columns: t.columns, accepted, rejected, applied: 0 };
  db().tx(() => {
    for (const a of accepted) db().run(`INSERT INTO sales_records (date, menu_item_id, qty) VALUES (?,?,?) ON CONFLICT(date, menu_item_id) DO UPDATE SET qty = excluded.qty`, a.date, a.menuItemId, a.qty);
    invalidateForecast();
    audit(actor, 'sales.imported', 'sales', 'csv', { meta: { rows: accepted.length, rejected: rejected.length, dates: [...new Set(accepted.map((a) => a.date))].sort() } });
  });
  publish('forecast.updated', { source: 'csv' });
  return { dryRun, columns: t.columns, accepted, rejected, applied: accepted.length };
}

// ---- Inventory: name,unit,category,onHand,expiresAt,reorderLevel,shelfLifeDays,perishable ----
export const INVENTORY_COLUMNS = ['name', 'unit', 'category', 'onHand', 'expiresAt', 'reorderLevel', 'shelfLifeDays', 'perishable'] as const;
const UNITS = ['lb', 'oz', 'gal', 'qt', 'each'] as const;
export type InventoryRow = {
  line: number;
  name: string;
  action: 'create' | 'update';
  ingredientId: string | null;
  changes: string[];
  set: { unit?: string; category?: string; reorderLevel?: number | null; shelfLifeDays?: number; perishable?: boolean };
  onHand: number | null;
  previousOnHand: number | null;
  expiresAt: string | null;
};

const boolCell = (v: string) => {
  const s = v.toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  throw new Error(`perishable must be yes or no (got "${v}")`);
};

export function importInventory(csv: string, dryRun: boolean, actor: Actor): ImportResult<InventoryRow> {
  const t = table(csv, INVENTORY_COLUMNS, ['name']);
  const today = localDate();
  const existing = new Map(db().all<{ id: string; name: string; unit: string; category: string; reorder_level: number | null; shelf_life_days: number; perishable: number; active: number }>(`SELECT * FROM ingredients`).map((i) => [i.name.toLowerCase(), i]));
  const seen = new Set<string>();
  const accepted: InventoryRow[] = [];
  const rejected: Rejected[] = [];
  for (const r of t.rows) {
    try {
      if (r.extra) throw new Error('Row has more cells than the header');
      const name = r.get('name');
      if (!name) throw new Error('name is empty');
      if (name.length > 80) throw new Error('name is longer than 80 characters');
      if (seen.has(name.toLowerCase())) throw new Error(`"${name}" appears more than once in the file`);
      seen.add(name.toLowerCase());
      const cur = existing.get(name.toLowerCase());
      const set: InventoryRow['set'] = {};
      const changes: string[] = [];
      const unit = r.get('unit');
      if (unit) {
        if (!(UNITS as readonly string[]).includes(unit)) throw new Error(`unit must be one of ${UNITS.join(', ')} (got "${unit}")`);
        if (cur && cur.unit !== unit) throw new Error(`unit cannot change by import (${cur.name} is counted in ${cur.unit})`);
        if (!cur) set.unit = unit;
      } else if (!cur) throw new Error('unit is required for a new ingredient');
      const category = r.get('category');
      if (category) {
        if (category.length > 40) throw new Error('category is longer than 40 characters');
        if (category !== cur?.category) (set.category = category), changes.push(`category → ${category}`);
      } else if (!cur) throw new Error('category is required for a new ingredient');
      const rl = r.get('reorderLevel');
      if (rl) {
        const v = rl.toLowerCase() === 'none' ? null : numberCell(rl, 'reorderLevel', { min: 0, max: 100000 });
        if (v !== (cur?.reorder_level ?? null)) (set.reorderLevel = v), changes.push(`reorder level → ${v ?? 'none'}`);
      }
      const sl = r.get('shelfLifeDays');
      if (sl) {
        const v = numberCell(sl, 'shelfLifeDays', { int: true, min: 1, max: 365 });
        if (v !== cur?.shelf_life_days) (set.shelfLifeDays = v), changes.push(`shelf life → ${v} days`);
      }
      const p = r.get('perishable');
      if (p) {
        const v = boolCell(p);
        if (!cur || v !== Boolean(cur.perishable)) (set.perishable = v), cur && changes.push(`perishable → ${v ? 'yes' : 'no'}`);
      }
      const oh = r.get('onHand');
      const onHand = oh ? numberCell(oh, 'onHand', { min: 0, max: 100000 }) : null;
      const ex = r.get('expiresAt');
      const expiresAt = ex ? dateCell(ex, 'expiresAt') : null;
      if (expiresAt && expiresAt < today) throw new Error('expiresAt is in the past');
      if (expiresAt && onHand === null) throw new Error('expiresAt needs an onHand count');
      const previousOnHand = cur ? stockSummary(cur.id, today).onHand : null;
      if (onHand !== null && onHand !== (previousOnHand ?? 0)) changes.push(`on hand ${previousOnHand ?? 0} → ${onHand}`);
      if (!cur) changes.unshift('new ingredient');
      if (cur && !cur.active) throw new Error(`${cur.name} is inactive — reactivate it in Inventory first`);
      accepted.push({ line: r.line, name: cur?.name ?? name, action: cur ? 'update' : 'create', ingredientId: cur?.id ?? null, changes, set, onHand, previousOnHand, expiresAt });
    } catch (e) {
      rejected.push({ line: r.line, raw: r.raw.slice(0, 200), error: (e as Error).message });
    }
  }
  if (dryRun || !accepted.length) return { dryRun, columns: t.columns, accepted, rejected, applied: 0 };
  db().tx(() => {
    for (const a of accepted) {
      let iid = a.ingredientId;
      if (!iid) {
        iid = id('ing');
        db().run(
          `INSERT INTO ingredients (id, name, unit, category, perishable, shelf_life_days, safety_days, service_level, max_overbuy_days, reorder_level) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          iid,
          a.name,
          a.set.unit!,
          a.set.category!,
          a.set.perishable ?? true,
          a.set.shelfLifeDays ?? 7,
          1,
          0.95,
          3,
          a.set.reorderLevel ?? null,
        );
        audit(actor, 'ingredient.created', 'ingredient', iid, { after: { ...a.set, name: a.name }, meta: { source: 'csv' } });
      } else {
        const map: Record<string, string> = { category: 'category', reorderLevel: 'reorder_level', shelfLifeDays: 'shelf_life_days', perishable: 'perishable' };
        const keys = Object.keys(a.set).filter((k) => map[k]);
        if (keys.length) {
          db().run(`UPDATE ingredients SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (a.set as any)[k]), iid);
          audit(actor, 'ingredient.updated', 'ingredient', iid, { after: a.set, meta: { source: 'csv' } });
        }
      }
      if (a.onHand !== null) recordMovement(iid, { type: 'count_adjust', countedQty: a.onHand, expiresAt: a.expiresAt ?? undefined, reason: 'CSV import' }, actor);
    }
    audit(actor, 'inventory.imported', 'ingredient', 'csv', { meta: { rows: accepted.length, created: accepted.filter((a) => a.action === 'create').length, rejected: rejected.length } });
  });
  publish('stock.updated', { source: 'csv' });
  return { dryRun, columns: t.columns, accepted, rejected, applied: accepted.length };
}

// ---- Export and templates ----
/** Quotes a cell when needed and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function inventoryCsv(): string {
  const today = localDate();
  const rows = db().all<{ id: string; name: string; unit: string; category: string; reorder_level: number | null; shelf_life_days: number; perishable: number }>(`SELECT * FROM ingredients WHERE active = 1 ORDER BY name`);
  return toCsv([
    [...INVENTORY_COLUMNS],
    ...rows.map((i) => {
      const next = db().get<{ e: string | null }>(`SELECT MIN(expires_at) AS e FROM stock_batches WHERE ingredient_id = ? AND qty > 0 AND expires_at > ?`, i.id, today);
      return [i.name, i.unit, i.category, round2(stockSummary(i.id, today).onHand), next?.e ?? '', i.reorder_level ?? '', i.shelf_life_days, i.perishable ? 'yes' : 'no'];
    }),
  ]);
}

export function salesTemplateCsv(): string {
  const dishes = db().all<{ name: string }>(`SELECT name FROM menu_items WHERE active = 1 ORDER BY name LIMIT 3`);
  const y = addDays(localDate(), -1);
  return toCsv([[...SALES_COLUMNS], ...dishes.map((d, i) => [y, d.name, 20 + i * 5])]);
}

export function inventoryTemplateCsv(): string {
  const ex = db().get<{ name: string; unit: string; category: string }>(`SELECT name, unit, category FROM ingredients WHERE active = 1 ORDER BY name LIMIT 1`);
  return toCsv([[...INVENTORY_COLUMNS], ...(ex ? [[ex.name, ex.unit, ex.category, 25, addDays(localDate(), 5), 10, '', '']] : []), ['Sushi rice', 'lb', 'Dry goods', 40, '', 15, 180, 'no']]);
}

export const ImportBody = z.object({ csv: z.string().min(1).max(1_000_000), dryRun: z.boolean().default(true) });
