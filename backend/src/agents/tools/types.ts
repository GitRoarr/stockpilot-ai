import type { z } from 'zod';
import type { Role } from '@stockpilot/shared';
import type { Actor } from '../../lib/events.js';
import type { ActionFacts } from '../policy.js';

// Tool definition (Solution Design §D3.3): one Zod schema serves validation and the Gemini declaration.
export type ToolClass = 'read' | 'compute' | 'act' | 'collaborate';

export type RunInfo = {
  id: string;
  agentId: string;
  taskId: string | null;
  threadId: string | null;
  parentRunId: string | null;
  trigger: string;
  playbook: string;
  payload: Record<string, any>;
  externalText: boolean;
  authorityRole: Role | 'system';
  authorityUserId: string | null;
  depth: number;
  mode: 'ai' | 'deterministic';
  fallbackReason?: string | null;
};

export type ToolContext = { run: RunInfo; actor: Actor; stepNo: number; callIndex: number };

/** Execution context of an action; `approver` is set when a human approved a proposal. */
export type ExecContext = ToolContext & { approver?: { id: string; role: Role } };

export type Prepared = { summary: string; facts?: ActionFacts; args?: Record<string, unknown> };

export type ToolDef<A = any> = {
  name: string;
  description: string;
  cls: ToolClass;
  schema: z.ZodType<A>;
  /** Policy action type (defaults to the tool name). */
  actionType?: (args: A) => string;
  /** Act tools: validate against current state and describe the action before policy (no side effects). */
  prepare?: (args: A, ctx: ToolContext) => Prepared | Promise<Prepared>;
  /** Called when a proposal is created (e.g. PO → pending_approval). */
  onProposed?: (args: A, ctx: ToolContext, actionId: string) => void;
  onRejected?: (args: A, reason: string, actor: Actor) => void;
  execute: (args: A, ctx: ExecContext) => Promise<unknown> | unknown;
};

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
