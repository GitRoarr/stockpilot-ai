import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { schedulerTick } from '../src/jobs/scheduler.js';
import { setLlmClient } from '../src/agents/llm/gateway.js';
import { RecordedClient, type Recording } from '../src/agents/llm/recorded.js';
import { evaluatePolicy, currentPolicy } from '../src/agents/policy.js';
import { questionTimedOut, startRun } from '../src/agents/runtime.js';
import { startMorningRun } from '../src/agents/triggers.js';
import { refreshContext } from '../src/services/context.js';
import { getForecast, menuItems, recipeMap } from '../src/services/forecast.js';
import { computeNeeds, createPlan } from '../src/services/planning.js';
import { setFetch } from '../src/integrations/http.js';
import { addDays, localDate, setClockOffsetMs, weekday } from '../src/lib/util.js';
import { api, CHEF, login, OWNER, setup } from './helpers.js';

// Acceptance criteria asserted against their exact wording in the SRS (§8), plus untested P0 behaviours.
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  setConfig({ GEMINI_DAILY_BUDGET: 250 });
});

const nextSaturday = () => {
  const t = localDate();
  return addDays(t, ((6 - weekday(t) + 7) % 7) || 7);
};

describe('AC-029 — weather API 500 and no cache', () => {
  it('the run completes and every forecast day uses the model without weather (M3 effect = 0)', async () => {
    app = await setup({ llm: null });
    db().run(`DELETE FROM weather_days WHERE date >= ?`, localDate());
    setFetch((async () => new Response('{}', { status: 500 })) as never);
    const st = await refreshContext({ force: true });
    expect(st.weather_forecast.message).toContain('Weather unavailable — model without weather used');
    const id = startMorningRun({ trigger: 'manual' });
    await drainJobs();
    expect(db().get<{ status: string }>(`SELECT status FROM agent_runs WHERE id = ?`, id)!.status).toBe('completed');
    for (const it of getForecast(7).items) for (const d of it.daily) expect(d.effect).toBe(0);
  });
});

describe('AC-045 — needs that cannot reach a minimum', () => {
  it('lists the violated constraint and auto-drafts no PO', async () => {
    app = await setup({ llm: null });
    // Only a tiny dry-goods need: Pacific Dry Goods' $100 hard minimum cannot be reached within the overbuy cap.
    db().run(`UPDATE stock_batches SET qty = qty + 500 WHERE ingredient_id NOT IN ('ing_ketchup')`);
    const ketchup = computeNeeds().find((n) => n.ingredientId === 'ing_ketchup')!;
    db().run(`UPDATE stock_batches SET qty = ? WHERE ingredient_id = 'ing_ketchup'`, Math.max(0, ketchup.trace.demandH + ketchup.trace.safety - ketchup.trace.onOrder - 0.2));
    db().run(`UPDATE ingredients SET max_overbuy_days = 0 WHERE id = 'ing_ketchup'`);
    const plan = await createPlan({ trigger: 'test' });
    expect(plan.violations.some((v) => v.includes('Pacific Dry Goods') && v.includes('hard minimum'))).toBe(true);
    const id = startMorningRun({ trigger: 'manual' });
    await drainJobs();
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders WHERE status <> 'closed'`)!.n).toBe(0);
    const buyer = db().get<{ final_message: string }>(`SELECT final_message FROM agent_runs WHERE agent_id = 'buyer' AND parent_run_id = ?`, id)!;
    expect(buyer.final_message).toContain('Pacific Dry Goods');
    expect(buyer.final_message).toContain('no orders were drafted');
  });
});

describe('AC-055 — scheduler fires twice on the same day', () => {
  it('creates exactly one morning run and one briefing email per opted-in recipient', async () => {
    app = await setup({ llm: null });
    db().run(`UPDATE settings SET value = '2000-01-01T00:00' WHERE key = 'workspace_created'`);
    setClockOffsetMs(0);
    const morningToday = () => db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE run_key = ?`, `${localDate()}:morning`)!.n;
    // Two triggers: the scheduler tick (if it is past the run time) and a direct scheduled start.
    schedulerTick();
    startMorningRun({ trigger: 'schedule' });
    startMorningRun({ trigger: 'schedule' });
    await drainJobs();
    expect(morningToday()).toBe(1);
    const mails = db().all<{ to_email: string }>(`SELECT to_email FROM email_messages WHERE kind = 'briefing'`);
    const recipients = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role IN ('owner','chef') AND briefing_opt_in = 1`)!.n;
    expect(mails).toHaveLength(recipients);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM briefings`)!.n).toBe(1);
  });
});

