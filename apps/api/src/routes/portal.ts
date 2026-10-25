import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/util.js';
import { disputeDetail, supplierDisputeResponse } from '../services/disputes.js';
import { esc } from '../services/email.js';
import { portalPoView, submitSupplierResponse, SupplierResponseSchema } from '../services/portal.js';
import { resolvePortalToken } from '../services/portalTokens.js';

// Supplier portal (SRS FR-072 – FR-075, FR-087; Solution Design §D4.1). Public pages under /s/:token, plain HTML forms
// (no scripts, strict CSP), token-scoped JSON under /api/portal/:token. No session cookies are read or set here.
const hits = new Map<string, number[]>();
function rateLimit(req: FastifyRequest, token: string): void {
  const key = `${req.ip}|${token.slice(0, 12)}`;
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
  arr.push(t);
  hits.set(key, arr);
  if (arr.length > 40) throw new AppError(429, 'RATE_LIMITED', 'Too many requests — please wait a minute.');
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--ink:#1d2433;--paper:#f7f6f2;--accent:#2f6f4f;--line:#e5e2d9;--warn:#8a5a12}
@media (prefers-color-scheme:dark){:root{--ink:#e9e7e1;--paper:#16181d;--line:#2c2f36;--accent:#6fbf94;--warn:#e0b45c}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--paper);color:var(--ink)}
main{max-width:760px;margin:auto;padding:16px}h1{font-size:22px;margin:4px 0 2px}.muted{opacity:.7;font-size:13px}
.card{border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
.line{display:grid;gap:8px;border-top:1px solid var(--line);padding:12px 0}.line:first-child{border-top:0}
label{font-size:13px;display:block}input,select,textarea{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;width:100%;background:transparent;color:inherit}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:12px 18px;cursor:pointer;width:100%}
.ok{color:var(--accent);font-weight:600}.badge{display:inline-block;font-size:11px;border:1px solid var(--warn);color:var(--warn);border-radius:99px;padding:1px 8px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px;border-bottom:1px solid var(--line);font-size:14px}
</style></head><body><main><p class="muted">StockPilot AI · supplier portal </p>${body}</main></body></html>`;
}

function errorPage(reply: FastifyReply, e: unknown) {
  const err = e instanceof AppError ? e : new AppError(500, 'INTERNAL', 'Something went wrong');
  return reply.status(err.status).header('content-security-policy', CSP).type('text/html').send(page('Link problem', `<div class="card"><h1>${err.status === 410 ? 'Link no longer valid' : err.status === 404 ? 'Link not found' : 'Error'}</h1><p>${esc(err.message)}</p></div>`));
}

function poPage(token: string, ok?: string) {
  const v = portalPoView(resolvePortalToken(token, { scope: 'po' }).refId);
  const lines = v.lines
    .map(
      (l) => `<div class="line"><div><b>${esc(l.item)}</b> <span class="muted">${esc(l.sku)}</span><br>${l.packs} × ${l.packSize} ${esc(l.unit)} = ${l.qty} ${esc(l.unit)} at $${l.unitPrice.toFixed(2)} · $${l.lineTotal.toFixed(2)}${l.confirmedQty !== null ? ` · <span class="ok">confirmed ${l.confirmedQty}</span>` : ''}${l.unavailable ? ' · unavailable' : ''}</div>
      <div class="row"><div><label for="a_${l.id}">Action</label><select id="a_${l.id}" name="action_${l.id}"><option value="confirm">Confirm</option><option value="reduce">Confirm lower qty</option><option value="unavailable">Unavailable</option><option value="substitute">Propose substitute</option></select></div>
      <div><label for="q_${l.id}">Qty you can deliver (${esc(l.unit)})</label><input id="q_${l.id}" name="qty_${l.id}" inputmode="decimal" placeholder="${l.qty}"></div></div>
      <div class="row"><div><label for="sd_${l.id}">Substitute description</label><input id="sd_${l.id}" name="subdesc_${l.id}" maxlength="120"></div><div><label for="sp_${l.id}">Pack size</label><input id="sp_${l.id}" name="subpack_${l.id}" inputmode="decimal"></div><div><label for="su_${l.id}">Unit price $</label><input id="su_${l.id}" name="subprice_${l.id}" inputmode="decimal"></div></div></div>`,
    )
    .join('');
  const form = v.acceptsResponses
    ? `<form method="post" class="card">${lines}<div class="row"><div><label for="eta">Delivery ETA</label><input id="eta" name="eta" maxlength="40" placeholder="e.g. 10:00"></div></div><label for="note">Note to the restaurant</label><textarea id="note" name="note" rows="2" maxlength="1000"></textarea><p></p><button type="submit">Send response</button></form>`
    : `<div class="card">This order is <b>${esc(v.po.status.replace('_', ' '))}</b> and can no longer be changed here.</div>`;
  return page(
    `${v.po.number} — ${v.restaurant}`,
    `<h1>Purchase order ${esc(v.po.number)}</h1><p class="muted">From ${esc(v.restaurant)} to ${esc(v.supplier)} · delivery ${esc(v.po.deliveryDate)} · total $${v.po.total.toFixed(2)}</p>
     ${ok ? `<div class="card ok">Thank you — response v${esc(ok)} received.</div>` : ''}${v.lastResponse ? `<p class="muted">Last response: v${v.lastResponse.version} at ${esc(v.lastResponse.receivedAt)}</p>` : ''}${form}`,
  );
}

function disputePage(token: string, ok?: string) {
  const d = disputeDetail(resolvePortalToken(token, { scope: 'dispute' }).refId);
  const rows = d.variances.map((v) => `<tr><td>${esc(v.type.replace('_', ' '))}</td><td>${esc(v.description)}</td><td>$${v.amount.toFixed(2)}</td></tr>`).join('');
  const form =
    d.status === 'sent'
      ? `<form method="post" class="card"><label for="note">Note (optional)</label><textarea id="note" name="note" rows="2" maxlength="1000"></textarea><p></p><div class="row"><button name="decision" value="accept">Accept — issue credit</button><button name="decision" value="reject" style="background:#8a3b2f">Reject</button></div></form>`
      : `<div class="card">Status: <b>${esc(d.status.replace('_', ' '))}</b></div>`;
  return page(
    `${d.number} credit request`,
    `<h1>Credit request ${esc(d.number)}</h1><p class="muted">Invoice ${esc(d.invoiceNumber)} · order ${esc(d.poNumber)}</p>${ok ? '<div class="card ok">Thank you — your response was recorded.</div>' : ''}
     <div class="card"><p style="white-space:pre-wrap">${esc(d.email_body)}</p><table><tr><th>Type</th><th>Detail</th><th>Amount</th></tr>${rows}</table><p><b>Total requested: $${d.amount_claimed.toFixed(2)}</b></p></div>${form}`,
  );
}

function parseForm(body: Record<string, string>) {
  const lineIds = Object.keys(body)
    .filter((k) => k.startsWith('action_'))
    .map((k) => k.slice(7));
  const num = (s?: string) => (s && s.trim() !== '' ? Number(s.replace(/[$,]/g, '')) : undefined);
  return {
    lines: lineIds.map((id) => {
      const action = body[`action_${id}`] as 'confirm' | 'reduce' | 'unavailable' | 'substitute';
      return {
        poLineId: id,
        action,
        qty: action === 'reduce' ? num(body[`qty_${id}`]) : undefined,
        substitute: action === 'substitute' ? { description: body[`subdesc_${id}`] ?? '', packSize: num(body[`subpack_${id}`]) ?? 0, unitPrice: num(body[`subprice_${id}`]) ?? 0 } : undefined,
      };
    }),
    eta: body.eta?.trim() || undefined,
    note: body.note?.trim() || undefined,
  };
}

export async function portalPages(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.get('/s/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      rateLimit(req, token);
      const scope = resolvePortalToken(token).scope;
      const ok = (req.query as { ok?: string }).ok;
      return reply.header('content-security-policy', CSP).header('cache-control', 'no-store').type('text/html').send(scope === 'po' ? poPage(token, ok) : disputePage(token, ok));
    } catch (e) {
      return errorPage(reply, e);
    }
  });

  app.post('/s/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      rateLimit(req, token);
      const { scope, refId } = resolvePortalToken(token);
      const body = (req.body ?? {}) as Record<string, string>;
      if (scope === 'po') {
        const r = submitSupplierResponse(refId, SupplierResponseSchema.parse(parseForm(body)));
        return reply.redirect(`/s/${token}?ok=${r.version}`, 303);
      }
      supplierDisputeResponse(refId, z.enum(['accept', 'reject']).parse(body.decision), body.note?.trim() || undefined);
      return reply.redirect(`/s/${token}?ok=1`, 303);
    } catch (e) {
      if (e instanceof z.ZodError) return errorPage(reply, new AppError(400, 'VALIDATION_ERROR', `Please check the form: ${e.issues.map((i) => i.message).join('; ')}`));
      return errorPage(reply, e);
    }
  });
}

// JSON API with the same token rules (agent-readable supplier interface; FR-122 is P1, the endpoints are shared).
export async function portalApi(app: FastifyInstance): Promise<void> {
  app.get('/portal/:token', async (req) => {
    const { token } = req.params as { token: string };
    rateLimit(req, token);
    const { scope, refId } = resolvePortalToken(token);
    return scope === 'po' ? { scope, ...portalPoView(refId) } : { scope, dispute: disputeDetail(refId) };
  });
  app.post('/portal/:token/response', async (req) => {
    const { token } = req.params as { token: string };
    rateLimit(req, token);
    const body = z.object({ purchaseOrderId: z.string().optional() }).passthrough().parse(req.body);
    const { refId } = resolvePortalToken(token, { scope: 'po', refId: body.purchaseOrderId });
    return submitSupplierResponse(refId, SupplierResponseSchema.parse(body));
  });
  app.post('/portal/:token/dispute', async (req) => {
    const { token } = req.params as { token: string };
    rateLimit(req, token);
    const b = z.object({ decision: z.enum(['accept', 'reject']), note: z.string().max(1000).optional(), disputeId: z.string().optional() }).parse(req.body);
    const { refId } = resolvePortalToken(token, { scope: 'dispute', refId: b.disputeId });
    return supplierDisputeResponse(refId, b.decision, b.note);
  });
}
