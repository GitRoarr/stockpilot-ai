import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { requireRole, requireUser } from '../auth/sessions.js';
import { correctionFromLineEdit } from '../agents/actions.js';
import { conflict, id, nowIso, unprocessable } from '../lib/util.js';
import { dashboard } from '../services/dashboard.js';
import { closeDispute, disputeDetail, listDisputes, recordCredit, sendDispute } from '../services/disputes.js';
import { acceptPrice, confirmInvoice, invoiceDetail, invoiceImage, listInvoices, MAX_UPLOAD, saveExtraction, suggestMappings, uploadInvoice } from '../services/invoices.js';
import { ledgerEntries, ledgerSummary } from '../services/ledger.js';
import { approvePo, cancelPo, draftFromPlan, editLine, getPoRow, listPos, poCsv, poDetail, poPrintHtml, sendPo, setPoNote, setStatus } from '../services/purchaseOrders.js';
import { receiveDelivery, receivingForm } from '../services/receiving.js';

// Purchase orders, receiving, invoices, disputes, savings (SRS FR-070 – FR-097).
export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-orders', async (req) => listPos((req.query as { status?: string }).status));
  app.get('/purchase-orders/:id', async (req) => poDetail((req.params as { id: string }).id));
  app.post('/purchase-orders/from-plan', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ planId: z.string() }).parse(req.body);
    return draftFromPlan(b.planId, { type: 'user', id: u.id }, { supersede: true });
  });
  app.patch('/purchase-orders/:id/lines/:lineId', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const { id, lineId } = req.params as { id: string; lineId: string };
    const b = z.object({ packs: z.number().int().min(0).max(1000).optional(), note: z.string().max(300).optional() }).parse(req.body);
    const before = db().get<{ packs: number }>(`SELECT packs FROM po_lines WHERE id = ?`, lineId);
    const po = editLine(id, lineId, b, { type: 'user', id: u.id });
    if (before && b.packs !== undefined) correctionFromLineEdit(id, lineId, before.packs, b.packs, { type: 'user', id: u.id });
    return po;
  });
  app.patch('/purchase-orders/:id', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ note: z.string().max(500) }).parse(req.body);
    return setPoNote((req.params as { id: string }).id, b.note, { type: 'user', id: u.id });
  });
  app.post('/purchase-orders/:id/approve', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    const po = approvePo(id, u);
    // A pending send proposal for this PO is now redundant.
    db().run(`UPDATE agent_actions SET status = 'rejected', reject_reason = 'Approved directly on the PO', approver_id = ?, decided_at = ? WHERE status = 'proposed' AND tool = 'send_purchase_order' AND json_extract(args_json, '$.poId') = ?`, u.id, nowIso(), id);
    return po;
  });
  app.post('/purchase-orders/:id/send', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const { id } = req.params as { id: string };
    const po = getPoRow(id);
    if (['draft', 'pending_approval'].includes(po.status)) approvePo(id, u);
    db().run(`UPDATE agent_actions SET status = 'rejected', reject_reason = 'Sent directly from the PO', approver_id = ?, decided_at = ? WHERE status = 'proposed' AND tool = 'send_purchase_order' AND json_extract(args_json, '$.poId') = ?`, u.id, nowIso(), id);
    return sendPo(id, { type: 'user', id: u.id });
  });
  app.post('/purchase-orders/:id/submit', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    return setStatus((req.params as { id: string }).id, 'pending_approval', { type: 'user', id: u.id });
  });
  app.post('/purchase-orders/:id/cancel', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    return cancelPo((req.params as { id: string }).id, { type: 'user', id: u.id }, b.reason);
  });
  app.get('/purchase-orders/:id/print', async (req, reply) => reply.type('text/html').send(poPrintHtml((req.params as { id: string }).id)));
  app.get('/purchase-orders/:id/csv', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const po = getPoRow(id);
    if (['draft', 'pending_approval', 'cancelled'].includes(po.status)) throw conflict('Only approved purchase orders can be exported');
    return reply.type('text/csv').header('content-disposition', `attachment; filename="${po.number}.csv"`).send(poCsv(id));
  });

  // Receiving (FR-080).
  app.get('/receipts/form/:poId', async (req) => receivingForm((req.params as { poId: string }).poId));
  app.post('/receipts', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    const b = z
      .object({
        purchaseOrderId: z.string(),
        lines: z.array(z.object({ poLineId: z.string(), qtyReceived: z.number().min(0), qtyRejected: z.number().min(0).optional(), condition: z.enum(['ok', 'damaged', 'rejected']), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })).min(1),
      })
      .parse(req.body);
    return receiveDelivery(b.purchaseOrderId, b.lines, { type: 'user', id: u.id });
  });

  // Invoices (FR-081 – FR-089).
  app.get('/invoices', async () => listInvoices());
  app.post('/invoices', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    const parts = req.parts({ limits: { fileSize: MAX_UPLOAD, files: 1 } });
    let file: { buffer: Buffer; mimeType: string } | undefined;
    const fields: Record<string, string> = {};
    for await (const p of parts) {
      if (p.type === 'file') {
        const buffer = await p.toBuffer();
        if ((p.file as { truncated?: boolean }).truncated) throw unprocessable('Image is larger than 10 MB');
        file = { buffer, mimeType: p.mimetype };
      } else fields[p.fieldname] = String(p.value);
    }
    if (!file) throw unprocessable('Attach an invoice photo');
    const f = z.object({ supplierId: z.string(), purchaseOrderId: z.string().optional() }).parse(fields);
    return uploadInvoice({ buffer: file.buffer, mimeType: file.mimeType, supplierId: f.supplierId, poId: f.purchaseOrderId || null }, { type: 'user', id: u.id });
  });
  app.post('/invoices/manual', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    const b = z.object({ supplierId: z.string(), purchaseOrderId: z.string().optional() }).parse(req.body);
    const inv = uploadInvoiceless(b.supplierId, b.purchaseOrderId ?? null, u.id);
    return inv;
  });
  app.get('/invoices/:id', async (req) => invoiceDetail((req.params as { id: string }).id));
  app.get('/invoices/:id/image', async (req, reply) => {
    const img = invoiceImage((req.params as { id: string }).id);
    return reply.type(img.mime).send(createReadStream(img.file));
  });
  app.put('/invoices/:id/extraction', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    return saveExtraction((req.params as { id: string }).id, req.body, { type: 'user', id: u.id });
  });
  app.post('/invoices/:id/suggest-mappings', async (req) => {
    requireUser(req);
    return suggestMappings((req.params as { id: string }).id);
  });
  app.post('/invoices/:id/confirm', async (req) => {
    const u = requireRole(req, 'owner', 'chef', 'staff');
    const b = z.object({ acceptIssues: z.boolean().optional(), mappings: z.array(z.object({ lineId: z.string(), poLineId: z.string().nullable() })).optional() }).parse(req.body ?? {});
    return confirmInvoice((req.params as { id: string }).id, b, { type: 'user', id: u.id });
  });
  app.post('/invoices/:id/accept-price', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ lineId: z.string() }).parse(req.body);
    acceptPrice((req.params as { id: string }).id, b.lineId, { type: 'user', id: u.id });
    return { ok: true };
  });

  // Disputes (FR-086, FR-087).
  app.get('/disputes', async () => listDisputes());
  app.get('/disputes/:id', async (req) => disputeDetail((req.params as { id: string }).id));
  app.post('/disputes/:id/send', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const id = (req.params as { id: string }).id;
    db().run(`UPDATE agent_actions SET status = 'rejected', reject_reason = 'Sent directly', approver_id = ?, decided_at = ? WHERE status = 'proposed' AND tool = 'send_dispute_email' AND json_extract(args_json, '$.disputeId') = ?`, u.id, nowIso(), id);
    return sendDispute(id, { type: 'user', id: u.id });
  });
  app.post('/disputes/:id/credit', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    const b = z.object({ amount: z.number().positive(), note: z.string().max(200).optional() }).parse(req.body);
    return recordCredit((req.params as { id: string }).id, b.amount, { type: 'user', id: u.id }, b.note ?? 'Credit note recorded by user');
  });
  app.post('/disputes/:id/close', async (req) => {
    const u = requireRole(req, 'owner', 'chef');
    return closeDispute((req.params as { id: string }).id, { type: 'user', id: u.id });
  });

  // Savings and dashboard (FR-095 – FR-097).
  app.get('/ledger', async () => ({ summary: ledgerSummary(), entries: ledgerEntries() }));
  app.get('/dashboard', async () => dashboard());
}

/** Manual invoice entry without a photo (FR-083 fallback). */
function uploadInvoiceless(supplierId: string, poId: string | null, userId: string) {
  if (!db().get(`SELECT 1 FROM suppliers WHERE id = ?`, supplierId)) throw unprocessable('Unknown supplier');
  const invId = id('inv');
  db().run(
    `INSERT INTO invoices (id, supplier_id, purchase_order_id, status, extraction_mode, issues_json, created_by, created_at) VALUES (?,?,?,'needs_review','manual (no photo)',?,?,?)`,
    invId,
    supplierId,
    poId,
    JSON.stringify([{ field: 'all', message: 'Enter the invoice manually' }]),
    userId,
    nowIso(),
  );
  return invoiceDetail(invId);
}
