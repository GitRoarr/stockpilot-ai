import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TASK_STATUSES } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { requireRole, requireUser } from '../auth/sessions.js';
import { approveAction, inbox, rejectAction } from '../agents/actions.js';
import { getManifest } from '../agents/manifest.js';
import { answerQuestion, cancelRun, listRuns, runDetail, startRun } from '../agents/runtime.js';
import { startMorningRun } from '../agents/triggers.js';
import { audit, publish } from '../lib/events.js';
import { json, notFound } from '../lib/util.js';
import { approveAgreement, decideAgreement, listAgreements } from '../services/agreements.js';
import { createTask, ensureThread, LINKED_TYPES, listTasks, postMessage, taskDetail, threadView, updateTask } from '../services/collaboration.js';
import { deployTemplate, templates } from '../services/onboarding.js';
import { scorecardFor } from '../services/scorecards.js';

// Agent team, tasks, threads, inbox, runs, agreements (SRS FR-110 – FR-121, Solution Design §D7.1).
export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', async () => templates());
  app.post('/templates/:id/deploy', async (req) => {
    const u = requireRole(req, 'owner');
    return deployTemplate(req.body as never, { type: 'user', id: u.id }, u.id);
  });

  app.get('/agents', async () => {
    const rows = db().all<any>(`SELECT * FROM agents ORDER BY rowid`);
    return rows.map((a) => {
      const m = json<any>(a.manifest_json, {});
      const policy = Object.fromEntries(db().all<{ action: string; level: string }>(`SELECT action, level FROM autonomy_policy`).map((r) => [r.action, r.level]));
      return {
        id: a.id,
        displayName: a.display_name,
        role: a.role,
        status: a.status,
        manifestVersion: a.manifest_version,
        responsibilities: m.responsibilities,
        tools: m.tools,
        kpis: m.kpis,
        triggers: m.triggers,
        budgets: m.budgets,
        autonomy: Object.fromEntries((m.tools as string[]).filter((t) => policy[t]).map((t) => [t, policy[t]])),
        currentTasks: db().all(`SELECT id, title, status FROM tasks WHERE assignee_id = ? AND status IN ('todo','in_progress','waiting','blocked') ORDER BY created_at DESC LIMIT 5`, a.id),
        lastRuns: db().all(`SELECT id, status, mode, goal, started_at FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 5`, a.id),
      };
    });
  });
  app.get('/agents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = getManifest(id);
    if (!m) throw notFound('Agent not found');
    return { manifest: m, status: db().get<{ status: string }>(`SELECT status FROM agents WHERE id = ?`, id)?.status, agreements: listAgreements().filter((a) => a.agentId === id), scorecard: scorecardFor(id) };
  });
  for (const action of ['pause', 'resume'] as const) {
    app.post(`/agents/:id/${action}`, async (req) => {
      const u = requireRole(req, 'owner');
      const { id } = req.params as { id: string };
      if (!getManifest(id)) throw notFound('Agent not found');
      db().run(`UPDATE agents SET status = ? WHERE id = ?`, action === 'pause' ? 'paused' : 'idle', id);
      audit({ type: 'user', id: u.id }, `agent.${action}d`, 'agent', id);
      publish('agent.status', { agentId: id });
      return { ok: true };
    });
  }
  app.get('/agents/:id/scorecard', async (req) => {
    const { id } = req.params as { id: string };
    const period = (req.query as { period?: string }).period === 'month' ? 'month' : 'week';
    return scorecardFor(id === 'team' ? null : id, period);
  });

  // Tasks (FR-113) — assigning a task to an agent starts a run with the user's role as the ceiling (FR-115).
  app.get('/tasks', async (req) => listTasks(req.query as never));
  app.get('/tasks/:id', async (req) => taskDetail((req.params as { id: string }).id));
  app.post('/tasks', async (req) => {
    const u = requireUser(req);
    const b = z
      .object({ title: z.string().min(3).max(120), description: z.string().max(1000).optional(), assigneeType: z.enum(['user', 'agent', 'none']), assigneeId: z.string().nullable().optional(), dueAt: z.string().nullable().optional(), linkedType: z.enum(LINKED_TYPES).optional(), linkedId: z.string().optional() })
      .parse(req.body);
    if (b.assigneeType === 'agent' && !getManifest(b.assigneeId ?? '')) throw notFound('Agent not found');
    const t = createTask({ ...b, status: 'todo', createdBy: { type: 'user', id: u.id } });
    if (b.assigneeType === 'agent') {
      startRun({ agentId: b.assigneeId!, goal: `${b.title}${b.description ? `\n${b.description}` : ''}`, trigger: 'assignment', playbook: 'chat', taskId: t.id, threadId: ensureThread('task', t.id), authority: { role: u.role, userId: u.id }, payload: { message: `${b.title} ${b.description ?? ''}`, linkedType: b.linkedType, linkedId: b.linkedId } });
    }
    return taskDetail(t.id);
  });
  app.patch('/tasks/:id', async (req) => {
    const u = requireUser(req);
    const b = z.object({ status: z.enum(TASK_STATUSES).optional(), assigneeType: z.enum(['user', 'agent', 'none']).optional(), assigneeId: z.string().nullable().optional(), title: z.string().min(3).max(120).optional() }).parse(req.body);
    return updateTask((req.params as { id: string }).id, b, { type: 'user', id: u.id });
  });

  // Threads (FR-116) — @mentions start agent runs.
  app.get('/threads/:type/:id', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    if (!(LINKED_TYPES as readonly string[]).includes(type)) throw notFound('Unknown thread type');
    return threadView(type, id);
  });
  app.post('/threads/:type/:id/messages', async (req) => {
    const u = requireUser(req);
    const { type, id } = req.params as { type: string; id: string };
    if (!(LINKED_TYPES as readonly string[]).includes(type)) throw notFound('Unknown thread type');
    const b = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    const m = postMessage(ensureThread(type, id), { type: 'user', id: u.id }, b.body, { startRuns: { id: u.id, role: u.role } });
    return m;
  });
  // "Message the team" box → Pilot unless another agent is @mentioned (FR-057).
  app.post('/team/messages', async (req) => {
    const u = requireUser(req);
    const b = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    const threadId = ensureThread('team', 'team');
    const body = /@\w/.test(b.body) ? b.body : `@Pilot ${b.body}`;
    return postMessage(threadId, { type: 'user', id: u.id }, body, { startRuns: { id: u.id, role: u.role } });
  });

  // Inbox (FR-068, FR-117).
  app.get('/inbox', async (req) => inbox(requireUser(req)));
  app.post('/actions/:id/approve', async (req) => {
    const u = requireUser(req);
    return { result: await approveAction((req.params as { id: string }).id, u) };
  });
  app.post('/actions/:id/reject', async (req) => {
    const u = requireUser(req);
    const b = z.object({ reason: z.string().min(2).max(500), tags: z.object({ supplierId: z.string().optional(), category: z.string().optional(), ingredientId: z.string().optional() }).optional() }).parse(req.body);
    await rejectAction((req.params as { id: string }).id, u, b.reason, b.tags);
    return { ok: true };
  });
  app.post('/questions/:id/answer', async (req) => {
    const u = requireUser(req);
    const b = z.object({ answer: z.string().min(1).max(60) }).parse(req.body);
    await answerQuestion((req.params as { id: string }).id, b.answer, u);
    return { ok: true };
  });

  // Runs (FR-055, FR-060).
  app.get('/agent-runs', async () => listRuns());
  app.get('/agent-runs/:id', async (req) => runDetail((req.params as { id: string }).id));
  app.post('/agent-runs', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ agentId: z.string().default('pilot'), goal: z.string().min(3).max(500).optional(), kind: z.enum(['morning', 'chat']).default('morning') }).parse(req.body ?? {});
    if (b.kind === 'morning') return { runId: startMorningRun({ trigger: 'manual', user: u }) };
    if (!getManifest(b.agentId)) throw notFound('Agent not found');
    return { runId: startRun({ agentId: b.agentId, goal: b.goal ?? 'Help the team', trigger: 'assignment', playbook: 'chat', authority: { role: u.role, userId: u.id }, payload: { message: b.goal } }) };
  });
  app.post('/agent-runs/:id/cancel', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    cancelRun((req.params as { id: string }).id, { type: 'user', id: u.id });
    return { ok: true };
  });

  // Working agreements (FR-119) — Owner approval always.
  app.get('/agreements', async () => listAgreements());
  app.post('/agreements/:id/approve', async (req) => {
    const u = requireRole(req, 'owner');
    return approveAgreement((req.params as { id: string }).id, { type: 'user', id: u.id });
  });
  app.post('/agreements/:id/reject', async (req) => {
    const u = requireRole(req, 'owner');
    return decideAgreement((req.params as { id: string }).id, 'rejected', { type: 'user', id: u.id });
  });
  app.post('/agreements/:id/revoke', async (req) => {
    const u = requireRole(req, 'owner');
    return decideAgreement((req.params as { id: string }).id, 'revoked', { type: 'user', id: u.id });
  });
}
