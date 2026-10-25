import { useState, type ReactNode } from 'react';
import { AreaChart, Donut, Progress, Sparkline } from '../components/charts';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bot, CalendarClock, ChartLine, CheckCircle2, CircleHelp, ClipboardCheck, CloudRain, Hourglass, Inbox, Info, Lightbulb, PackageX, Play, Receipt, Scale, ShieldCheck, ShoppingCart, TrendingDown, TrendingUp, Truck, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { api, post } from '../api/client';
import { AgentAvatar } from '../components/AgentAvatar';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { agentName, ago, Badge, Button, Card, cx, day, dt, Empty, ErrorCard, fallbackText, ModeBadge, num, PageHeader, pct, Q, Stat, Status, Tabs, time, usd } from '../components/ui';

// Today: the restaurant's operational command center. Every figure comes from /dashboard and /inbox (engines and
// records); nothing on this page is estimated in the browser.
const REF_LINK: Record<string, (id: string) => string> = {
  action: () => '/inbox',
  question: () => '/inbox',
  purchase_order: (id) => `/orders/${id}`,
  dispute: (id) => `/disputes/${id}`,
  task: (id) => `/tasks/${id}`,
  ingredient: () => '/inventory',
};

export function TodayPage({ me }: { me: Me }) {
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard') });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const run = useMutation({
    mutationFn: () => post<{ runId: string }>('/agent-runs', { kind: 'morning' }),
    onSuccess: (r) => {
      toast('info', 'Morning plan started', 'Pilot is delegating to Demand Planner and Buyer.');
      nav(`/activity/runs/${r.runId}`);
    },
    onError: (e) => toast('error', 'Could not start the morning plan', (e as Error).message),
  });
  const staff = me.user.role === 'staff';
  const canRun = !staff;
  const hour = new Date().getHours();
  const d = q.data;
  const waiting = d ? d.decisions.proposals + d.decisions.questions + d.decisions.agreements : 0;
  return (
    <div className="space-y-4">
      <div className="home-hero rounded-lg border border-transparent dark:px-5 dark:py-5">
        <PageHeader
          title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${me.user.name.split(' ')[0]}`}
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              {d ? `${day(d.date)} · ${d.restaurant}` : '…'}
              {d?.lastMorningRun ? (
                <>
                  <span aria-hidden>·</span> Morning plan {dt(d.lastMorningRun.started_at)} <Status s={d.lastMorningRun.status} /> {d.lastMorningRun.mode === 'deterministic' && <ModeBadge mode="deterministic" reason={d.lastMorningRun.fallback_reason} />}
                </>
              ) : (
                d && (
                  <>
                    <span aria-hidden>·</span> No morning plan yet today
                  </>
                )
              )}
            </span>
          }
          actions={
            <>
              {staff ? (
                <Link to="/receiving" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent shadow-card hover:bg-accent-strong">
                  <Truck aria-hidden className="h-4 w-4" /> Receive deliveries
                </Link>
              ) : (
                <Link to="/inbox" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-sm font-medium shadow-card hover:bg-raised">
                  <Inbox aria-hidden className="h-4 w-4" /> Review decisions
                  {waiting > 0 && <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold tabular-nums text-amber-800">{waiting}</span>}
                </Link>
              )}
              {canRun && (
                <Button variant="primary" icon={Play} busy={run.isPending} onClick={() => run.mutate()}>
                  Run morning plan
                </Button>
              )}
            </>
          }
        />
      </div>
      {run.error && <ErrorCard error={run.error} />}

      <Q q={q}>
        {(d) =>
          staff ? (
            // Staff: the receiving desk — deliveries, receiving issues, stock at risk and the week ahead (SRS US-08, FR-080).
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="min-w-0 space-y-5 xl:col-span-2">
                <Deliveries rows={d.deliveries} />
                <InventoryAtRisk d={d} />
              </div>
              <div className="min-w-0 space-y-5">
                <ReceivingIssues r={{ ...d.receiving, disputes: [] }} title="Invoices to review" />
                <InventoryHealth h={d.inventoryHealth} />
                <Outlook d={d} link={false} />
              </div>
            </div>
          ) : (
          <div className="space-y-5">
            <KpiCards d={d} />
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="min-w-0 space-y-5 xl:col-span-2">
                <NeedsAttention d={d} inbox={inbox.data} />
                <Overview d={d} />
                <Decisions inbox={inbox.data} loading={inbox.isLoading} />
                <InventoryAtRisk d={d} />
                <Standup d={d} canRun={canRun} onRun={() => run.mutate()} />
              </div>
              <div className="min-w-0 space-y-5">
                <CostAndSavings d={d} />
                <SpendBySupplier rows={d.spendBySupplier} />
                <InventoryHealth h={d.inventoryHealth} />
                <Deliveries rows={d.deliveries} />
                <ReceivingIssues r={d.receiving} />
                <Outlook d={d} />
                <Activity d={d} />
              </div>
            </div>
          </div>
          )
        }
      </Q>
    </div>
  );
}

// ── KPI cards: real series only (sales history, forecast, purchase orders, optimiser plan).
const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);
const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

function Delta({ pct: p, suffix }: { pct: number | null; suffix: string }) {
  if (p === null) return <span className="text-xs text-muted">{suffix}</span>;
  const up = p >= 0;
  const Ico = up ? TrendingUp : TrendingDown;
  return (
    <span className="flex flex-wrap items-center gap-x-1 text-xs">
      <span className={cx('flex items-center gap-1 font-semibold', up ? 'text-emerald-700' : 'text-red-700')}>
        <Ico aria-hidden className="h-3.5 w-3.5" />
        {up ? '+' : ''}
        {p.toFixed(1)}%
      </span>
      <span className="text-muted">{suffix}</span>
    </span>
  );
}

function KpiCard({ label, value, icon: Ico, chip, delta, series, color, to }: { label: string; value: ReactNode; icon: LucideIcon; chip: string; delta: ReactNode; series?: number[]; color: string; to: string }) {
  return (
    <Link to={to} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
          <div className="mt-1.5">{delta}</div>
        </div>
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', chip)}>
          <Ico aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-auto pt-2">{series && series.length > 1 ? <Sparkline data={series} color={color} className="h-12 w-full" /> : <div className="h-12" />}</div>
    </Link>
  );
}

function KpiCards({ d }: { d: any }) {
  const sales = d.trends.sales as { date: string; value: number }[];
  const spend = d.trends.orderSpend as { date: string; value: number }[];
  const fc = d.trends.forecast as { date: string; value: number }[];
  const y = sales[sales.length - 1];
  const lastWeek = sales[sales.length - 8];
  const s7 = sum(spend.slice(-7));
  const p7 = sum(spend.slice(-14, -7));
  const plan = d.purchasing.plan;
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Portions sold yesterday"
        value={num(y?.value ?? 0, 0)}
        icon={UtensilsCrossed}
        chip="bg-emerald-50 text-emerald-700"
        delta={<Delta pct={y && lastWeek ? change(y.value, lastWeek.value) : null} suffix="vs same day last week" />}
        series={sales.slice(-14).map((x) => x.value)}
        color="var(--chart-primary)"
        to="/inventory?tab=sales"
      />
      <KpiCard
        label="Forecast today"
        value={`${num(fc[0]?.value ?? 0, 0)} portions`}
        icon={ChartLine}
        chip="bg-[#e6f6f4] text-[#0e7c70] dark:bg-[#0e9f8f]/15 dark:text-[#5fd3c4]"
        delta={<span className="text-xs text-muted">{num(sum(fc), 0)} over the next 7 days</span>}
        series={fc.map((x) => x.value)}
        color="#0e9f8f"
        to="/forecast"
      />
      <KpiCard
        label="Order spend, last 7 days"
        value={usd(s7)}
        icon={ShoppingCart}
        chip="bg-blue-50 text-blue-700"
        delta={<Delta pct={change(s7, p7)} suffix="vs previous 7 days" />}
        series={spend.slice(-14).map((x) => x.value)}
        color="#3b82f6"
        to="/orders"
      />
      <KpiCard
        label="Plan saving"
        value={plan ? usd(plan.saving) : '—'}
        icon={Wallet}
        chip="bg-amber-50 text-amber-700"
        delta={<span className="text-xs text-muted">{plan ? `${pct(plan.savingPct)} below preferred suppliers` : 'Run the morning plan'}</span>}
        color="#f59e0b"
        to="/savings"
      />
    </div>
  );
}

const OVERVIEW_TABS = [
  ['sales', 'Portions sold'],
  ['spend', 'Order spend'],
] as const;

function Overview({ d }: { d: any }) {
  const [tab, setTab] = useState<'sales' | 'spend'>('sales');
  return (
    <Card
      title="Overview"
      subtitle={tab === 'sales' ? 'Daily portions sold over 28 days, then the 7-day forecast (dashed)' : 'Value of purchase orders created per day'}
      actions={<Tabs label="Overview series" value={tab} onChange={setTab} options={OVERVIEW_TABS} />}
    >
      {tab === 'sales' ? <AreaChart label="Portions sold and forecast" actual={d.trends.sales} projected={d.trends.forecast.slice(1)} /> : <AreaChart label="Order spend per day" actual={d.trends.orderSpend} format={(n) => `$${n.toLocaleString('en-US')}`} />}
    </Card>
  );
}

function SpendBySupplier({ rows }: { rows: { supplier: string; total: number; orders: number }[] }) {
  return (
    <Card title="Open spend by supplier" subtitle="Orders awaiting approval or in progress">
      {rows.length ? <Donut items={rows.map((r) => ({ label: r.supplier, value: r.total }))} centerLabel="open orders" format={(n) => usd(n).replace(/\.\d\d$/, '')} /> : <p className="text-sm text-muted">No open orders.</p>}
    </Card>
  );
}

function InventoryHealth({ h }: { h: { ok: number; low: number; critical: number; expiring: number; total: number } }) {
  return (
    <Card
      title="Inventory health"
      subtitle={`${h.total} ingredients against the forecast`}
      actions={
        <Link to="/inventory" className="text-xs font-medium text-accent hover:underline">
          View all
        </Link>
      }
    >
      <div className="space-y-4">
        <Progress label="Covered" value={h.ok} max={h.total} detail={`${h.ok} ingredients have enough stock`} tone="var(--chart-primary)" />
        <Progress label="Running low" value={h.low} max={h.total} detail={`${h.low} below the reorder point`} tone="#f59e0b" />
        <Progress label="Critical" value={h.critical} max={h.total} detail={`${h.critical} under one day of cover`} tone="#dc2626" />
        <Progress label="Expiring soon" value={h.expiring} max={h.total} detail={`${h.expiring} with stock at risk of expiry`} tone="#3b82f6" />
      </div>
    </Card>
  );
}

// ── What needs attention, ranked: blocking questions and supplier failures first, then stock, receiving, approvals.
type Item = { tone: 'red' | 'amber' | 'blue'; icon: LucideIcon; title: string; detail?: string; to: string; cta: string };

function NeedsAttention({ d, inbox }: { d: any; inbox: any }) {
  const items: Item[] = [];
  const questions = inbox?.questions ?? [];
  if (questions.length) items.push({ tone: 'red', icon: CircleHelp, title: `${questions.length} question${questions.length === 1 ? '' : 's'} from the team`, detail: questions[0].text, to: '/inbox', cta: 'Answer' });
  for (const i of d.supplierIssues.filter((x: any) => x.severity === 'red').slice(0, 3)) items.push({ tone: 'red', icon: Truck, title: `${i.number} · ${i.supplier}`, detail: i.detail, to: `/orders/${i.poId}`, cta: 'Open order' });
  if (d.stock.critical.length)
    items.push({ tone: 'red', icon: PackageX, title: `${d.stock.critical.length} ingredient${d.stock.critical.length === 1 ? '' : 's'} critically low`, detail: d.stock.critical.map((c: any) => `${c.name} (${num(c.daysOfCover)} d)`).join(', '), to: '/inventory', cta: 'View stock' });
  const toReview = d.receiving.invoices.filter((i: any) => !i.disputeId);
  if (toReview.length) items.push({ tone: 'red', icon: Receipt, title: `${toReview.length} invoice${toReview.length === 1 ? '' : 's'} with discrepancies`, detail: toReview.map((i: any) => `${i.number ?? 'draft'} ${i.supplier} ${usd(i.variance)}`).join(', '), to: `/receiving/invoices/${toReview[0].id}`, cta: 'Review' });
  if (d.purchasing.pendingApproval.count)
    items.push({ tone: 'amber', icon: ClipboardCheck, title: `${d.purchasing.pendingApproval.count} order${d.purchasing.pendingApproval.count === 1 ? '' : 's'} awaiting approval`, detail: `${usd(d.purchasing.pendingApproval.total)} in total${d.purchasing.pendingApproval.saving > 0 ? ` · ${usd(d.purchasing.pendingApproval.saving)} cheaper than preferred suppliers` : ''}`, to: '/inbox', cta: 'Review' });
  const otherDecisions = (inbox?.proposals ?? []).filter((p: any) => p.tool !== 'send_purchase_order').length + (inbox?.agreements ?? []).length;
  if (otherDecisions) items.push({ tone: 'amber', icon: Inbox, title: `${otherDecisions} other decision${otherDecisions === 1 ? '' : 's'} waiting`, detail: 'Disputes, order changes or standing rules proposed by the team', to: '/inbox', cta: 'Review' });
  const changed = (inbox?.supplierUpdates ?? []).filter((u: any) => u.reduced + u.unavailable + u.substituted > 0 && Date.now() - Date.parse(u.receivedAt) < 2 * 864e5);
  if (changed.length) items.push({ tone: 'amber', icon: Truck, title: `${changed.length} supplier response${changed.length === 1 ? '' : 's'} with changes`, detail: changed.map((u: any) => `${u.number} ${u.supplier}`).join(', '), to: '/inbox', cta: 'View' });
  for (const i of d.supplierIssues.filter((x: any) => x.severity === 'amber').slice(0, 2)) items.push({ tone: 'amber', icon: Truck, title: `${i.number} · ${i.supplier}`, detail: i.detail, to: `/orders/${i.poId}`, cta: 'Open order' });
  if (d.stock.valueAtRisk > 0) items.push({ tone: 'amber', icon: Hourglass, title: `${usd(d.stock.valueAtRisk)} of stock may expire`, detail: d.stock.expiryRisks.map((x: any) => x.name).join(', '), to: '/inventory', cta: 'View' });
  if (d.stock.low.length) items.push({ tone: 'amber', icon: PackageX, title: `${d.stock.low.length} ingredient${d.stock.low.length === 1 ? '' : 's'} running low`, detail: d.stock.low.map((c: any) => c.name).join(', '), to: '/inventory', cta: 'View' });
  const dueToday = d.deliveries.filter((x: any) => x.deliveryDate === d.date);
  if (dueToday.length) items.push({ tone: 'blue', icon: CalendarClock, title: `${dueToday.length} deliver${dueToday.length === 1 ? 'y' : 'ies'} due today`, detail: dueToday.map((x: any) => `${x.number} ${x.supplier}`).join(', '), to: '/receiving', cta: 'Receive' });

  const red = items.filter((i) => i.tone === 'red').length;
  return (
    <Card title="Needs attention" icon={AlertTriangle} pad={false} actions={items.length > 0 && <span className="text-xs text-muted">{red ? `${red} urgent · ` : ''}{items.length} item{items.length === 1 ? '' : 's'}</span>}>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((i, k) => (
            <li key={k} className="flex items-start gap-3 px-4 py-2.5">
              <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md', i.tone === 'red' ? 'bg-red-50 text-red-700' : i.tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700')}>
                <i.icon aria-hidden className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{i.title}</div>
                {i.detail && <div className="line-clamp-1 text-xs text-muted" title={i.detail}>{i.detail}</div>}
              </div>
              <Link to={i.to} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                {i.cta} <ArrowRight aria-hidden className="h-3 w-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3 px-4 py-4 text-sm">
          <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-700" />
          <span>
            <span className="font-medium">All clear.</span> <span className="text-muted">No urgent stock, supplier, receiving or approval items right now.</span>
          </span>
        </div>
      )}
    </Card>
  );
}

function CostAndSavings({ d }: { d: any }) {
  const p = d.purchasing.plan;
  const max = p ? Math.max(p.baseline, p.planned, 1) : 1;
  return (
    <Card
      title="Cost & savings"
      icon={Wallet}
      actions={
        <Link to="/savings" className="text-xs font-medium text-accent hover:underline">
          Details
        </Link>
      }
    >
      {p ? (
        <div className="mb-2 space-y-1.5">
          {(
            [
              ['Preferred-supplier baseline', p.baseline, 'bg-slate-300'],
              ['Optimised plan', p.planned, 'bg-accent'],
            ] as const
          ).map(([label, v, bar]) => (
            <div key={label}>
              <div className="flex justify-between text-xs">
                <span className="text-muted">{label}</span>
                <span className="font-medium tabular-nums">{usd(v)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-raised">
                <div className={cx('h-1.5 rounded-full', bar)} style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-muted">
            Latest plan {dt(p.createdAt)} · {p.method === 'milp' ? 'optimised and verified' : p.method}. Both totals cover the same needs, pack sizes and fees.
          </p>
        </div>
      ) : (
        <p className="mb-2 text-sm text-muted">No purchasing plan yet. Run the morning plan to compare suppliers.</p>
      )}
      <dl className="divide-y divide-line border-t border-line">
        <Stat label="Plan saving" value={p ? `${usd(p.saving)} · ${pct(p.savingPct)}` : '—'} tone={p?.saving > 0 ? 'green' : undefined} />
        <Stat label="Awaiting approval" hint={`${d.purchasing.pendingApproval.count} order(s)`} value={usd(d.purchasing.pendingApproval.total)} />
        <Stat label="Orders in flight" hint={`${d.purchasing.inFlight.count} order(s)`} value={usd(d.purchasing.inFlight.total)} />
        <Stat label="Verified savings" hint={d.verifiedSavings.month} value={usd(d.verifiedSavings.total)} tone={d.verifiedSavings.total > 0 ? 'green' : undefined} />
        <Stat label="Credits pending" hint="Open disputes, not yet counted" value={usd(d.pendingCredits)} tone={d.pendingCredits > 0 ? 'amber' : undefined} />
        <Stat label="Stock at risk of expiry" value={usd(d.stock.valueAtRisk)} tone={d.stock.valueAtRisk > 0 ? 'amber' : undefined} />
      </dl>
    </Card>
  );
}

function Decisions({ inbox, loading }: { inbox: any; loading: boolean }) {
  const rows = [...(inbox?.questions ?? []).map((x: any) => ({ ...x, kind: 'question' })), ...(inbox?.proposals ?? []).map((x: any) => ({ ...x, kind: 'proposal' }))];
  return (
    <Card
      title="Decisions waiting"
      icon={ClipboardCheck}
      pad={false}
      actions={
        <Link to="/inbox" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Open Inbox <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <p className="p-4 text-sm text-muted">Loading…</p>
      ) : rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-line bg-raised text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Decision</th>
                <th className="hidden w-36 px-3 py-2 font-medium sm:table-cell">From</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Value</th>
                <th className="hidden w-24 px-3 py-2 font-medium md:table-cell">Waiting</th>
                <th className="w-20 px-4 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 6).map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <div className="truncate font-medium" title={r.kind === 'question' ? r.text : r.summary}>
                      {r.kind === 'question' ? r.text : r.purchaseOrder ? `${r.purchaseOrder.number} · ${r.purchaseOrder.supplier}` : r.summary}
                    </div>
                    <div className="text-[11px] text-muted">{r.kind === 'question' ? 'Question · the run is paused' : r.purchaseOrder ? 'Approve and send the order' : r.why}</div>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                      <AgentAvatar id={r.agentId} /> {agentName(r.agentId)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.purchaseOrder ? usd(r.purchaseOrder.total) : '—'}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted md:table-cell">{ago(r.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <Link to="/inbox" className="text-xs font-medium text-accent hover:underline">
                      {r.kind === 'question' ? 'Answer' : 'Review'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 6 && <p className="border-t border-line px-4 py-2 text-xs text-muted">{rows.length - 6} more in the Inbox</p>}
        </div>
      ) : (
        <p className="p-4 text-sm text-muted">Nothing waiting for a decision.</p>
      )}
    </Card>
  );
}

function InventoryAtRisk({ d }: { d: any }) {
  const byId = new Map<string, any>();
  for (const c of d.stock.critical) byId.set(c.id, { ...c, status: 'critical' });
  for (const c of d.stock.low) byId.set(c.id, { ...c, status: 'low' });
  for (const x of d.stock.expiryRisks) byId.set(x.id, { ...(byId.get(x.id) ?? { id: x.id, name: x.name, unit: x.unit, status: 'expiring' }), expiry: x });
  const rows = [...byId.values()].sort((a, b) => ({ critical: 0, low: 1, expiring: 2 })[a.status as 'low'] - ({ critical: 0, low: 1, expiring: 2 })[b.status as 'low']);
  return (
    <Card
      title="Inventory at risk"
      icon={PackageX}
      pad={false}
      actions={
        <Link to="/inventory" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Inventory <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
    >
      {rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-raised text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Ingredient</th>
                <th className="px-3 py-2 text-right font-medium">Days of cover</th>
                <th className="px-3 py-2 font-medium">Expiry risk</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.daysOfCover === undefined ? '—' : `${num(r.daysOfCover)} d`}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.expiry ? `${num(r.expiry.atRisk)} ${r.unit} · ${usd(r.expiry.value)} before ${r.expiry.expiresAt}` : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2">
                    <Badge tone={r.status === 'critical' ? 'red' : r.status === 'low' ? 'amber' : 'blue'} dot>
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted">Stock covers the forecast and nothing is close to expiry.</p>
      )}
    </Card>
  );
}

function Deliveries({ rows }: { rows: any[] }) {
  return (
    <Card title="Expected deliveries" icon={Truck} subtitle="Next 2 days" pad={false}>
      {rows.length ? (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <Link to={`/orders/${r.id}`} className="font-medium hover:underline">
                    {r.number}
                  </Link>{' '}
                  {r.supplier}
                </div>
                <div className="text-[11px] text-muted">
                  {day(r.deliveryDate)}
                  {r.eta ? ` · ETA ${r.eta}` : ''} · {r.lines} items · {usd(r.total)}
                </div>
              </div>
              <Status s={r.status} />
              <Link to={`/receiving/po/${r.id}`} className="text-xs font-medium text-accent hover:underline">
                Receive
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">No deliveries expected in the next two days.</p>
      )}
    </Card>
  );
}

function ReceivingIssues({ r, title = 'Receiving & disputes' }: { r: { invoices: any[]; disputes: any[] }; title?: string }) {
  const has = r.invoices.length || r.disputes.length;
  return (
    <Card title={title} icon={Scale} pad={false}>
      {has ? (
        <ul className="divide-y divide-line text-sm">
          {r.invoices.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/receiving/invoices/${i.id}`} className="font-medium hover:underline">
                  Invoice {i.number ?? 'draft'}
                </Link>{' '}
                <span className="text-muted">{i.supplier}</span>
                <div className="text-[11px] text-muted">{i.variance > 0 ? `Differences ${usd(i.variance)}` : 'Needs review'}</div>
              </div>
              <Status s={i.status} />
            </li>
          ))}
          {r.disputes.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/disputes/${x.id}`} className="font-medium hover:underline">
                  {x.number}
                </Link>{' '}
                <span className="text-muted">{x.supplier}</span>
                <div className="text-[11px] text-muted">Credit claimed {usd(x.claimed)}</div>
              </div>
              <Status s={x.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">No invoice discrepancies or open disputes.</p>
      )}
    </Card>
  );
}

function Standup({ d, canRun, onRun }: { d: any; canRun: boolean; onRun: () => void }) {
  const b = d.briefing;
  if (!b)
    return (
      <Card title="Morning standup" icon={Bot}>
        <Empty icon={Bot} action={canRun && <Button variant="primary" icon={Play} onClick={onRun}>Run morning plan</Button>}>
          The team hasn't run today. The morning plan forecasts demand, compares suppliers and drafts orders for approval.
        </Empty>
      </Card>
    );
  const br = b.briefing;
  const decisions = br.agents.flatMap((a: any) => a.needsYou.map((it: any) => ({ ...it, agentId: a.agentId })));
  return (
    <Card title="Morning standup" subtitle={`Prepared by Pilot · ${dt(b.createdAt)}`} actions={<ModeBadge mode={b.mode} reason={b.reason} />}>
      {b.mode !== 'ai' && b.reason !== 'no_api_key' && (
        <div className="mb-4 flex gap-2.5 rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Gemini was unavailable because {fallbackText(b.reason)}, so the built-in rules engine prepared this standup. The figures are unchanged.</span>
        </div>
      )}
      <p className="text-[15px] leading-relaxed">{br.summary}</p>
      {br.note && <p className="mt-1.5 text-sm text-muted">Pilot: {br.note}</p>}

      {decisions.length > 0 && (
        <section className="mt-5">
          <SectionLabel>Needs your decision</SectionLabel>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {decisions.map((it: any, i: number) => (
              <li key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                <AgentAvatar id={it.agentId} />
                <span className="min-w-0 flex-1 text-sm">{it.text}</span>
                {it.refType && it.refId && REF_LINK[it.refType] && (
                  <Link to={REF_LINK[it.refType](it.refId)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-card px-3 text-xs font-medium shadow-card hover:bg-raised">
                    Review <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5">
        <SectionLabel>What the team did</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {br.agents.map((a: any) => {
            const items = [...a.done, ...a.today];
            return (
              <div key={a.agentId} className="min-w-0 rounded-xl border border-line p-3.5">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <AgentAvatar id={a.agentId} />
                  {agentName(a.agentId)}
                  {a.needsYou.length > 0 && (
                    <span className="ml-auto text-xs font-medium text-amber-700">
                      {a.needsYou.length} decision{a.needsYou.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {items.length ? <Items items={items} /> : <p className="text-[13px] text-muted">Nothing to report today.</p>}
              </div>
            );
          })}
        </div>
      </section>

      {(br.wasteReductionIdeas.length > 0 || br.risks.length > 0) && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {br.wasteReductionIdeas.length > 0 && (
            <Block title="Recommendations" icon={Lightbulb} tone="bg-emerald-50 text-emerald-700">
              {br.wasteReductionIdeas.map((w: any, i: number) => (
                <li key={i}>{w.text}</li>
              ))}
            </Block>
          )}
          {br.risks.length > 0 && (
            <Block title="Risks" icon={AlertTriangle} tone="bg-red-50 text-red-700">
              {br.risks.map((r: string, i: number) => (
                <li key={i}>{r}</li>
              ))}
            </Block>
          )}
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
        Every number comes from the forecasting and purchasing engines and is checked before it is shown.
      </p>
    </Card>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function Block({ title, icon: Ico, tone, children }: { title: string; icon: LucideIcon; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={cx('grid h-7 w-7 place-items-center rounded-lg', tone)}>
          <Ico aria-hidden className="h-4 w-4" />
        </span>
        {title}
      </div>
      <ul className="space-y-1.5 text-[13px] leading-snug [&>li]:flex [&>li]:gap-2 [&>li]:before:mt-[7px] [&>li]:before:h-1 [&>li]:before:w-1 [&>li]:before:shrink-0 [&>li]:before:rounded-full [&>li]:before:bg-slate-300 [&>li]:before:content-['']">{children}</ul>
    </div>
  );
}

function Items({ items }: { items: any[] }) {
  return (
    <ul className="space-y-1.5 text-[13px] leading-snug text-muted">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <CheckCircle2 aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {it.refType && it.refId && REF_LINK[it.refType] ? (
            <Link className="hover:text-ink hover:underline" to={REF_LINK[it.refType](it.refId)}>
              {it.text}
            </Link>
          ) : (
            <span>{it.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Outlook({ d, link = true }: { d: any; link?: boolean }) {
  return (
    <Card
      title="Next 7 days"
      icon={CloudRain}
      actions={
        link && (
          <Link to="/forecast" className="text-xs font-medium text-accent hover:underline">
            Forecast
          </Link>
        )
      }
    >
      <div className="grid grid-cols-7 gap-1">
        {d.context.days.map((c: any) => (
          <div key={c.date} title={c.holiday ?? undefined} className={cx('rounded-md px-0.5 py-1.5 text-center', c.holiday ? 'bg-violet-50 text-violet-800' : c.precipIn >= 0.2 ? 'bg-blue-50' : 'bg-raised')}>
            <div className="text-[11px] font-medium">{day(c.date).split(',')[0]}</div>
            <div className="text-xs tabular-nums">{c.tmaxF === null ? '—' : `${Math.round(c.tmaxF)}°`}</div>
            <div className="text-[10px] tabular-nums text-muted">{c.precipIn === null ? '' : `${c.precipIn.toFixed(2)}″`}</div>
          </div>
        ))}
      </div>
      {d.context.days.some((c: any) => c.holiday) && (
        <p className="mt-2 text-xs text-violet-700">
          {d.context.days
            .filter((c: any) => c.holiday)
            .map((c: any) => `${c.holiday} (${day(c.date).split(',')[0]})`)
            .join(', ')}
        </p>
      )}
      <dl className="mt-2 divide-y divide-line border-t border-line">
        <Stat label="Forecast error (WAPE)" hint={`seasonal-naive ${pct(d.forecastAccuracy.avgNaiveWapePct)}`} value={pct(d.forecastAccuracy.avgWapePct)} />
        <Stat label="Dishes at or better than naive" value={`${d.forecastAccuracy.atOrBelowNaive} / ${d.forecastAccuracy.items}`} />
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        Weather <Status s={d.context.status.weather_forecast?.status ?? 'not_checked'} /> Holidays <Status s={d.context.status.holidays?.status ?? 'not_checked'} />
      </div>
      {d.context.status.weather_forecast?.status === 'unavailable' && <p className="mt-1 text-xs text-amber-700">Weather unavailable — the forecast without weather is used.</p>}
      <p className="mt-1 text-[11px] text-muted">{d.context.attribution} · Holidays by Nager.Date</p>
    </Card>
  );
}

export const TRIGGER: Record<string, string> = {
  manual: 'Started by a person',
  schedule: 'Daily schedule',
  catch_up: 'Missed schedule, caught up',
  delegation: 'Delegated by Pilot',
  delegated: 'Delegated by Pilot',
  fallback: 'Rule-based continuation',
  mention: '@mention in chat',
  'supplier.responded': 'Supplier responded',
  'substitution.rejected': 'Substitute rejected',
  'delivery.received': 'Delivery received',
  'invoice.matched_with_variances': 'Invoice differences found',
  'dispute.accepted': 'Supplier accepted a credit',
  'po.unconfirmed_deadline': 'Confirmation deadline missed',
};

const ACTIVITY_TABS = [
  ['agents', 'Agents'],
  ['events', 'Events'],
] as const;

function Activity({ d }: { d: any }) {
  const [tab, setTab] = useState<'agents' | 'events'>('agents');
  const runs: any[] = d.agentActivity;
  const ids = new Set(runs.map((r) => r.id));
  const roots = runs.filter((r) => !r.parentRunId || !ids.has(r.parentRunId)).slice(0, 4);
  const children = (id: string) => runs.filter((r) => r.parentRunId === id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return (
    <Card title="Activity" icon={CalendarClock} pad={false} actions={<Tabs label="Activity view" value={tab} onChange={setTab} options={ACTIVITY_TABS} />}>
      {tab === 'agents' ? (
        runs.length ? (
          <ul className="divide-y divide-line">
            {roots.map((r) => (
              <li key={r.id} className="px-4 py-2">
                {[r, ...children(r.id)].map((x, i) => (
                  <div key={x.id} className={cx('flex items-start gap-2 py-1', i > 0 && 'ml-5 border-l border-line pl-3')}>
                    <AgentAvatar id={x.agentId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium">{agentName(x.agentId)}</span>
                        <Status s={x.status} />
                        {x.mode === 'deterministic' ? (
                          <Badge title={`Rules engine: ${fallbackText(x.fallbackReason)}`}>rules engine</Badge>
                        ) : (
                          <Badge tone="green">AI</Badge>
                        )}
                        <span className="ml-auto text-muted">{time(x.startedAt)}</span>
                      </div>
                      <Link to={`/activity/runs/${x.id}`} className="line-clamp-1 text-xs text-muted hover:text-ink hover:underline" title={x.goal}>
                        {TRIGGER[x.trigger] ?? x.trigger.replace(/[._]/g, ' ')} · {x.goal}
                      </Link>
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted">No agent runs yet.</p>
        )
      ) : d.recentEvents.length ? (
        <ul className="divide-y divide-line text-sm">
          {d.recentEvents.map((e: any) => (
            <li key={e.id} className="flex gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="first-letter:uppercase">{e.action.replace(/[._]/g, ' ')}</span>
                <span className="block truncate text-xs text-muted">{e.actorName ?? e.actorType}</span>
              </span>
              <span className="whitespace-nowrap text-xs text-muted">{ago(e.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">Nothing recorded yet.</p>
      )}
      <Link to={tab === 'agents' ? '/activity' : '/activity?tab=audit'} className="block border-t border-line px-4 py-2 text-xs font-medium text-accent hover:underline">
        {tab === 'agents' ? 'All agent runs' : 'Full audit timeline'}
      </Link>
    </Card>
  );
}

