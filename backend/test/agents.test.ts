import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { setLlmClient } from '../src/agents/llm/gateway.js';
import { RecordedClient, type Recording } from '../src/agents/llm/recorded.js';
import { parseManifest } from '../src/agents/manifest.js';
import { evaluatePolicy, currentPolicy } from '../src/agents/policy.js';
import { startRun } from '../src/agents/runtime.js';
import { startMorningRun } from '../src/agents/triggers.js';
import { buildFacts, generateBriefing } from '../src/agents/briefing.js';
import { computeScorecard } from '../src/services/scorecards.js';
import { api, CHEF, login, OWNER, setup } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  setConfig({ GEMINI_DAILY_BUDGET: 250, GEMINI_API_KEY: undefined });
});

const run = (id: string) => db().get<any>(`SELECT * FROM agent_runs WHERE id = ?`, id);
const toolResults = (id: string) =>
  db()
    .all<{ tool_results_json: string | null }>(`SELECT tool_results_json FROM agent_steps WHERE run_id = ? AND kind = 'tools' ORDER BY step_no`, id)
    .flatMap((s) => JSON.parse(s.tool_results_json ?? '[]'));

/** Recorded morning run in AI mode (Solution Design §D3.6). */
const MORNING: Recording[] = [
  { kind: 'chat', agent: 'Pilot', calls: [{ name: 'get_team_status', args: {} }, { name: 'get_inventory_status', args: {} }] },
  { kind: 'chat', agent: 'Pilot', calls: [{ name: 'delegate_task', args: { agent: 'demand-planner', goal: 'Refresh context and forecast the next 7 days' } }] },
  { kind: 'chat', agent: 'Demand Planner', calls: [{ name: 'refresh_context', args: {} }, { name: 'get_forecast', args: { days: 7 } }] },
  { kind: 'chat', agent: 'Demand Planner', text: 'Forecast is ready; weather is unavailable so the model without weather was used.' },
  { kind: 'chat', agent: 'Pilot', calls: [{ name: 'delegate_task', args: { agent: 'buyer', goal: "Plan and draft today's orders" } }] },
  { kind: 'chat', agent: 'Buyer', calls: [{ name: 'get_reorder_plan', args: {} }] },
  { kind: 'chat', agent: 'Buyer', calls: [{ name: 'optimize_order', args: { scope: 'all' } }] },
  { kind: 'chat', agent: 'Buyer', calls: [{ name: 'draft_purchase_orders', args: { planId: '{{optimize_order.planId}}' } }] },
  { kind: 'chat', agent: 'Buyer', calls: [{ name: 'send_purchase_order', forEach: 'draft_purchase_orders.purchaseOrders', args: { poId: '{{item.poId}}' } }] },
  { kind: 'chat', agent: 'Buyer', text: 'Orders drafted with the optimiser; sending them needs your approval.' },
  { kind: 'chat', agent: 'Pilot', calls: [{ name: 'publish_briefing', args: {} }] },
  {
    kind: 'structured',
    json: { summary: 'Orders are drafted and waiting for approval in the Inbox.', agents: [{ agentId: 'buyer', done: [{ text: 'Drafted optimised orders' }], today: [], needsYou: [{ text: 'Approve the orders' }] }], wasteReductionIdeas: [], risks: [], confidence: 'high' },
  },
  { kind: 'chat', agent: 'Pilot', text: 'Morning run complete — the standup is published.' },
];

function poSnapshot() {
  return db()
    .all<{ supplier_id: string; sku: string; packs: number; total: number }>(`SELECT p.supplier_id, o.sku, l.packs, p.total FROM po_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id JOIN supplier_offers o ON o.id = l.offer_id WHERE p.status <> 'closed' AND p.status <> 'cancelled' ORDER BY o.sku`)
    .map((r) => `${r.supplier_id}:${r.sku}:${r.packs}:${r.total}`);
}