describe('AC-057 — "Private party of 40 on Saturday, mostly burgers" with a recorded model response', () => {
  it('creates a demand-event proposal; after approval the Saturday forecast and the reorder needs change accordingly', async () => {
    const sat = nextSaturday();
    const rec: Recording[] = [
      { kind: 'chat', agent: 'Pilot', calls: [{ name: 'delegate_task', args: { agent: 'demand-planner', goal: 'Private party of 40 on Saturday, mostly burgers' } }] },
      { kind: 'chat', agent: 'Demand Planner', calls: [{ name: 'add_demand_event', args: { date: sat, description: 'Private party of 40', extraCovers: 40, items: [{ menuItem: 'Classic Burger', qty: 14 }, { menuItem: 'Bacon Cheeseburger', qty: 14 }] } }] },
      { kind: 'chat', agent: 'Demand Planner', text: 'The party is proposed for approval.' },
      { kind: 'chat', agent: 'Pilot', text: 'Demand Planner proposed the event; it needs your approval.' },
    ];
    app = await setup({ llm: new RecordedClient(rec) });
    const chef = await login(app, CHEF);
    const fcBefore = getForecast(14);
    const needsBefore = new Map(computeNeeds().map((n) => [n.ingredientId, n.trace]));
    await api(app, chef).post('/team/messages', { body: 'Private party of 40 on Saturday, mostly burgers' });
    await drainJobs();
    const p = (await api(app, chef).get('/inbox')).body.proposals.find((x: any) => x.tool === 'add_demand_event');
    expect(p.summary).toContain(sat);
    expect((await api(app, chef).post(`/actions/${p.id}/approve`)).status).toBe(200);

    const burgerOn = (f: ReturnType<typeof getForecast>, name: string) => f.items.find((i) => i.name === name)!.daily.find((d) => d.date === sat)!.value;
    const fcAfter = getForecast(14);
    expect(burgerOn(fcAfter, 'Classic Burger') - burgerOn(fcBefore, 'Classic Burger')).toBeGreaterThanOrEqual(14);
    expect(burgerOn(fcAfter, 'Bacon Cheeseburger') - burgerOn(fcBefore, 'Bacon Cheeseburger')).toBeGreaterThanOrEqual(14);

    // Needs change exactly for ingredients whose coverage horizon (tomorrow … tomorrow + H − 1) includes Saturday.
    const recipe = recipeMap();
    const extraByDish = new Map(menuItems().map((m) => [m.id, burgerOn(fcAfter, m.name) - burgerOn(fcBefore, m.name)]));
    const tomorrow = addDays(localDate(), 1);
    let changed = 0;
    for (const n of computeNeeds()) {
      const before = needsBefore.get(n.ingredientId)!;
      const inWindow = sat >= tomorrow && sat <= addDays(tomorrow, n.trace.H - 1);
      const expected = [...extraByDish].reduce((s, [dish, extra]) => s + extra * (recipe.get(dish)?.get(n.ingredientId) ?? 0), 0);
      if (inWindow && expected > 0) {
        // demandH is reported to 0.1, so the change matches the event's extra demand within that rounding.
        expect(Math.abs(n.trace.demandH - before.demandH - expected)).toBeLessThanOrEqual(0.1 + 1e-9);
        if (expected >= 0.1) changed++;
      } else {
        expect(n.trace.demandH).toBe(before.demandH);
      }
    }
    expect(changed).toBeGreaterThan(0); // dry goods have an 8-day horizon, so Saturday is always inside one
  });
});

