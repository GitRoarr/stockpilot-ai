import { db } from '../db/sqlite.js';
import { tokens } from '../engines/matcher.js';
import { getSettings } from '../lib/settings.js';
import { addDays, localDate, weekday } from '../lib/util.js';
import { menuItems } from '../services/forecast.js';
import type { Turn } from './llm/types.js';
import type { RunInfo } from './tools/types.js';

// Deterministic playbooks (SRS FR-061): the same workflow as the AI agents, as fixed tool sequences. They run through
// the same runtime, policy engine and checkpoints, so drafted POs are identical with or without a model (AC-061).
type Next = { text?: string; calls: { name: string; args: Record<string, unknown> }[] };
type Done = { name: string; args: any; result: any };

export function completedCalls(history: Turn[]): Done[] {
  const calls = new Map<string, { name: string; args: any }>();
  const out: Done[] = [];
  for (const t of history) {
    if (t.role === 'model') for (const c of t.calls) calls.set(c.id, { name: c.name, args: c.args });
    if (t.role === 'tool') for (const r of t.results) out.push({ name: r.name, args: calls.get(r.callId)?.args ?? {}, result: r.result });
  }
  return out;
}

const ok = (r: any) => r && typeof r === 'object' && !('error' in r);

export function nextDeterministic(run: RunInfo, history: Turn[]): Next {
  const done = completedCalls(history);
  const last = (name: string, pred: (d: Done) => boolean = () => true) => [...done].reverse().find((d) => d.name === name && pred(d));
  const has = (name: string, pred?: (d: Done) => boolean) => Boolean(last(name, pred));
  const p = run.payload;

  switch (playbookFor(run)) {
    case 'morning': {
      if (!has('get_team_status')) return { calls: [{ name: 'get_team_status', args: {} }, { name: 'get_inventory_status', args: {} }] };
      if (!has('delegate_task', (d) => d.args.agent === 'demand-planner'))
        return { calls: [{ name: 'delegate_task', args: { agent: 'demand-planner', goal: 'Refresh weather and holiday context and forecast the next 7 days', expectedOutput: 'Forecast summary, high-uncertainty dishes, holiday flags' } }] };
      if (!has('delegate_task', (d) => d.args.agent === 'buyer'))
        return { calls: [{ name: 'delegate_task', args: { agent: 'buyer', goal: "Plan and draft today's orders at the lowest total landed cost", expectedOutput: 'POs drafted, proposals created, saving vs baseline' } }] };
      if (!has('publish_briefing')) return { calls: [{ name: 'publish_briefing', args: {} }] };
      const b = last('publish_briefing')!.result;
      return { text: `Morning run complete. ${b?.summary ?? 'Standup published.'}`, calls: [] };
    }
    case 'forecast': {
      if (!has('refresh_context')) return { calls: [{ name: 'refresh_context', args: {} }] };
      if (!has('get_forecast')) return { calls: [{ name: 'get_forecast', args: { days: 7 } }] };
      const f = last('get_forecast')!.result;
      const weather = f?.contextStatus?.weather_forecast ?? 'unknown';
      const models = [...new Set((f?.items ?? []).map((i: any) => i.model))].join(', ');
      return {
        text: `Forecast ready for ${f?.items?.length ?? 0} dishes (models ${models}). Weather: ${weather === 'ok' ? 'up to date' : weather === 'stale' ? 'cached' : 'Weather unavailable — model without weather used'}.${f?.highUncertainty?.length ? ` High uncertainty: ${f.highUncertainty.join(', ')}.` : ''}`,
        calls: [],
      };
    }
    case 'buy': {
      if (!has('get_reorder_plan')) return { calls: [{ name: 'get_reorder_plan', args: {} }] };
      if (!has('optimize_order')) return { calls: [{ name: 'optimize_order', args: { scope: 'all' } }] };
      const plan = last('optimize_order')!.result;
      if (!ok(plan) || !plan.planId) return { text: 'No items need ordering today.', calls: [] };
      if (plan.violations?.length) return { text: `The cheapest feasible plan still violates: ${plan.violations.join('; ')}. A human decision is needed — no orders were drafted.`, calls: [] };
      if (!has('draft_purchase_orders')) return { calls: [{ name: 'draft_purchase_orders', args: { planId: plan.planId } }] };
      const drafts = last('draft_purchase_orders')!.result;
      const pos: any[] = drafts?.purchaseOrders ?? [];
      const toSend = pos.filter((po) => po.status === 'draft' && !po.minimumWarning && !has('send_purchase_order', (d) => d.args.poId === po.poId));
      if (toSend.length) return { calls: toSend.map((po) => ({ name: 'send_purchase_order', args: { poId: po.poId } })) };
      const total = plan.total?.toFixed?.(2);
      const missing = plan.notSourced?.length ? ` No supplier offer yet for: ${plan.notSourced.join(', ')} — add one in Inventory → Offers.` : '';
      return { text: `Drafted ${pos.length} order(s) for $${total} — $${plan.saving?.toFixed?.(2)} less than ordering from the preferred suppliers ($${plan.baselineTotal?.toFixed?.(2)}). Sending needs approval in the Inbox.${missing}`, calls: [] };
    }
    case 'supplier_response': {
      if ((p.shortages?.length ?? 0) > 0) {
        if (!has('optimize_order')) return { calls: [{ name: 'optimize_order', args: { scope: 'shortage', poId: p.poId } }] };
        const plan = last('optimize_order')!.result;
        if (ok(plan) && plan.planId && !plan.violations?.length && !has('draft_purchase_orders')) return { calls: [{ name: 'draft_purchase_orders', args: { planId: plan.planId } }] };
        const drafts = last('draft_purchase_orders')?.result;
        const toSend = (drafts?.purchaseOrders ?? []).filter((po: any) => po.status === 'draft' && !has('send_purchase_order', (d) => d.args.poId === po.poId));
        if (toSend.length) return { calls: toSend.map((po: any) => ({ name: 'send_purchase_order', args: { poId: po.poId } })) };
      }
      for (const actionId of p.substitutionActions ?? []) {
        if (has('ask_human', (d) => d.args.actionId === actionId)) continue;
        const a = db().get<{ summary: string; args_json: string; status: string }>(`SELECT summary, args_json, status FROM agent_actions WHERE id = ?`, actionId);
        if (!a || a.status !== 'proposed') continue;
        const flagged = JSON.parse(a.args_json).flagged;
        return { calls: [{ name: 'ask_human', args: { question: `${a.summary}?`, options: ['Yes', 'No'], recommended: flagged ? 'No' : 'Yes', actionId } }] };
      }
      const plan = last('optimize_order')?.result;
      const parts: string[] = [];
      if (plan?.planId && plan.violations?.length) parts.push(`No feasible cover for the shortfall: ${plan.violations.join('; ')}`);
      else if (plan?.planId) parts.push(`Shortfall covered by a supplementary order for $${plan.total.toFixed(2)} — waiting for approval in the Inbox`);
      else if (plan) parts.push('No shortfall to cover');
      for (const q of done.filter((d) => d.name === 'ask_human')) parts.push(`Substitution: ${q.result?.answer ?? 'no answer'}`);
      return { text: parts.length ? `${parts.join('. ')}.` : 'Supplier response recorded; nothing to replan.', calls: [] };
    }
    case 'po_deadline': {
      if (!has('send_supplier_followup')) return { calls: [{ name: 'send_supplier_followup', args: { poId: p.poId } }] };
      const r = last('send_supplier_followup')!.result;
      return { text: r?.escalated ? 'Still no confirmation after the reminder — escalated to the chef.' : r?.emailId ? 'Sent one reminder to the supplier and notified the chef.' : 'The order no longer needs a follow-up.', calls: [] };
    }
    case 'invoice_variances': {
      if (!has('get_invoice_match')) return { calls: [{ name: 'get_invoice_match', args: { invoiceId: p.invoiceId } }] };
      const m = last('get_invoice_match')!.result;
      if (!ok(m)) return { text: 'Could not read the invoice match.', calls: [] };
      if (m.varianceTotal < getSettings().disputeMinimum) return { text: `Variances of $${m.varianceTotal.toFixed(2)} are below the dispute minimum; no dispute opened.`, calls: [] };
      if (!has('open_dispute')) return { calls: [{ name: 'open_dispute', args: { invoiceId: p.invoiceId } }] };
      const d = last('open_dispute')!.result;
      if (ok(d) && d.disputeId && d.status === 'draft' && !has('send_dispute_email')) return { calls: [{ name: 'send_dispute_email', args: { disputeId: d.disputeId } }] };
      return { text: `Dispute ${d?.number ?? ''} drafted for $${(d?.amountClaimed ?? m.varianceTotal).toFixed(2)}; sending it needs approval.`, calls: [] };
    }
    case 'dispute_accepted': {
      if (!has('record_credit')) return { calls: [{ name: 'record_credit', args: { disputeId: p.disputeId } }] };
      const r = last('record_credit')!.result;
      return { text: ok(r) && r.status ? `Credit recorded: $${Number(r.amountCredited ?? 0).toFixed(2)} (${r.status}).` : 'Credit recording needs approval.', calls: [] };
    }
    case 'delivery_received':
      return { text: `Delivery received for ${p.poNumber ?? 'the order'}. Upload the invoice photo and I will run the three-way match.`, calls: [] };
    default:
      return chatPlaybook(run, done);
  }
}

