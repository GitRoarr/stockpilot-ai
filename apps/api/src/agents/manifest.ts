import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from '../config.js';
import { db } from '../db/sqlite.js';
import { json } from '../lib/util.js';

// Agent manifests (SRS FR-110, Solution Design §D3.2). The manifest is the permission boundary.
export const TOOL_NAMES = [
  'ask_human',
  'post_message',
  'propose_working_agreement',
  'get_team_status',
  'delegate_task',
  'get_inventory_status',
  'get_savings_summary',
  'publish_briefing',
  'refresh_context',
  'get_forecast',
  'get_backtest_report',
  'add_demand_event',
  'simulate_scenario',
  'get_reorder_plan',
  'get_supplier_offers',
  'optimize_order',
  'draft_purchase_orders',
  'propose_po_change',
  'send_purchase_order',
  'send_supplier_followup',
  'get_invoice_match',
  'open_dispute',
  'send_dispute_email',
  'record_credit',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z-]*$/),
  version: z.number().int().positive(),
  displayName: z.string().min(1).max(40),
  role: z.string().min(10),
  responsibilities: z.array(z.string()).min(1),
  tools: z.array(z.enum(TOOL_NAMES)).min(1).max(10),
  triggers: z.array(z.string()).min(1),
  escalateTo: z.string(),
  kpis: z.array(z.string()),
  budgets: z.object({ maxSteps: z.number().int().min(1).max(20), maxToolCalls: z.number().int().min(1).max(30), maxSeconds: z.number().int().min(10).max(600) }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates/restaurant-purchasing-team');

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  description: z.string(),
  agents: z.array(z.string()).min(1),
  defaultPolicy: z.record(z.string(), z.enum(['auto', 'approve', 'never'])),
  policyNotes: z.record(z.string(), z.string()).optional(),
  limits: z.object({ chefApprovalLimit: z.number(), autoSend: z.object({ enabled: z.boolean(), maxTotal: z.number(), maxDeviationPct: z.number() }) }),
  schedule: z.object({ morningRunCron: z.string(), nightlyForecastCron: z.string(), weeklyScorecardCron: z.string() }),
  onboardingTasks: z.array(z.string()),
});
export type Template = z.infer<typeof TemplateSchema>;

export function loadTemplate(): { template: Template; manifests: Manifest[] } {
  const template = TemplateSchema.parse(JSON.parse(readFileSync(path.join(TEMPLATE_DIR, 'template.json'), 'utf8')));
  const manifests = template.agents.map((a) => parseManifest(JSON.parse(readFileSync(path.join(TEMPLATE_DIR, 'manifests', `${a}.json`), 'utf8'))));
  return { template, manifests };
}

/** Validates a manifest; an unknown tool is a schema error (AC-110). */
export function parseManifest(raw: unknown): Manifest {
  return ManifestSchema.parse(raw);
}

export function getManifest(agentId: string): Manifest | undefined {
  const r = db().get<{ manifest_json: string }>(`SELECT manifest_json FROM agents WHERE id = ?`, agentId);
  return r ? json<Manifest>(r.manifest_json, undefined as never) : undefined;
}
