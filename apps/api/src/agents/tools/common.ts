import { z } from 'zod';
import { AGENT_IDS } from '@stockpilot/shared';
import { AgreementSchema, proposeAgreement } from '../../services/agreements.js';
import type { ToolDef } from './types.js';

// Collaboration tools shared by every agent. ask_human and delegate_task pause the run (runtime.ts);
// post_message is grounding-checked by the runtime before it is posted.
export const askHumanSchema = z
  .object({
    question: z.string().min(5).max(300),
    options: z.array(z.string().min(1).max(60)).min(2).max(5),
    recommended: z.string().min(1).max(60),
    deadlineMinutes: z.number().int().min(5).max(24 * 60).optional(),
    actionId: z.string().optional().describe('Pending proposal this question decides (Yes approves it, No rejects it)'),
  })
  .strict()
  .refine((q) => q.options.includes(q.recommended), 'recommended must be one of the options');

export const askHuman: ToolDef<z.infer<typeof askHumanSchema>> = {
  name: 'ask_human',
  description: 'Ask the responsible human a question with options and a recommended default. The run pauses until they answer (or the deadline passes).',
  cls: 'collaborate',
  schema: askHumanSchema,
  execute: () => {
    throw new Error('handled by runtime');
  },
};

export const postMessageSchema = z
  .object({
    text: z.string().min(1).max(1500),
    linkedType: z.enum(['task', 'purchase_order', 'invoice', 'dispute', 'ingredient', 'supplier', 'team']).optional(),
    linkedId: z.string().optional(),
  })
  .strict();

export const postMessageTool: ToolDef<z.infer<typeof postMessageSchema>> = {
  name: 'post_message',
  description: 'Post a short message to the thread of this run (or of a linked object). Only use numbers that appear in tool results.',
  cls: 'collaborate',
  schema: postMessageSchema,
  execute: () => {
    throw new Error('handled by runtime');
  },
};

const agreementArgs = z
  .object({
    agreement: AgreementSchema,
    rationale: z.string().min(5).max(400),
    evidenceIds: z.array(z.string()).max(10).default([]),
  })
  .strict();

export const proposeWorkingAgreement: ToolDef<z.infer<typeof agreementArgs>> = {
  name: 'propose_working_agreement',
  description:
    'Propose a structured working agreement (exclude_supplier, prefer_supplier, min_order_override, rounding_preference, approval_rule, quiet_hours, notify_preference) after repeated corrections or an explicit instruction. Takes effect only after Owner approval.',
  cls: 'act',
  schema: agreementArgs,
  prepare: (a) => ({ summary: `Working agreement: ${a.agreement.type} ${JSON.stringify(a.agreement.params)}` }),
  execute: (a, ctx) => {
    const ag = proposeAgreement(ctx.run.agentId, a.agreement, a.rationale, a.evidenceIds.map((id) => ({ type: 'ref', id })));
    return { agreementId: ag.id, status: ag.status, note: 'Owner approval required before it takes effect' };
  },
};

export const delegateSchema = z
  .object({
    agent: z.enum(AGENT_IDS),
    goal: z.string().min(5).max(500),
    inputs: z.record(z.string(), z.unknown()).optional(),
    expectedOutput: z.string().max(300).optional(),
    deadlineMinutes: z.number().int().min(1).max(600).optional(),
  })
  .strict();

export const delegateTask: ToolDef<z.infer<typeof delegateSchema>> = {
  name: 'delegate_task',
  description: 'Assign a sub-task to a specialist agent (demand-planner for forecasting, buyer for ordering, ap-clerk for invoices). Your run waits for their structured result.',
  cls: 'collaborate',
  schema: delegateSchema,
  execute: () => {
    throw new Error('handled by runtime');
  },
};