export function playbookFor(run: RunInfo): string {
  if (run.playbook !== 'delegated') return run.playbook;
  if (run.agentId === 'demand-planner') return /event|party|guests|covers/i.test(run.payload.goal ?? '') ? 'chat' : 'forecast';
  if (run.agentId === 'buyer') return 'buy';
  if (run.agentId === 'ap-clerk') return run.payload.inputs?.invoiceId ? 'invoice_variances' : 'chat';
  return 'chat';
}

// ── Rule-based chat (FR-061: structured quick actions instead of free text) ──
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseEventCommand(msg: string): { date: string; covers: number; items: { menuItem: string; qty: number }[]; description: string } | null {
  const m = msg.match(/\b(?:party|event|group|booking|reservation|catering)\b[^\d]{0,20}(\d{1,3})|(\d{1,3})\s*(?:guests|covers|people|pax)/i);
  if (!m) return null;
  const covers = Number(m[1] ?? m[2]);
  const today = localDate();
  let date: string | null = null;
  const iso = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) date = iso[1];
  else if (/\btomorrow\b/i.test(msg)) date = addDays(today, 1);
  else if (/\btoday|tonight\b/i.test(msg)) date = today;
  else {
    const d = DAYS.findIndex((x) => new RegExp(`\\b${x}\\b`, 'i').test(msg));
    if (d >= 0) date = addDays(today, (d - weekday(today) + 7) % 7);
  }
  if (!date) return null;
  const items: { menuItem: string; qty: number }[] = [];
  const mostly = msg.match(/mostly\s+([a-z ]+?)(?:[.,!]|$)/i);
  if (mostly) {
    const word = mostly[1].trim().replace(/s$/, '').toLowerCase();
    const matches = menuItems().filter((i) => i.name.toLowerCase().includes(word));
    if (matches.length) {
      const share = Math.round((covers * 0.7) / matches.length);
      for (const it of matches) items.push({ menuItem: it.name, qty: share });
    }
  }
  return { date, covers, items, description: msg.trim().slice(0, 200) };
}

