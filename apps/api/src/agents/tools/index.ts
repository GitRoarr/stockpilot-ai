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

/** Gemini function declarations from the Zod schemas (z.toJSONSchema). */
export function declarations(names: string[]): ToolDecl[] {
  return names.map((n) => {
    const t = TOOLS[n];
    const schema = z.toJSONSchema(t.schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, parameters: schema };
  });
}
