import { z } from 'zod';
import { getDispute, openDispute, recordCredit, sendDispute } from '../../services/disputes.js';
import { invoiceDetail } from '../../services/invoices.js';
import { ToolError, type ToolDef } from './types.js';

// AP Clerk tools (SRS FR-084 – FR-089). Invoice text is never passed to the model; only code-computed facts are.
export const getInvoiceMatch: ToolDef<{ invoiceId: string }> = {
  name: 'get_invoice_match',
  description: 'Three-way match of an invoice: ordered vs received vs invoiced quantity and agreed vs invoiced price per line, with computed variances.',
  cls: 'read',
  schema: z.object({ invoiceId: z.string() }).strict(),
  execute: (a) => {
    const inv = invoiceDetail(a.invoiceId);
    return {
      invoiceId: inv.id,
      number: inv.number,
      poNumber: inv.poNumber,
      supplier: inv.supplier,
      status: inv.status,
      rows: inv.lines.map((l: any) => ({ item: l.poLine?.ingredient ?? '(not on PO)', ordered: l.poLine?.ordered ?? null, received: l.poLine?.received ?? null, invoiced: l.qty, agreedPrice: l.poLine?.agreedPrice ?? null, invoicedPrice: l.unit_price, matchedBy: l.match_method })),
      variances: inv.variances.map((v: any) => ({ type: v.type, description: v.description, amount: v.amount })),
      varianceTotal: inv.varianceTotal,
      priceCreep: inv.priceCreep,
      dispute: inv.dispute,
    };
  },
};

export const openDisputeTool: ToolDef<{ invoiceId: string }> = {
  name: 'open_dispute',
  description: 'Open a dispute draft for an invoice with variances above the minimum: facts table from code, covering text grounded. Does not contact the supplier.',
  cls: 'act',
  schema: z.object({ invoiceId: z.string() }).strict(),
  prepare: (a) => {
    const inv = invoiceDetail(a.invoiceId);
    if (!inv.variances.length) throw new ToolError('no_variances', 'Invoice has no variances');
    return { summary: `Draft a credit request to ${inv.supplier} for $${inv.varianceTotal.toFixed(2)} (${inv.number})`, facts: { total: inv.varianceTotal } };
  },
  execute: async (a, ctx) => {
    const d = await openDispute(a.invoiceId, ctx.actor);
    return { disputeId: d.id, number: d.number, status: d.status, amountClaimed: d.amount_claimed, textMode: d.text_mode };
  },
};

export const sendDisputeEmail: ToolDef<{ disputeId: string }> = {
  name: 'send_dispute_email',
  description: 'Email the credit request to the supplier with a portal link to accept or reject. Requires approval by default.',
  cls: 'act',
  schema: z.object({ disputeId: z.string() }).strict(),
  prepare: (a) => {
    const d = getDispute(a.disputeId);
    if (d.status !== 'draft') throw new ToolError('invalid_status', `${d.number} is ${d.status}`);
    return { summary: `Send credit request ${d.number} for $${d.amount_claimed.toFixed(2)}`, facts: { total: d.amount_claimed } };
  },
  execute: (a, ctx) => ({ disputeId: a.disputeId, ...sendDispute(a.disputeId, ctx.approver ? { type: 'user', id: ctx.approver.id } : ctx.actor) }),
};

export const recordCreditTool: ToolDef<{ disputeId: string }> = {
  name: 'record_credit',
  description: 'Record the credit for a dispute. Automatic when the supplier accepted it in the portal; otherwise a human approves.',
  cls: 'act',
  schema: z.object({ disputeId: z.string() }).strict(),
  prepare: (a) => {
    const d = getDispute(a.disputeId);
    if (!['sent', 'acknowledged'].includes(d.status)) throw new ToolError('invalid_status', `${d.number} is ${d.status}`);
    return { summary: `Record credit of $${d.amount_claimed.toFixed(2)} for ${d.number}`, facts: { supplierAccepted: d.status === 'acknowledged', total: d.amount_claimed } };
  },
  execute: (a, ctx) => {
    const d = recordCredit(a.disputeId, undefined, ctx.approver ? { type: 'user', id: ctx.approver.id } : ctx.actor);
    return { disputeId: d.id, status: d.status, amountCredited: d.amount_credited };
  },
};