function findIngredient(msg: string): { id: string; name: string } | null {
  const t = new Set(tokens(msg));
  let best: { id: string; name: string; score: number } | null = null;
  for (const ing of db().all<{ id: string; name: string }>(`SELECT id, name FROM ingredients WHERE active = 1`)) {
    const it = tokens(ing.name);
    const score = it.filter((w) => t.has(w) || t.has(`${w}s`) || t.has(w.replace(/s$/, ''))).length / it.length;
    if (score > 0 && (!best || score > best.score)) best = { ...ing, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

function chatPlaybook(run: RunInfo, done: Done[]): Next {
  const msg: string = run.payload.message ?? run.payload.goal ?? '';
  const reason = run.payload.fallbackReason ?? 'no_api_key';
  const has = (n: string) => done.some((d) => d.name === n);
  const last = (n: string) => [...done].reverse().find((d) => d.name === n);

  const never = msg.match(/\b(?:never|don't|do not|stop)\s+(?:order|buy)(?:ing)?\s+(.+?)\s+from\s+(.+?)(?:[.!]|$)/i);
  if (never && !has('propose_working_agreement')) {
    const sup = db().all<{ id: string; name: string }>(`SELECT id, name FROM suppliers`).find((s) => s.name.toLowerCase().includes(never[2].trim().toLowerCase().split(' ')[0]));
    const what = never[1].trim().toLowerCase();
    const cat = db().get<{ category: string }>(`SELECT DISTINCT category FROM ingredients WHERE lower(category) = ? OR lower(category) = ?`, what, what.replace(/s$/, ''));
    const ing = cat ? null : findIngredient(what);
    if (sup && (cat || ing))
      return { calls: [{ name: 'propose_working_agreement', args: { agreement: { type: 'exclude_supplier', params: { supplierId: sup.id, ...(cat ? { category: cat.category } : { ingredientId: ing!.id }) } }, rationale: `Instruction in a thread: "${msg.slice(0, 160)}"`, evidenceIds: [run.payload.messageId].filter(Boolean) } }] };
  }
  if (has('propose_working_agreement')) return { text: 'I proposed this as a working agreement. It takes effect after the Owner approves it in Settings → Working agreements.', calls: [] };

  const ev = parseEventCommand(msg);
  if (ev) {
    if (run.agentId === 'demand-planner') {
      if (!has('add_demand_event')) return { calls: [{ name: 'add_demand_event', args: { date: ev.date, description: ev.description, extraCovers: ev.covers, items: ev.items.length ? ev.items : undefined } }] };
      const r = last('add_demand_event')!.result;
      return { text: r?.status === 'pending_approval' ? `Demand event for ${ev.date} proposed — approve it in the Inbox and the forecast and orders will update.` : `Demand event for ${ev.date} recorded; the forecast now includes it.`, calls: [] };
    }
    if (run.agentId === 'pilot') {
      if (!has('delegate_task')) return { calls: [{ name: 'delegate_task', args: { agent: 'demand-planner', goal: msg.slice(0, 480), expectedOutput: 'Demand event recorded or proposed' } }] };
      return { text: `Demand Planner handled it: ${last('delegate_task')!.result?.finalMessage ?? 'see the task'}`, calls: [] };
    }
  }

  const ing = findIngredient(msg);
  if (run.agentId === 'buyer' && ing && /cheap|price|supplier|cost|offer/i.test(msg)) {
    if (!has('get_supplier_offers')) return { calls: [{ name: 'get_supplier_offers', args: { ingredient: ing.id } }] };
    // Supplier choice depends on the whole order (fees, minimums), so cite this ingredient's line in today's full plan.
    if (!has('optimize_order')) return { calls: [{ name: 'optimize_order', args: { scope: 'all' } }] };
    const offers = last('get_supplier_offers')!.result?.offers ?? [];
    const plan = last('optimize_order')!.result;
    const list = [...offers].sort((a: any, b: any) => a.unitPrice - b.unitPrice).map((o: any) => `${o.supplier} $${o.unitPrice.toFixed(2)}/${last('get_supplier_offers')!.result.unit} (pack ${o.packSize}${o.preferred ? ', preferred' : ''})`);
    const chosen = plan?.lines?.find((l: any) => l.ingredientId === ing.id);
    return {
      text: `${ing.name} offers: ${list.join('; ')}. ${chosen ? `Optimiser result for today's order: ${chosen.supplier} — ${chosen.why ?? 'lowest landed cost'} (full order $${plan.total.toFixed(2)} vs $${plan.baselineTotal.toFixed(2)} from preferred suppliers).` : 'No need to order it right now, so the optimiser has nothing to split.'} Any PO change would be a proposal within your approval limit.`,
      calls: [],
    };
  }
  if (run.agentId === 'demand-planner' && /forecast|demand|expect|busy/i.test(msg)) {
    if (!has('get_forecast')) return { calls: [{ name: 'get_forecast', args: { days: 7 } }] };
    const f = last('get_forecast')!.result;
    const top = [...(f.items ?? [])].sort((a: any, b: any) => (b.next?.[1]?.qty ?? 0) - (a.next?.[1]?.qty ?? 0)).slice(0, 3);
    return { text: `Tomorrow's top dishes: ${top.map((i: any) => `${i.name} ${i.next?.[1]?.qty}`).join(', ')}.`, calls: [] };
  }
  return {
    text: `AI is not available right now (${reason}), so I can only run structured quick actions: "Run morning now", "Private party of 40 on Saturday", "@Buyer find a cheaper supplier for chicken thigh", "Never order fish from Golden Gate".`,
    calls: [],
  };
}
