import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, setConfig } from '../config.js';
import { db } from '../db/sqlite.js';
import { requireRole, requireUser } from '../auth/sessions.js';
import { aiAvailable, llmClient, modelCallStats } from '../agents/llm/gateway.js';
import { InteractionsClient } from '../agents/llm/interactions.js';
import { checkBrevo, brevoConfigured } from '../integrations/brevo.js';
import { drainJobs } from '../jobs/worker.js';
import { queueDepth } from '../jobs/queue.js';
import { audit, bus, type LiveEvent } from '../lib/events.js';
import { getSettings, saveSettings, SettingsSchema } from '../lib/settings.js';
import { AppError, clockOffsetMs, json, localDate, localTime, nowIso, setClockOffsetMs } from '../lib/util.js';
import { contextStatus, refreshContext } from '../services/context.js';
import { getEmail, listEmails, resendEmail } from '../services/email.js';
import { fitModels } from '../services/forecast.js';

// Live updates, outbox, audit, settings, policy, health, demo controls (SRS FR-090 – FR-101, Solution Design §D7.1).
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  // SSE (FR-060, FR-092): one stream per browser tab; the client invalidates queries by event type.
  app.get('/events', async (req, reply) => {
    requireUser(req);
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const onEvent = (e: LiveEvent) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
    bus.on('live', onEvent);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('live', onEvent);
    });
    return reply;
  });

  app.get('/notifications', async (req) => {
    const u = requireUser(req);
    return db().all(`SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 50`, u.id);
  });
  app.post('/notifications/read', async (req) => {
    requireUser(req);
    db().run(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`, nowIso());
    return { ok: true };
  });

  app.get('/emails', async () => listEmails());
  app.get('/emails/:id', async (req) => getEmail((req.params as { id: string }).id));
  app.post('/emails/:id/resend', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    resendEmail((req.params as { id: string }).id);
    audit({ type: 'user', id: u.id }, 'email.resend', 'email', (req.params as { id: string }).id);
    return { ok: true };
  });

  app.get('/audit-events', async (req) => {
    const q = req.query as { actor?: string; entityType?: string; entityId?: string; limit?: string };
    const rows = db().all<any>(
      `SELECT * FROM audit_events WHERE (? IS NULL OR actor_type = ?) AND (? IS NULL OR entity_type = ?) AND (? IS NULL OR entity_id = ?) ORDER BY at DESC, rowid DESC LIMIT ?`,
      q.actor ?? null,
      q.actor ?? null,
      q.entityType ?? null,
      q.entityType ?? null,
      q.entityId ?? null,
      q.entityId ?? null,
      Math.min(500, Number(q.limit ?? 200)),
    );
    return rows.map((r) => ({ ...r, meta: json(r.meta_json, null), before: json(r.before_json, null), after: json(r.after_json, null) }));
  });

  app.get('/settings', async () => getSettings());
  app.put('/settings', async (req) => {
    const u = requireRole(req, 'owner');
    const before = getSettings();
    const next = saveSettings(SettingsSchema.partial().parse(req.body));
    if (next.timezone !== config.TZ) setConfig({ TZ: next.timezone });
    audit({ type: 'user', id: u.id }, 'settings.updated', 'settings', 'app', { before, after: next });
    return next;
  });

  // Autonomy policy (FR-065, FR-069): changes apply to runs started afterwards (runs snapshot the policy).
  app.get('/policy', async () => ({
    levels: db().all(`SELECT action, level, updated_at, updated_by FROM autonomy_policy ORDER BY action`),
    chefApprovalLimit: getSettings().chefApprovalLimit,
    autoSend: getSettings().autoSend,
  }));
  app.put('/policy', async (req) => {
    const u = requireRole(req, 'owner');
    const b = z
      .object({
        levels: z.record(z.string(), z.enum(['auto', 'approve', 'never'])).optional(),
        chefApprovalLimit: z.number().min(0).max(100000).optional(),
        autoSend: z.object({ enabled: z.boolean(), maxTotal: z.number().min(0), maxDeviationPct: z.number().min(0).max(100) }).optional(),
      })
      .parse(req.body);
    const before = db().all(`SELECT action, level FROM autonomy_policy`);
    db().tx(() => {
      for (const [action, level] of Object.entries(b.levels ?? {})) {
        if (action === 'propose_working_agreement' && level === 'auto') throw new AppError(422, 'UNPROCESSABLE', 'Working agreements always need Owner approval');
        db().run(`INSERT INTO autonomy_policy (action, level, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(action) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, action, level, nowIso(), u.id);
      }
      if (b.chefApprovalLimit !== undefined || b.autoSend) saveSettings({ ...(b.chefApprovalLimit !== undefined ? { chefApprovalLimit: b.chefApprovalLimit } : {}), ...(b.autoSend ? { autoSend: b.autoSend } : {}) });
    });
    audit({ type: 'user', id: u.id }, 'policy.updated', 'autonomy_policy', 'policy', { before, after: b });
    return { ok: true };
  });

  // Integration status (FR-100) with "Test connection".
  app.get('/health', async () => {
    db().get('SELECT 1');
    const st = contextStatus();
    const ai = aiAvailable();
    return {
      status: 'ok',
      time: nowIso(),
      localDate: localDate(),
      localTime: localTime(),
      demoMode: config.DEMO_MODE,
      clockOffsetMs: clockOffsetMs(),
      integrations: {
        gemini: !llmClient() ? 'no_key' : ai.ok ? 'configured' : (ai.reason ?? 'unavailable'),
        weather: st.weather_forecast?.status ?? 'not_checked',
        holidays: st.holidays?.status ?? 'not_checked',
        email: brevoConfigured() ? 'configured' : 'no_key',
        telegram: config.TELEGRAM_BOT_TOKEN ? 'configured' : 'no_key',
      },
      context: st,
      ai: modelCallStats(),
    };
  });
  app.post('/integrations/:name/test', async (req) => {
    requireRole(req, 'owner', 'chef');
    const { name } = req.params as { name: string };
    try {
      if (name === 'weather' || name === 'holidays') {
        const st = await refreshContext({ force: true });
        return { name, result: name === 'weather' ? st.weather_forecast : st.holidays };
      }
      if (name === 'email') return { name, result: await checkBrevo() };
      if (name === 'gemini') {
        if (!config.GEMINI_API_KEY) return { name, result: 'no_key' };
        const c = new InteractionsClient(config.GEMINI_API_KEY);
        return { name, result: `ok: ${await c.ping(config.GEMINI_MODEL)}` };
      }
      return { name, result: 'not_supported' };
    } catch (e) {
      return { name, result: `error: ${(e as Error).message}` };
    }
  });

  app.get('/metrics', async () => ({ jobs: queueDepth(), modelCalls: modelCallStats(), runs: Object.fromEntries(db().all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM agent_runs GROUP BY status`).map((r) => [r.status, r.n])) }));

  // Demo controls (DEMO_MODE only).
  app.post('/admin/reset-demo', async (req) => {
    requireRole(req, 'owner');
    if (!config.DEMO_MODE) throw new AppError(403, 'FORBIDDEN', 'Data reset and clock controls are disabled on this server');
    const { seedDemo } = await import('../db/seed/demo.js');
    const b = z.object({ offline: z.boolean().optional() }).parse(req.body ?? {});
    return seedDemo({ offline: b.offline });
  });
  app.post('/admin/clock', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    if (!config.DEMO_MODE) throw new AppError(403, 'FORBIDDEN', 'Data reset and clock controls are disabled on this server');
    const b = z.union([z.object({ advanceMinutes: z.number().int().min(1).max(7 * 24 * 60) }), z.object({ reset: z.literal(true) })]).parse(req.body);
    setClockOffsetMs('reset' in b ? 0 : clockOffsetMs() + b.advanceMinutes * 60_000);
    audit({ type: 'user', id: u.id }, 'demo.clock', 'settings', 'clock', { meta: { offsetMs: clockOffsetMs() } });
    const ran = await drainJobs();
    return { offsetMs: clockOffsetMs(), now: nowIso(), localTime: localTime(), jobsRun: ran };
  });
  app.post('/admin/refit', async (req) => {
    requireRole(req, 'owner', 'chef');
    const r = fitModels();
    return { modelRunId: r.id, durationMs: r.durationMs };
  });
}
