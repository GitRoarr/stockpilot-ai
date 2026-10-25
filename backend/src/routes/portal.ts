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

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// Light, document-style pages (no scripts; the CSP allows inline styles only). Colours match the StockPilot app.
function page(title: string, body: string, restaurant?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>
:root{color-scheme:light;--bg:#f6f5f1;--surface:#fff;--muted-bg:#f4f3ef;--ink:#1c201e;--muted:#646a66;--line:#e7e4dd;--line-strong:#d6d2c9;--accent:#0f6e56;--accent-hover:#0b5a46;--accent-soft:#eaf3ef;--warn:#8a4807;--warn-bg:#fff8eb;--ok:#15803d;--ok-bg:#ecf8f0;--danger:#a82424}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
.top{background:var(--surface);border-bottom:1px solid var(--line)}
.top div{max-width:860px;margin:auto;padding:12px 20px;display:flex;align-items:center;gap:10px;font-size:13px}

.top b{font-size:14px}.top .who{margin-left:auto;color:var(--muted)}
main{max-width:860px;margin:auto;padding:24px 20px 48px}
.eyebrow{font-size:12px;font-weight:600;color:var(--accent);letter-spacing:.04em;text-transform:uppercase;margin:0}
h1{font-size:22px;line-height:1.25;margin:4px 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin:0 0 16px;box-shadow:0 1px 2px rgb(28 32 30/.05)}
.pad{padding:18px 20px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border-bottom:1px solid var(--line)}
.facts div{padding:14px 20px;border-right:1px solid var(--line)}.facts div:last-child{border-right:0}
.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:2px 0 0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.section{padding:12px 20px;border-bottom:1px solid var(--line);background:var(--muted-bg);font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-radius:10px 10px 0 0}
.line{padding:16px 20px;border-bottom:1px solid var(--line);display:grid;gap:12px}
.line:last-of-type{border-bottom:0}
.item{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px}
.item b{font-size:15px}.sku{font-size:12px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}
.nums{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--muted)}.nums strong{color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.subst{border:1px dashed var(--line-strong);border-radius:8px;padding:10px 12px;display:grid;gap:8px}
.subst p{margin:0;font-size:12px;color:var(--muted)}
label{display:block;font-size:12px;font-weight:600;margin:0 0 4px}
input,select,textarea{font:inherit;width:100%;padding:8px 10px;border:1px solid var(--line-strong);border-radius:6px;background:#fff;color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
option{color:var(--ink);background:#fff}
.foot{padding:16px 20px;border-top:1px solid var(--line);display:grid;gap:12px;background:var(--muted-bg);border-radius:0 0 10px 10px}
button{font:inherit;font-weight:600;background:var(--accent);color:#fff;border:0;border-radius:7px;padding:11px 18px;cursor:pointer}
button:hover{background:var(--accent-hover)}button.reject{background:#fff;color:var(--danger);border:1px solid #eda5a5}button.reject:hover{background:#fdf0f0}
.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
.badge{display:inline-block;font-size:11px;font-weight:600;border-radius:5px;padding:1px 7px;border:1px solid}
.b-ok{color:var(--ok);background:var(--ok-bg);border-color:#bfe6cc}.b-warn{color:var(--warn);background:var(--warn-bg);border-color:#f8d993}.b-gray{color:var(--muted);background:var(--muted-bg);border-color:var(--line)}
.notice{border-radius:8px;padding:12px 14px;margin:0 0 16px;border:1px solid}
.notice.ok{background:var(--ok-bg);border-color:#bfe6cc;color:#166534}.notice.info{background:var(--muted-bg);border-color:var(--line);color:var(--muted)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 20px;border-bottom:1px solid var(--line);font-size:13px}th{font-size:12px;color:var(--muted);font-weight:600;background:var(--muted-bg)}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}tr.total td{font-weight:700;border-bottom:0}
.help{font-size:12px;color:var(--muted);margin:0}
@media (max-width:560px){.nums{margin-left:0}.facts div{border-right:0;border-bottom:1px solid var(--line)}th,td{padding:8px 12px}}
</style></head><body><div class="top"><div><img src="/logo.png" alt="" width="28" height="28" style="display:block;border-radius:6px"><b>StockPilot AI</b><span style="color:var(--muted)">· Supplier portal</span>${restaurant ? `<span class="who">${esc(restaurant)}</span>` : ''}</div></div><main>${body}</main></body></html>`;
}

const STATUS_BADGE = (status: string) => {
  const cls = ['confirmed', 'received', 'credited', 'closed'].includes(status) ? 'b-ok' : ['sent', 'partially_confirmed', 'acknowledged'].includes(status) ? 'b-warn' : 'b-gray';
  return `<span class="badge ${cls}">${esc(status.replace(/_/g, ' '))}</span>`;
};

function errorPage(reply: FastifyReply, e: unknown) {
  const err = e instanceof AppError ? e : new AppError(500, 'INTERNAL', 'Something went wrong');
  const title = err.status === 410 ? 'This link is no longer valid' : err.status === 404 ? 'Link not found' : 'Something went wrong';
  return reply
    .status(err.status)
    .header('content-security-policy', CSP)
    .type('text/html')
    .send(page('Link problem', `<div class="card pad"><h1>${title}</h1><p class="sub" style="margin:0">${esc(err.message)}</p><p class="help" style="margin-top:12px">Please contact the restaurant for a new link.</p></div>`));
}

function poPage(token: string, ok?: string) {
  const v = portalPoView(resolvePortalToken(token, { scope: 'po' }).refId);
  const lines = v.lines
    .map(
      (l) => `<div class="line">
        <div class="item"><b>${esc(l.item)}</b><span class="sku">${esc(l.sku)}</span>${l.confirmedQty !== null ? `<span class="badge b-ok">confirmed ${l.confirmedQty}</span>` : ''}${l.unavailable ? '<span class="badge b-warn">unavailable</span>' : ''}
          <span class="nums">${l.packs} × ${l.packSize} ${esc(l.unit)} = ${l.qty} ${esc(l.unit)} · $${l.unitPrice.toFixed(2)}/${esc(l.unit)} · <strong>$${l.lineTotal.toFixed(2)}</strong></span></div>
        <div class="grid"><div><label for="a_${l.id}">Action</label><select id="a_${l.id}" name="action_${l.id}"><option value="confirm">Confirm</option><option value="reduce">Confirm lower qty</option><option value="unavailable">Unavailable</option><option value="substitute">Propose substitute</option></select></div>
          <div><label for="q_${l.id}">Qty you can deliver (${esc(l.unit)})</label><input id="q_${l.id}" name="qty_${l.id}" inputmode="decimal" placeholder="${l.qty}"></div></div>
        <div class="subst"><p>Only if proposing a substitute</p><div class="grid"><div><label for="sd_${l.id}">Substitute description</label><input id="sd_${l.id}" name="subdesc_${l.id}" maxlength="120"></div><div><label for="sp_${l.id}">Pack size</label><input id="sp_${l.id}" name="subpack_${l.id}" inputmode="decimal"></div><div><label for="su_${l.id}">Unit price $</label><input id="su_${l.id}" name="subprice_${l.id}" inputmode="decimal"></div></div></div>
      </div>`,
    )
    .join('');
  const facts = `<dl class="facts" style="margin:0"><div><dt>From</dt><dd>${esc(v.restaurant)}</dd></div><div><dt>Delivery date</dt><dd>${esc(v.po.deliveryDate)}</dd></div><div><dt>Items</dt><dd>${v.lines.length}</dd></div><div><dt>Order total</dt><dd>$${v.po.total.toFixed(2)}</dd></div></dl>`;
  const form = v.acceptsResponses
    ? `<form method="post" class="card">${facts}<div class="section" style="border-radius:0">Your response, line by line</div>${lines}
        <div class="foot"><div class="grid"><div><label for="eta">Delivery ETA</label><input id="eta" name="eta" maxlength="40" placeholder="e.g. 10:00"></div></div><div><label for="note">Note to the restaurant</label><textarea id="note" name="note" rows="2" maxlength="1000"></textarea></div>
        <div class="actions"><button type="submit">Send response</button></div><p class="help">You can send an updated response later from this page; the latest one counts.</p></div></form>`
    : `<div class="card">${facts}<div class="pad">This order is ${STATUS_BADGE(v.po.status)} and can no longer be changed here. Please contact ${esc(v.restaurant)} directly for changes.</div></div>`;
  return page(
    `${v.po.number} — ${v.restaurant}`,
    `<p class="eyebrow">Purchase order</p><h1>Purchase order ${esc(v.po.number)}</h1><p class="sub">For ${esc(v.supplier)} · ${STATUS_BADGE(v.po.status)}${v.lastResponse ? ` · last response v${v.lastResponse.version}` : ''}</p>
     ${ok ? `<div class="notice ok">Thank you — response v${esc(ok)} received. ${esc(v.restaurant)} has been notified.</div>` : ''}${form}`,
    v.restaurant,
  );
}

function disputePage(token: string, ok?: string) {
  const d = disputeDetail(resolvePortalToken(token, { scope: 'dispute' }).refId);
  const rows = d.variances.map((v) => `<tr><td>${esc(v.type.replace('_', ' '))}</td><td>${esc(v.description)}</td><td class="r">$${v.amount.toFixed(2)}</td></tr>`).join('');
  const form =
    d.status === 'sent'
      ? `<form method="post" class="card"><div class="pad" style="display:grid;gap:12px"><div><label for="note">Note (optional)</label><textarea id="note" name="note" rows="2" maxlength="1000" placeholder="e.g. credit note number"></textarea></div>
          <div class="actions"><button name="decision" value="reject" class="reject">Reject</button><button name="decision" value="accept">Accept — issue credit</button></div></div></form>`
      : `<div class="notice info">Status: ${STATUS_BADGE(d.status)} — no further action is needed.</div>`;
  return page(
    `${d.number} credit request`,
    `<p class="eyebrow">Credit request</p><h1>Credit request ${esc(d.number)}</h1><p class="sub">Invoice ${esc(d.invoiceNumber)} · order ${esc(d.poNumber)} · ${STATUS_BADGE(d.status)}</p>${ok ? '<div class="notice ok">Thank you — your response was recorded.</div>' : ''}
     <div class="card"><div class="pad"><p style="white-space:pre-wrap;margin:0">${esc(d.email_body)}</p></div>
     <table><tr><th>Difference</th><th>Detail</th><th class="r">Amount</th></tr>${rows}<tr class="total"><td colspan="2">Total credit requested</td><td class="r">$${d.amount_claimed.toFixed(2)}</td></tr></table></div>${form}`,
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
