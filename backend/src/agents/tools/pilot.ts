import { z } from 'zod';
import { db } from '../../db/sqlite.js';
import { ledgerSummary } from '../../services/ledger.js';
import { computeNeeds } from '../../services/planning.js';
import { publishBriefing } from '../briefing.js';
import type { ToolDef } from './types.js';

// Pilot (Purchasing Lead) tools. delegate_task is handled by the runtime (fork–join), see runtime.ts.
export const getTeamStatus: ToolDef<Record<string, never>> = {
  name: 'get_team_status',
  description: 'Status of every agent on the team, open tasks, pending approvals and unanswered questions.',
  cls: 'read',
  schema: z.object({}).strict(),
  execute: () => {
    const agents = db().all<{ id: string; display_name: string; status: string }>(`SELECT id, display_name, status FROM agents ORDER BY rowid`);
    const openTasks = db().all<{ assignee_id: string | null; n: number }>(`SELECT assignee_id, COUNT(*) AS n FROM tasks WHERE status IN ('todo','in_progress','waiting','blocked') GROUP BY assignee_id`);
    return {
      agents: agents.map((a) => ({ id: a.id, name: a.display_name, status: a.status, openTasks: openTasks.find((t) => t.assignee_id === a.id)?.n ?? 0 })),
      pendingApprovals: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_actions WHERE status = 'proposed'`)!.n,
      openQuestions: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM questions WHERE status = 'open'`)!.n,
      posAwaitingConfirmation: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'sent'`)!.n,
    };
  },
};

export const getInventoryStatus: ToolDef<Record<string, never>> = {
  name: 'get_inventory_status',
  description: 'Stock risk overview: critical and low items (days of cover), batches at risk of expiry with value, expired stock to write off.',
  cls: 'read',
  schema: z.object({}).strict(),
  execute: () => {
    const needs = computeNeeds();
    const crit = needs.filter((n) => n.trace.status === 'critical');
    const low = needs.filter((n) => n.trace.status === 'low');
    const risks = needs.filter((n) => n.valueAtRisk > 0);
    return {
      critical: crit.map((n) => ({ ingredientId: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover, leadTimeDays: n.leadTimeDays })),
      low: low.map((n) => ({ ingredientId: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover })),
      expiryRisks: risks.map((n) => ({ ingredientId: n.ingredientId, name: n.name, unit: n.unit, atRisk: n.expiry.reduce((s, r) => s + r.atRisk, 0), valueAtRisk: n.valueAtRisk, expiresAt: n.expiry[0]?.expiresAt })),
      valueAtRisk: Math.round(risks.reduce((s, n) => s + n.valueAtRisk, 0) * 100) / 100,
      expiredToWriteOff: needs.filter((n) => n.expiredQty > 0).map((n) => ({ ingredientId: n.ingredientId, name: n.name, qty: n.expiredQty, unit: n.unit })),
      itemsNeedingOrder: needs.filter((n) => n.trace.need > 0).length,
    };
  },
};

export const getSavingsSummary: ToolDef<Record<string, never>> = {
  name: 'get_savings_summary',
  description: 'Savings ledger for this month: verified savings (optimiser, recovered credits), pending credits and estimates — reported separately.',
  cls: 'read',
  schema: z.object({}).strict(),
  execute: () => ledgerSummary(),
};

export const publishBriefingTool: ToolDef<{ note?: string }> = {
  name: 'publish_briefing',
  description: 'Publish the daily standup briefing for the humans (per agent: done, today, needs you). Call once, after the team has finished its work.',
  cls: 'act',
  schema: z.object({ note: z.string().max(300).optional().describe('Optional remark from Pilot to include') }).strict(),
  prepare: () => ({ summary: 'Publish the standup briefing' }),
  execute: async (args, ctx) => publishBriefing(ctx.run, args.note),
};