describe('AI morning run (recorded) vs deterministic pipeline (AC-061, AC-114)', () => {
  it('drafts identical POs with and without the model', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const deterministic = poSnapshot();
    await app.close();

    const rec = new RecordedClient(structuredClone(MORNING));
    app = await setup({ llm: rec });
    const id = startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const r = run(id);
    expect(r.mode).toBe('ai');
    expect(r.status).toBe('completed');
    expect(r.model).toBe('gemini-3.8-flash');
    expect(rec.remaining()).toBe(0);
    expect(poSnapshot()).toEqual(deterministic);
    expect(db().get<{ mode: string }>(`SELECT mode FROM briefings ORDER BY created_at DESC LIMIT 1`)!.mode).toBe('ai');
    // Delegation is visible as child tasks of the morning task.
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?`, r.task_id)!.n).toBe(2);
    // Tools are sent to Gemini as declarations generated from the Zod schemas.
    const decl = (rec.requests[0].req as any).tools.find((t: any) => t.name === 'get_team_status');
    expect(decl.parameters.type).toBe('object');
  });
});

describe('runtime guards with recorded responses', () => {
  it('invalid tool arguments return a structured error and consume budget (AC-050)', async () => {
    app = await setup({ llm: new RecordedClient([{ kind: 'chat', calls: [{ name: 'optimize_order', args: { scope: 'everything' } }] }, { kind: 'chat', text: 'I could not run that.' }]) });
    const id = startRun({ agentId: 'buyer', goal: 'test', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    const res = toolResults(id);
    expect(res[0].result.error).toBe('validation_error');
    expect(run(id).tool_calls_used).toBe(1);
    expect(run(id).steps_used).toBe(2);
    expect(db().get(`SELECT 1 FROM plans`)).toBeUndefined();
  });

  it('stops after 12 tool calls with budget_exhausted and creates nothing more (AC-052)', async () => {
    const many = Array.from({ length: 7 }, () => ({ name: 'get_reorder_plan', args: {} }));
    app = await setup({ llm: new RecordedClient([{ kind: 'chat', calls: many }, { kind: 'chat', calls: [...many, { name: 'draft_purchase_orders', args: { planId: 'x' } }] }, { kind: 'chat', text: 'never reached' }]) });
    const id = startRun({ agentId: 'buyer', goal: 'loop', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(run(id).status).toBe('budget_exhausted');
    expect(db().get(`SELECT 1 FROM agent_actions WHERE run_id = ?`, id)).toBeUndefined();
    expect(toolResults(id).filter((r: any) => r.result?.error === 'budget_exhausted').length).toBe(3);
  });

  it('tools outside the manifest are refused: AP Clerk cannot send a PO (AC-111)', async () => {
    app = await setup({ llm: new RecordedClient([{ kind: 'chat', calls: [{ name: 'send_purchase_order', args: { poId: 'po_x' } }] }, { kind: 'chat', text: 'ok' }]) });
    const id = startRun({ agentId: 'ap-clerk', goal: 'try', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(toolResults(id)[0].result.error).toBe('tool_not_permitted');
    expect(db().get(`SELECT 1 FROM agent_actions WHERE run_id = ?`, id)).toBeUndefined();
  });

  it('policy approve → proposal and no email; never → forbidden_by_policy (AC-053)', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const po = db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE status = 'pending_approval' LIMIT 1`)!;
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM email_messages WHERE kind = 'po'`)!.n).toBe(0);
    expect(db().get(`SELECT 1 FROM agent_actions WHERE tool = 'send_purchase_order' AND status = 'proposed' AND json_extract(args_json,'$.poId') = ?`, po.id)).toBeTruthy();
    db().run(`UPDATE autonomy_policy SET level = 'never' WHERE action = 'send_purchase_order'`);
    setLlmClient(new RecordedClient([{ kind: 'chat', calls: [{ name: 'send_purchase_order', args: { poId: po.id } }] }, { kind: 'chat', text: 'Not allowed.' }]));
    const id = startRun({ agentId: 'buyer', goal: 'send it', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(toolResults(id)[0].result.error).toBe('forbidden_by_policy');
  });

  it('falls back to the second model on 404 and records it; budget exhausted → deterministic (AC-062)', async () => {
    app = await setup({ llm: new RecordedClient([{ kind: 'error', model: 'gemini-3.8-flash', status: 404 }, { kind: 'chat', model: 'gemini-3.5-flash-lite', text: 'Hello from the fallback model.' }]) });
    const id = startRun({ agentId: 'pilot', goal: 'say hello', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(run(id).model).toBe('gemini-3.5-flash-lite');
    expect(run(id).mode).toBe('ai');
    setConfig({ GEMINI_DAILY_BUDGET: 1 });
    const id2 = startRun({ agentId: 'pilot', goal: 'again', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(run(id2).mode).toBe('deterministic');
    expect(run(id2).fallback_reason).toBe('budget_exhausted');
  });

  it('a model failure mid-run switches to the deterministic pipeline and finishes the workflow (FR-061)', async () => {
    app = await setup({ llm: new RecordedClient([{ kind: 'chat', agent: 'Buyer', calls: [{ name: 'get_reorder_plan', args: {} }] }, { kind: 'error', status: 500 }, { kind: 'error', status: 500 }, { kind: 'error', status: 500 }]) });
    const id = startRun({ agentId: 'buyer', goal: "Plan and draft today's orders", trigger: 'delegated', playbook: 'buy' });
    await drainJobs();
    expect(run(id).status).toBe('completed');
    expect(run(id).fallback_reason).toBe('model_error');
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'pending_approval'`)!.n).toBeGreaterThan(0);
  });

  it('ungrounded numbers in a final message are sent back for a rewrite', async () => {
    app = await setup({ llm: new RecordedClient([{ kind: 'chat', calls: [{ name: 'get_savings_summary', args: {} }] }, { kind: 'chat', text: 'We saved $9,999.00 this month!' }, { kind: 'chat', text: 'Savings are in the ledger.' }]) });
    const id = startRun({ agentId: 'pilot', goal: 'how much did we save', trigger: 'assignment', playbook: 'chat' });
    await drainJobs();
    expect(run(id).final_message).toBe('Savings are in the ledger.');
  });
});

