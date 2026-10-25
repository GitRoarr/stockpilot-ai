import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { api, CHEF, login, setup as setupApp, type Session } from './helpers.js';

// Running the morning plan again replaces the earlier, still-unapproved orders instead of piling up duplicates (FR-070).
let app: FastifyInstance;
let chef: Session;

beforeAll(async () => {
  app = await setupApp({ llm: null });
  chef = await login(app, CHEF);
});
afterAll(async () => app.close());

const pending = () => db().all<{ id: string; supplier_id: string; status: string }>(`SELECT id, supplier_id, status FROM purchase_orders WHERE status IN ('draft','pending_approval')`);
const proposals = () => db().all<{ id: string }>(`SELECT id FROM agent_actions WHERE status = 'proposed' AND tool = 'send_purchase_order'`);

describe('re-running the morning plan', () => {
  it('cancels the earlier unapproved orders and their approval requests', async () => {
    await api(app, chef).post('/agent-runs', { kind: 'morning' });
    await drainJobs();
    const first = pending();
    expect(first.length).toBeGreaterThan(0);
    expect(proposals().length).toBe(first.length);

    await api(app, chef).post('/agent-runs', { kind: 'morning' });
    await drainJobs();
    const second = pending();
    expect(second.length).toBe(first.length);
    expect(second.map((p) => p.id).some((id) => first.some((f) => f.id === id))).toBe(false);
    expect(proposals().length).toBe(second.length);
    for (const f of first) {
      expect(db().get<{ status: string; note: string }>(`SELECT status, note FROM purchase_orders WHERE id = ?`, f.id)).toEqual({ status: 'cancelled', note: 'Superseded by a newer plan' });
    }
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_actions WHERE reject_reason = 'Superseded by a newer plan'`)!.n).toBe(first.length);
  });

  it('keeps an order a person already approved or edited', async () => {
    const [keep, edited] = pending();
    await api(app, chef).post(`/purchase-orders/${keep.id}/approve`);
    const line = db().get<{ id: string; packs: number }>(`SELECT id, packs FROM po_lines WHERE purchase_order_id = ? AND packs > 0`, edited.id)!;
    db().run(`UPDATE purchase_orders SET status = 'draft' WHERE id = ?`, edited.id);
    expect((await api(app, chef).patch(`/purchase-orders/${edited.id}/lines/${line.id}`, { packs: line.packs + 1 })).status).toBe(200);

    await api(app, chef).post('/agent-runs', { kind: 'morning' });
    await drainJobs();
    expect(db().get<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = ?`, keep.id)!.status).not.toBe('cancelled');
    expect(db().get<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = ?`, edited.id)!.status).not.toBe('cancelled');
  });
});
