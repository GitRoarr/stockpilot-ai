import { z } from 'zod';
import { TOOL_NAMES } from '../manifest.js';
import type { ToolDecl } from '../llm/types.js';
import { getInvoiceMatch, openDisputeTool, recordCreditTool, sendDisputeEmail } from './apclerk.js';
import { draftPurchaseOrders, getReorderPlan, getSupplierOffers, optimizeOrder, proposePoChange, sendPurchaseOrder, sendSupplierFollowup } from './buyer.js';
import { askHuman, delegateTask, postMessageTool, proposeWorkingAgreement } from './common.js';
import { getInventoryStatus, getSavingsSummary, getTeamStatus, publishBriefingTool } from './pilot.js';
import { addDemandEvent, getBacktestReport, getForecastTool, refreshContextTool, simulateScenario } from './planner.js';
import type { ToolDef } from './types.js';

// Tool registry: 24 tools (Solution Design §D3.3).
export const TOOLS: Record<string, ToolDef> = Object.fromEntries(
  [
    askHuman,
    postMessageTool,
    proposeWorkingAgreement,
    getTeamStatus,
    delegateTask,
    getInventoryStatus,
    getSavingsSummary,
    publishBriefingTool,
    refreshContextTool,
    getForecastTool,
    getBacktestReport,
    addDemandEvent,
    simulateScenario,
    getReorderPlan,
    getSupplierOffers,
    optimizeOrder,
    draftPurchaseOrders,
    proposePoChange,
    sendPurchaseOrder,
    sendSupplierFollowup,
    getInvoiceMatch,
    openDisputeTool,
    sendDisputeEmail,
    recordCreditTool,
  ].map((t) => [t.name, t as ToolDef]),
);

if (Object.keys(TOOLS).length !== TOOL_NAMES.length || !TOOL_NAMES.every((n) => TOOLS[n])) throw new Error('Tool registry and manifest tool names differ');

/**
 * Keeps only schema keywords the Gemini API accepts. Verified live: a boolean `exclusiveMinimum` (OpenAPI 3.0 style) makes
 * the whole request fail with "400 Invalid JSON payload"; `oneOf` is sent as `anyOf`. Zod still enforces the exact rules
 * when a tool call arrives, so nothing is lost.
 */
export function toGeminiSchema(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toGeminiSchema);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if ((k === 'exclusiveMinimum' || k === 'exclusiveMaximum') && typeof x === 'boolean') continue;
    out[k === 'oneOf' ? 'anyOf' : k] = toGeminiSchema(x);
  }
  return out;
}

/** Gemini function declarations from the Zod schemas (z.toJSONSchema). */
export function declarations(names: string[]): ToolDecl[] {
  return names.map((n) => {
    const t = TOOLS[n];
    const schema = z.toJSONSchema(t.schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, parameters: toGeminiSchema(schema) as Record<string, unknown> };
  });
}