describe('briefing grounding (AC-056, AC-121)', () => {
  it('a briefing with a number not in the facts is retried once, then replaced by the rule-based one', async () => {
    const bad = { summary: 'We saved $999.99 today across 77 orders.', agents: [{ agentId: 'pilot', done: [], today: [], needsYou: [] }], wasteReductionIdeas: [], risks: [], confidence: 'high' };
    const rec = new RecordedClient([{ kind: 'structured', json: bad }, { kind: 'structured', json: bad }]);
    app = await setup({ llm: rec });
    const out = await generateBriefing(buildFacts(new Date(0).toISOString()), true);
    expect(rec.requests.filter((r) => r.type === 'structured')).toHaveLength(2);
    expect(out.mode).toBe('rule_based');
    expect(out.reason).toBe('validation_failed');
  });

  it('pending questions appear under "Needs you" for the responsible agent', async () => {
    app = await setup({ llm: null });
    db().run(`INSERT INTO agent_runs (id, agent_id, trigger, goal, authority_role, status, started_at) VALUES ('run_q','buyer','event','q','system','waiting_for_human',?)`, new Date().toISOString());
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, recommended, deadline, status, created_at) VALUES ('q1','run_q','buyer','Accept organic romaine?','["Yes","No"]','No','2999-01-01','open',?)`, new Date().toISOString());
    const out = await generateBriefing(buildFacts(new Date(0).toISOString()), false);
    const buyer = out.briefing.agents.find((a) => a.agentId === 'buyer')!;
    expect(buyer.needsYou.some((n) => n.refType === 'question' && n.refId === 'q1')).toBe(true);
  });
});

describe('auto-send rule (AC-066)', () => {
  it('sends a trusted supplier PO within limit and usual size without approval; others stay proposals', async () => {
    app = await setup({ llm: null });
    const owner = await login(app, OWNER);
    await api(app, owner).put('/policy', { autoSend: { enabled: true, maxTotal: 500, maxDeviationPct: 20 } });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const gg = db().get<any>(`SELECT * FROM purchase_orders WHERE supplier_id = 'sup_gg' AND status <> 'closed'`)!;
    expect(gg.total).toBe(366.92);
    expect(gg.status).toBe('sent');
    expect(db().get<any>(`SELECT decided_by_rule, status FROM agent_actions WHERE tool = 'send_purchase_order' AND json_extract(args_json,'$.poId') = ?`, gg.id)).toMatchObject({ decided_by_rule: 'auto_send_rule', status: 'executed' });
    const other = db().get<any>(`SELECT * FROM purchase_orders WHERE supplier_id = 'sup_mission' AND status <> 'closed'`)!;
    expect(other.status).toBe('pending_approval');
  });

  it('a $620 PO becomes a proposal', () => {
    const r = evaluatePolicy(
      { agentTools: ['send_purchase_order'], policy: { ...currentPolicy(), levels: { send_purchase_order: 'approve' }, autoSend: { enabled: true, maxTotal: 500, maxDeviationPct: 20 }, chefApprovalLimit: 1500 }, externalText: false, humanRole: null },
      'send_purchase_order',
      'send_purchase_order',
      { total: 620, supplierTrusted: true, supplierAverage: 600 },
    );
    expect(r.decision).toBe('requires_approval');
    expect(r.rule).toBe('auto_send_rule');
  });
});

describe('hire from template (AC-110)', () => {
  it('deploys four agents, the policy, the 06:00 schedule and onboarding tasks into an empty workspace', async () => {
    app = await setup({ llm: null, seed: false });
    const { hashPassword } = await import('../src/auth/password.js');
    db().run(`INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES ('usr_o','O','sara@harborvine.com','owner',?,?)`, await hashPassword('harborvine2026'), new Date().toISOString());
    const owner = await login(app, OWNER);
    const r = await api(app, owner).post('/templates/restaurant-purchasing-team/deploy', { autonomy: { preset: 'balanced', chefApprovalLimit: 1500 }, schedule: { morningRunTime: '06:00' } });
    expect(r.status).toBe(200);
    expect(r.body.agents).toEqual(['pilot', 'demand-planner', 'buyer', 'ap-clerk']);
    expect(r.body.morningRunTime).toBe('06:00');
    expect(r.body.onboardingTasks).toHaveLength(5);
    expect(db().get<{ level: string }>(`SELECT level FROM autonomy_policy WHERE action = 'send_purchase_order'`)!.level).toBe('approve');
  });
  it('rejects a manifest that lists an unknown tool', () => {
    expect(() => parseManifest({ id: 'x', version: 1, displayName: 'X', role: 'A test agent role', responsibilities: ['a'], tools: ['launch_rockets'], triggers: ['mention'], escalateTo: 'pilot', kpis: [], budgets: { maxSteps: 8, maxToolCalls: 12, maxSeconds: 90 } })).toThrow();
  });
});

describe('@mention (AC-115)', () => {
  it('"@Buyer find a cheaper supplier for chicken thigh" starts a Buyer run in the thread that cites the optimiser', async () => {
    app = await setup({ llm: null });
    const chef = await login(app, CHEF);
    const r = await api(app, chef).post('/threads/ingredient/ing_thigh/messages', { body: '@Buyer find a cheaper supplier for chicken thigh' });
    expect(r.status).toBe(200);
    await drainJobs();
    const t = (await api(app, chef).get('/threads/ingredient/ing_thigh')).body;
    const reply = t.messages.find((m: any) => m.authorType === 'agent' && m.authorId === 'buyer');
    expect(reply.body).toContain("Optimiser result for today's order: Golden Gate Foodservice");
    expect(reply.body).toContain('$0.15/unit cheaper');
    const runRow = db().get<any>(`SELECT * FROM agent_runs WHERE trigger = 'mention'`);
    expect(runRow.authority_role).toBe('chef');
    expect(runRow.thread_id).toBe(t.threadId);
  });
});

describe('scorecards (AC-120)', () => {
  it('computes metrics from fixture data and keeps estimates separate', async () => {
    app = await setup({ llm: null, seed: false });
    const { deployTemplate } = await import('../src/services/onboarding.js');
    deployTemplate({}, { type: 'system' });
    const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 10, m)).toISOString();
    for (const [i, mins] of [2, 4, 6].entries()) {
      db().run(`INSERT INTO tasks (id, title, assignee_type, assignee_id, status, created_by_type, created_at, updated_at) VALUES (?, 't', 'agent', 'buyer', 'done', 'system', ?, ?)`, `t${i}`, at(0), at(mins));
      db().run(`INSERT INTO agent_runs (id, agent_id, trigger, goal, authority_role, status, started_at, ended_at) VALUES (?, 'buyer', 'event', 'g', 'system', 'completed', ?, ?)`, `r${i}`, at(0), at(mins));
    }
    db().run(`INSERT INTO ledger_entries (id, type, amount, verified, source_type, source_id, method, agent_id, created_at) VALUES ('l1','optimiser_saving',18.48,1,'purchase_order','p1','m','buyer',?)`, at(5));
    db().run(`INSERT INTO questions (id, run_id, agent_id, text, options_json, deadline, status, created_at) VALUES ('q1','r0','buyer','?','[]','x','escalated',?)`, at(1));
    const sc = computeScorecard('buyer', '2026-10-19', '2026-10-25');
    expect(sc.metrics).toMatchObject({ tasksCompleted: 3, medianResolutionMinutes: 4, verifiedSavingsUsd: 18.48, questionsAsked: 1, escalations: 1, policyViolations: 0 });
    expect(sc.estimates.humanHoursReplaced).toBe(0.6);
    expect(sc.estimates.method).toContain('[Assumption]');
  });
});

describe('run trace', () => {
  it('keeps both the model turn and its tool results for every step (FR-060)', async () => {
    app = await setup({ llm: null });
    const id = startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const kinds = db().all<{ step_no: number; kind: string }>(`SELECT step_no, kind FROM agent_steps WHERE run_id = ? ORDER BY step_no, kind`, id);
    expect(kinds.filter((k) => k.kind === 'model').length).toBe(5);
    expect(kinds.filter((k) => k.kind === 'tools').length).toBe(4);
  });
});

describe('savings estimates (FR-095, FR-097)', () => {
  it('records a labelled time-saved estimate per completed morning run, separate from verified savings', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    const e = db().get<any>(`SELECT * FROM ledger_entries WHERE type = 'time_saved_estimate'`);
    expect(e.verified).toBe(0);
    expect(e.amount).toBe(22.5);
    expect(e.method).toContain('[Assumption]');
  });
});