describe('AC-062 — fallback model and daily budget', () => {
  it('records the fallback model on a 404; with the budget exhausted no call is made', async () => {
    const rec = new RecordedClient([{ kind: 'error', model: 'gemini-3.8-flash', status: 404 }, { kind: 'chat', model: 'gemini-3.5-flash-lite', text: 'Hello.' }]);
    app = await setup({ llm: rec });
    const a = startRun({ agentId: 'pilot', goal: 'hello', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(db().get<{ model: string }>(`SELECT model FROM agent_runs WHERE id = ?`, a)!.model).toBe('gemini-3.5-flash-lite');
    const calls = rec.requests.length;
    setConfig({ GEMINI_DAILY_BUDGET: 1 });
    const b = startRun({ agentId: 'pilot', goal: 'again', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(rec.requests.length).toBe(calls);
    expect(db().get<{ fallback_reason: string }>(`SELECT fallback_reason FROM agent_runs WHERE id = ?`, b)!.fallback_reason).toBe('budget_exhausted');
  });
});

describe('AC-076 — the documented 8.0 lb shortfall (need 38.0 − 30)', () => {
  it('replans 8.0 lb without Golden Gate chicken → Bay Meat 1 × 10 lb $34.00 + $15.00 = $49.00, requiring approval', async () => {
    app = await setup({ llm: null });
    const chef = await login(app, CHEF);
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const gg = db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE supplier_id = 'sup_gg' AND status = 'pending_approval'`)!.id;
    db().run(`UPDATE po_lines SET need = 38.0 WHERE purchase_order_id = ? AND ingredient_id = 'ing_thigh'`, gg);
    const p = (await api(app, chef).get('/inbox')).body.proposals.find((x: any) => x.args.poId === gg);
    await api(app, chef).post(`/actions/${p.id}/approve`);
    await drainJobs();
    const tok = db().get<{ text: string }>(`SELECT text FROM email_messages WHERE related_id = ?`, gg)!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1];
    const view = (await app.inject({ method: 'GET', url: `/api/portal/${tok}` })).json();
    const lines = view.lines.map((l: any) => (l.sku === 'GG-23310' ? { poLineId: l.id, action: 'reduce', qty: 30 } : { poLineId: l.id, action: 'confirm' }));
    expect((await app.inject({ method: 'POST', url: `/api/portal/${tok}/response`, payload: { lines } })).json().shortages[0].shortfall).toBe(8);
    await drainJobs();
    expect(db().get(`SELECT 1 FROM audit_events WHERE action = 'supplier.responded' AND entity_id = ?`, gg)).toBeTruthy();
    const plan = db().get<{ needs_json: string; solution_json: string }>(`SELECT needs_json, solution_json FROM plans WHERE trigger LIKE 'shortage:%'`)!;
    expect(JSON.parse(plan.needs_json).input).toEqual([expect.objectContaining({ ingredientId: 'ing_thigh', need: 8 })]);
    expect(JSON.parse(plan.solution_json).lines.some((l: any) => l.offerId === 'off_gg-23310')).toBe(false);
    const bay = (await api(app, chef).get('/inbox')).body.proposals.find((x: any) => x.purchaseOrder?.supplier === 'Bay Meat Supply');
    expect(bay.lines).toEqual([expect.objectContaining({ packs: 1, packSize: 10, lineTotal: 34 })]);
    expect(bay.purchaseOrder.total).toBe(49);
    expect(bay.canDecide).toBe(true);
  });
});

describe('AC-110 / AC-114 — hire the team, then the first morning run', () => {
  it('a freshly deployed team can run its first morning run; each delegated child task links its run trace', async () => {
    app = await setup({ llm: null, seed: false });
    const { hashPassword } = await import('../src/auth/password.js');
    db().run(`INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES ('usr_o','Sara','sara@harborvine.example','owner',?,?)`, await hashPassword('stockpilot-demo'), new Date().toISOString());
    const owner = await login(app, OWNER);
    expect((await api(app, owner).post('/templates/restaurant-purchasing-team/deploy', {})).status).toBe(200);
    const r = await api(app, owner).post('/agent-runs', { kind: 'morning' });
    expect(r.status).toBe(200);
    await drainJobs();
    const run = (await api(app, owner).get(`/agent-runs/${r.body.runId}`)).body;
    expect(run.status).toBe('completed');
    const task = (await api(app, owner).get(`/tasks/${run.taskId}`)).body;
    expect(task.children).toHaveLength(2);
    for (const c of task.children) {
      const child = (await api(app, owner).get(`/tasks/${c.id}`)).body;
      expect(child.runs).toHaveLength(1);
      expect(child.runs[0].status).toBe('completed');
    }
    expect(task.status).toBe('done');
  });
});

describe('AC-115 — @Buyer in a thread: any PO change is a proposal within the Chef\'s approval limit', () => {
  it('a small change needs Chef approval; a change above $1,500 needs the Owner', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const chef = await login(app, CHEF);
    // Put the Golden Gate PO back to draft so its lines can be changed.
    const p = (await api(app, chef).get('/inbox')).body.proposals.find((x: any) => x.purchaseOrder?.supplier === 'Golden Gate Foodservice');
    await api(app, chef).post(`/actions/${p.id}/reject`, { reason: 'Let Buyer adjust first' });
    const po = p.args.poId;
    const line = db().get<{ id: string }>(`SELECT id FROM po_lines WHERE purchase_order_id = ? AND ingredient_id = 'ing_fries'`, po)!.id;
    setLlmClient(
      new RecordedClient([
        { kind: 'chat', agent: 'Buyer', calls: [{ name: 'propose_po_change', args: { poId: po, lineId: line, packs: 3, reason: 'Weekend is busy' } }] },
        { kind: 'chat', agent: 'Buyer', calls: [{ name: 'propose_po_change', args: { poId: po, lineId: line, packs: 60, reason: 'Stock up for the month' } }] },
        { kind: 'chat', agent: 'Buyer', text: 'Both changes are proposals for you to approve.' },
      ]),
    );
    await api(app, chef).post('/threads/purchase_order/' + po + '/messages', { body: '@Buyer adjust the fries' });
    await drainJobs();
    const acts = db().all<{ required_role: string; status: string; summary: string }>(`SELECT required_role, status, summary FROM agent_actions WHERE tool = 'propose_po_change' ORDER BY created_at`);
    expect(acts.map((a) => [a.status, a.required_role])).toEqual([
      ['proposed', 'chef'],
      ['proposed', 'owner'],
    ]);
    expect(db().get<{ packs: number }>(`SELECT packs FROM po_lines WHERE id = ?`, line)!.packs).toBe(2); // nothing changed without approval
    const r = evaluatePolicy({ agentTools: ['propose_po_change'], policy: currentPolicy(), externalText: false, humanRole: 'chef' }, 'propose_po_change', 'propose_po_change', { total: 1800 });
    expect(r).toMatchObject({ decision: 'requires_approval', requiredRole: 'owner' });
  });
});

describe('AC-119 — property: after the agreement, fish is never assigned to Golden Gate', () => {
  it('holds for random fish needs and prices, and the agreement shows its origin', async () => {
    app = await setup({ llm: null });
    const owner = await login(app, OWNER);
    for (let i = 0; i < 2; i++) {
      db().run(`INSERT INTO agent_actions (id, agent_id, tool, args_json, summary, policy_decision, decided_by_rule, status, idempotency_key, created_at) VALUES (?, 'buyer', 'draft_purchase_orders', '{}', 'fish', 'requires_approval', 'policy_level', 'proposed', ?, ?)`, `a${i}`, `k${i}`, new Date().toISOString());
      await api(app, owner).post(`/actions/a${i}/reject`, { reason: 'No fish from Golden Gate', tags: { supplierId: 'sup_gg', category: 'fish' } });
    }
    const ag = (await api(app, owner).get('/agreements')).body[0];
    expect(ag).toMatchObject({ type: 'exclude_supplier', agentId: 'buyer', params: { supplierId: 'sup_gg', category: 'fish' } });
    expect(ag.evidence.map((e: any) => e.id)).toEqual(['rejected:a0', 'rejected:a1']);
    await api(app, owner).post(`/agreements/${ag.id}/approve`);
    await fc.assert(
      fc.asyncProperty(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0.5, max: 0.99, noNaN: true }), async (s1, s2, discount) => {
        db().run(`UPDATE stock_batches SET qty = ? WHERE ingredient_id = 'ing_salmon'`, s1 * 6);
        db().run(`UPDATE stock_batches SET qty = ? WHERE ingredient_id = 'ing_rockfish'`, s2 * 6);
        // Make Golden Gate's fish much cheaper — the agreement must still win.
        db().run(`UPDATE supplier_offers SET unit_price = ROUND(? * 9.6, 2) WHERE id = 'off_gg-50330'`, discount);
        db().run(`UPDATE supplier_offers SET unit_price = ROUND(? * 12.4, 2) WHERE id = 'off_gg-50210'`, discount);
        const plan = await createPlan({ trigger: 'property' });
        return plan.solution.lines.every((l) => !(l.supplierId === 'sup_gg' && ['ing_salmon', 'ing_rockfish'].includes(l.ingredientId)));
      }),
      { numRuns: 25 },
    );
  });

  it('rejects an agreement that would remove the last offer of an ingredient (FR-119 conflict check)', async () => {
    app = await setup({ llm: null });
    const owner = await login(app, OWNER);
    const { proposeAgreement } = await import('../src/services/agreements.js');
    const ag = proposeAgreement('buyer', { type: 'exclude_supplier', params: { supplierId: 'sup_gg', ingredientId: 'ing_fries' } }, 'test', []);
    const r = await api(app, owner).post(`/agreements/${ag.id}/approve`);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('last offer');
  });
});

describe('AC-120 — every scorecard metric equals the hand calculation', () => {
  it('computes all metrics for one week of fixture data; estimates are separate', async () => {
    app = await setup({ llm: null, seed: false });
    const { deployTemplate } = await import('../src/services/onboarding.js');
    const { computeScorecard } = await import('../src/services/scorecards.js');
    deployTemplate({}, { type: 'system' });
    db().run(`INSERT INTO suppliers (id, name, email) VALUES ('sup_gg', 'Golden Gate Foodservice', 'gg@x.example')`);
    db().run(`INSERT INTO ingredients (id, name, unit, category) VALUES ('ing_fries', 'Fries', 'lb', 'frozen')`);
    db().run(`INSERT INTO supplier_offers (id, supplier_id, ingredient_id, sku, pack_size, unit_price) VALUES ('off_gg-81002', 'sup_gg', 'ing_fries', 'GG-81002', 30, 1.1)`);
    const at = (d: number, m: number) => new Date(Date.UTC(2026, 9, 19 + d, 10, m)).toISOString();
    // 3 done tasks; runs of 2, 4 and 6 minutes (one deterministic); median 4.
    for (const [i, mins] of [2, 4, 6].entries()) {
      db().run(`INSERT INTO tasks (id, title, assignee_type, assignee_id, status, created_by_type, created_at, updated_at) VALUES (?, 't', 'agent', 'buyer', 'done', 'system', ?, ?)`, `t${i}`, at(i, 0), at(i, mins));
      db().run(`INSERT INTO agent_runs (id, agent_id, trigger, goal, authority_role, status, mode, started_at, ended_at) VALUES (?, 'buyer', 'event', 'g', 'system', 'completed', ?, ?, ?)`, `r${i}`, i === 2 ? 'deterministic' : 'ai', at(i, 0), at(i, mins));
    }
    db().run(`INSERT INTO agent_runs (id, agent_id, trigger, goal, authority_role, status, started_at) VALUES ('r9', 'buyer', 'event', 'g', 'system', 'budget_exhausted', ?)`, at(3, 0));
    // Two agent POs approved in the week, one with a user-edited line → approval-without-edit rate 0.5.
    for (const [i, edited] of [0, 1].entries()) {
      db().run(`INSERT INTO purchase_orders (id, number, supplier_id, status, created_by_type, approved_at, created_at, updated_at) VALUES (?, ?, 'sup_gg', 'approved', 'agent', ?, ?, ?)`, `p${i}`, `PO-${i}`, at(1, 0), at(1, 0), at(1, 0));
      db().run(`INSERT INTO po_lines (id, purchase_order_id, offer_id, ingredient_id, packs, pack_size, qty, unit_price, line_total, edited_by_user) VALUES (?, ?, 'off_gg-81002', 'ing_fries', 1, 30, 30, 1.1, 33, ?)`, `l${i}`, `p${i}`, edited);
    }
    db().run(`INSERT INTO ledger_entries (id, type, amount, verified, source_type, source_id, method, agent_id, created_at) VALUES ('e1','optimiser_saving',18.48,1,'purchase_order','p0','m','buyer',?)`, at(1, 5));
    db().run(`INSERT INTO ledger_entries (id, type, amount, verified, source_type, source_id, method, agent_id, created_at) VALUES ('e2','credit_recovered',42.10,1,'dispute','d1','m','ap-clerk',?)`, at(2, 5));
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, deadline, status, created_at) VALUES ('q1','r0','buyer','?','[]','x','escalated',?)`, at(0, 1));
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, deadline, status, created_at) VALUES ('q2','r1','buyer','?','[]','x','answered',?)`, at(1, 1));
    for (const i of [1, 2, 3]) db().run(`INSERT INTO model_calls (id, at, model, purpose, outcome) VALUES (?, ?, 'm', 'agent:buyer', 'ok')`, `mc${i}`, at(i, 0));
    // An action executed without the approval policy required — a violation the scorecard must count.
    db().run(`INSERT INTO agent_actions (id, agent_id, tool, args_json, summary, policy_decision, decided_by_rule, status, idempotency_key, created_at) VALUES ('v1','buyer','send_purchase_order','{}','x','requires_approval','policy_level','executed','v1',?)`, at(2, 0));

    const sc = computeScorecard('buyer', '2026-10-19', '2026-10-25');
    expect(sc.metrics).toEqual({
      tasksCompleted: 3,
      medianResolutionMinutes: 4,
      verifiedSavingsUsd: 18.48,
      approvalWithoutEditRate: 0.5,
      questionsAsked: 2,
      escalations: 2, // one escalated question + one budget-exhausted run
      policyViolations: 1,
      modelCalls: 3,
      fallbackRuns: 1,
    });
    expect(sc.estimates).toEqual({ humanHoursReplaced: 0.6, method: expect.stringContaining('[Assumption] 12 minutes') });
    expect(computeScorecard('ap-clerk', '2026-10-19', '2026-10-25').metrics.variancesRecoveredUsd).toBe(42.1);
  });
});

describe('FR-117 — question timeout', () => {
  it('escalates when the pending action is not "auto"; uses the recommended answer when it is', async () => {
    app = await setup({ llm: null });
    const now = new Date().toISOString();
    db().run(`INSERT INTO agent_runs (id, agent_id, trigger, goal, authority_role, status, policy_json, started_at) VALUES ('rq','buyer','event','q','system','waiting_for_human',?,?)`, JSON.stringify(currentPolicy()), now);
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, recommended, deadline, action_type, status, created_at) VALUES ('q1','rq','buyer','Accept substitute?','["Yes","No"]','No',?, 'accept_substitution','open',?)`, now, now);
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, recommended, deadline, action_type, status, created_at) VALUES ('q2','rq','buyer','Send a follow-up?','["Yes","No"]','Yes',?, 'send_supplier_followup','open',?)`, now, now);
    questionTimedOut('q1');
    questionTimedOut('q2');
    expect(db().get<any>(`SELECT status, answer FROM questions WHERE id = 'q1'`)).toEqual({ status: 'escalated', answer: null });
    expect(db().get<any>(`SELECT status, answer FROM questions WHERE id = 'q2'`)).toEqual({ status: 'timed_out', answer: 'Yes' });
    expect(db().get(`SELECT 1 FROM notifications WHERE kind = 'escalation'`)).toBeTruthy();
  });
});

describe('FR-078 — invalid PO transitions return 409', () => {
  it('cannot cancel a sent PO, re-approve an approved one, or edit lines after approval', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const owner = await login(app, OWNER);
    const po = db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE supplier_id = 'sup_gg' AND status = 'pending_approval'`)!.id;
    expect((await api(app, owner).post(`/purchase-orders/${po}/approve`)).status).toBe(200);
    expect((await api(app, owner).post(`/purchase-orders/${po}/approve`)).status).toBe(409);
    const line = db().get<{ id: string }>(`SELECT id FROM po_lines WHERE purchase_order_id = ?`, po)!.id;
    expect((await api(app, owner).patch(`/purchase-orders/${po}/lines/${line}`, { packs: 9 })).status).toBe(409);
    await api(app, owner).post(`/purchase-orders/${po}/send`);
    await drainJobs();
    expect((await api(app, owner).post(`/purchase-orders/${po}/cancel`)).status).toBe(409);
  });
});

describe('NFR-PERF-1 / NFR-PERF-2 — performance targets (laptop)', () => {
  it('backtest 14 items × 180 days < 3 s, optimiser < 2 s, dashboard API < 300 ms', async () => {
    app = await setup({ llm: null });
    const owner = await login(app, OWNER);
    const { fitModels } = await import('../src/services/forecast.js');
    let t = Date.now();
    fitModels();
    expect(Date.now() - t).toBeLessThan(3000);
    t = Date.now();
    const plan = await createPlan({ trigger: 'perf' });
    expect(plan.method).toBe('milp');
    expect(Date.now() - t).toBeLessThan(2000);
    await api(app, owner).get('/dashboard'); // warm
    t = Date.now();
    expect((await api(app, owner).get('/dashboard')).status).toBe(200);
    expect(Date.now() - t).toBeLessThan(300);
  });
});
