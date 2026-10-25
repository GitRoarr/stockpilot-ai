import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { loadTemplate } from '../agents/manifest.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { localDate, localTime, nowIso } from '../lib/util.js';
import { createTask } from './collaboration.js';

// Hire from template (SRS FR-110, FR-111; Solution Design §D3.2). Deploying copies manifests, policy, schedule and the
// onboarding task list into the workspace.
export const PRESETS = {
  cautious: { open_dispute: 'approve', send_supplier_followup: 'approve', draft_purchase_orders: 'auto', add_demand_event: 'approve' },
  balanced: {},
  hands_off: { add_demand_event: 'auto' },
} as const;

export const DeploySchema = z.object({
  restaurant: z
    .object({
      name: z.string().min(1).max(80),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().min(3),
      country: z.string().regex(/^[A-Z]{2}$/).default('US'),
      subdivision: z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/).default('US-CA'),
    })
    .optional(),
  schedule: z.object({ morningRunTime: z.string().regex(/^\d{2}:\d{2}$/), workingHours: z.object({ from: z.string(), to: z.string() }).optional() }).optional(),
  autonomy: z.object({ preset: z.enum(['cautious', 'balanced', 'hands_off']).default('balanced'), chefApprovalLimit: z.number().min(0).max(100000).optional(), autoSendMaxTotal: z.number().min(0).optional() }).optional(),
  channels: z.object({ briefingEmail: z.boolean() }).optional(),
});
export type DeployInput = z.infer<typeof DeploySchema>;

export function templates() {
  const { template, manifests } = loadTemplate();
  return [{ id: template.id, name: template.name, version: template.version, description: template.description, agents: manifests.map((m) => ({ id: m.id, displayName: m.displayName, role: m.role, tools: m.tools.length })), onboardingTasks: template.onboardingTasks, defaultPolicy: template.defaultPolicy, limits: template.limits }];
}

export function deployTemplate(input: DeployInput, actor: Actor, ownerUserId?: string | null) {
  const d = DeploySchema.parse(input);
  const { template, manifests } = loadTemplate();
  const preset = d.autonomy?.preset ?? 'balanced';
  return db().tx(() => {
    const at = nowIso();
    db().run(`INSERT OR REPLACE INTO team_templates (id, name, description, version, payload_json) VALUES (?,?,?,?,?)`, template.id, template.name, template.description, template.version, JSON.stringify(template));
    for (const m of manifests) {
      db().run(
        `INSERT INTO agents (id, display_name, role, manifest_json, manifest_version, status, template_id, deployed_at) VALUES (?,?,?,?,?,'idle',?,?)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, manifest_json = excluded.manifest_json, manifest_version = excluded.manifest_version, template_id = excluded.template_id`,
        m.id,
        m.displayName,
        m.role,
        JSON.stringify(m),
        m.version,
        template.id,
        at,
      );
    }
    const policy: Record<string, string> = { ...template.defaultPolicy, ...PRESETS[preset] };
    for (const [action, level] of Object.entries(policy)) {
      db().run(`INSERT INTO autonomy_policy (action, level, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(action) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, action, level, at, actor.id ?? null);
    }
    const s = getSettings();
    saveSettings({
      ...(d.restaurant ? { restaurantName: d.restaurant.name, latitude: d.restaurant.latitude, longitude: d.restaurant.longitude, timezone: d.restaurant.timezone, country: d.restaurant.country, subdivision: d.restaurant.subdivision } : {}),
      morningRunTime: d.schedule?.morningRunTime ?? s.morningRunTime,
      workingHours: d.schedule?.workingHours ?? s.workingHours,
      chefApprovalLimit: d.autonomy?.chefApprovalLimit ?? template.limits.chefApprovalLimit,
      autoSend: { ...template.limits.autoSend, enabled: preset === 'hands_off', maxTotal: d.autonomy?.autoSendMaxTotal ?? template.limits.autoSend.maxTotal },
      briefingEmail: d.channels?.briefingEmail ?? s.briefingEmail,
      onboardingComplete: true,
    });
    const existing = db().get(`SELECT 1 FROM tasks WHERE created_by_type = 'system' AND title = ?`, template.onboardingTasks[0]);
    const tasks = existing
      ? []
      : template.onboardingTasks.map((title) => createTask({ title, assigneeType: ownerUserId ? 'user' : 'none', assigneeId: ownerUserId ?? null, status: 'todo', createdBy: { type: 'system' }, linkedType: 'team', linkedId: 'team' }));
    // Local "YYYY-MM-DDTHH:MM" of deployment: a run time earlier today was not missed (scheduler catch-up).
    db().run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_created', ?)`, `${localDate()}T${localTime()}`);
    audit(actor, 'template.deployed', 'team_template', template.id, { after: { agents: manifests.map((m) => `${m.id}@${m.version}`), preset } });
    publish('team.updated', {});
    return { templateId: template.id, agents: manifests.map((m) => m.id), policy, onboardingTasks: tasks.map((t) => t.id), morningRunTime: getSettings().morningRunTime };
  });
}
