import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CloudRain, Gauge, History, Inbox, PackageX, Play, ShoppingCart, Sparkles, Truck, Wallet } from 'lucide-react';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { agentName, ago, Badge, Button, Card, cx, day, dt, Empty, ErrorCard, Kpi, ModeBadge, num, PageHeader, pct, Q, Status, time, usd, type Tone } from '../components/ui';

const REF_LINK: Record<string, (id: string) => string> = {
  action: () => '/inbox',
  question: () => '/inbox',
  purchase_order: (id) => `/orders/${id}`,
  dispute: (id) => `/disputes/${id}`,
  task: (id) => `/tasks/${id}`,
  ingredient: () => '/inventory',
};

const AGENT_TONE: Record<string, string> = {
  pilot: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'demand-planner': 'bg-violet-50 text-violet-700 border-violet-200',
  buyer: 'bg-amber-50 text-amber-800 border-amber-200',
  'ap-clerk': 'bg-red-50 text-red-700 border-red-200',
};

export function AgentAvatar({ id, size = 'sm' }: { id: string; size?: 'sm' | 'md' }) {
  const initials = agentName(id)
    .split(' ')
    .map((w) => w[0])
    .join('');
  return <span className={cx('grid shrink-0 place-items-center rounded-md border font-semibold', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs', AGENT_TONE[id] ?? 'border-slate-200 bg-slate-100 text-slate-700')}>{initials}</span>;
}

export function TodayPage({ me }: { me: Me }) {
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard') });
  const run = useMutation({
    mutationFn: () => post<{ runId: string }>('/agent-runs', { kind: 'morning' }),
    onSuccess: (r) => {
      toast('info', 'Morning plan started', 'Pilot is delegating to Demand Planner and Buyer.');
      nav(`/activity/runs/${r.runId}`);
    },
    onError: (e) => toast('error', 'Could not start the morning plan', (e as Error).message),
  });
  const canRun = me.user.role !== 'staff';
  const hour = new Date().getHours();
  const d = q.data;
  const waiting = d ? d.decisions.proposals + d.decisions.questions + d.decisions.agreements : 0;
  return (
    <div className="space-y-4">
      <div className="home-hero rounded-lg border border-transparent px-0 py-0 dark:px-5 dark:py-6">
      <PageHeader
        title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${me.user.name.split(' ')[0]}`}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {d ? day(d.date) : '…'}
            {d?.lastMorningRun ? (
              <>
                <span aria-hidden>·</span> Last morning run {dt(d.lastMorningRun.started_at)} <Status s={d.lastMorningRun.status} /> {d.lastMorningRun.mode === 'deterministic' && <ModeBadge mode="deterministic" reason={d.lastMorningRun.fallback_reason} />}
              </>
            ) : (
              d && (
                <>
                  <span aria-hidden>·</span> No morning run yet
                </>
              )
            )}
          </span>
        }
        actions={
          <>
            <Link to="/inbox" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-sm font-medium shadow-card hover:bg-raised">
              <Inbox aria-hidden className="h-3.5 w-3.5" /> Review decisions
              {waiting > 0 && <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold tabular-nums text-amber-800">{waiting}</span>}
            </Link>
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
        {(d) => (
          <>
            <Attention d={d} waiting={waiting} />

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-card">
              <Kpi icon={ShoppingCart} label="Planned spend" value={usd(d.purchasing.plan?.planned)} sub={d.purchasing.plan ? `vs ${usd(d.purchasing.plan.baseline)} baseline` : 'No plan yet'} to="/orders" />
              <Kpi icon={Wallet} label="Plan saving" value={usd(d.purchasing.plan?.saving)} sub={d.purchasing.plan ? `${pct(d.purchasing.plan.savingPct)} below preferred suppliers` : 'Run the morning plan'} tone={d.purchasing.plan?.saving > 0 ? 'green' : undefined} />
              <Kpi icon={Inbox} label="Awaiting approval" value={d.purchasing.pendingApproval.count} sub={d.purchasing.pendingApproval.count ? `${usd(d.purchasing.pendingApproval.total)} in orders` : `${waiting} decisions waiting`} tone={d.purchasing.pendingApproval.count ? 'amber' : undefined} to="/inbox" />
              <Kpi icon={PackageX} label="Stock risks" value={`${d.stock.critical.length} critical`} sub={`${d.stock.low.length} low · ${d.stock.expiryRisks.length} expiring`} tone={d.stock.critical.length ? 'red' : undefined} to="/inventory" />
              <Kpi icon={Truck} label="Orders in flight" value={d.purchasing.inFlight.count} sub={d.purchasing.inFlight.count ? usd(d.purchasing.inFlight.total) : 'None open'} to="/orders" />
              <Kpi icon={Sparkles} label="Verified savings" value={usd(d.verifiedSavings.total)} sub={`${d.verifiedSavings.month} · credits ${usd(d.verifiedSavings.creditsRecovered)}`} tone={d.verifiedSavings.total > 0 ? 'green' : undefined} to="/savings" />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="min-w-0 space-y-4 xl:col-span-2">
                <PlanCard d={d} canRun={canRun} onRun={() => run.mutate()} busy={run.isPending} />
                <Standup d={d} canRun={canRun} onRun={() => run.mutate()} />
                <AgentActivity runs={d.agentActivity} />
              </div>
              <div className="min-w-0 space-y-4">
                <SupplierIssues issues={d.supplierIssues} />
                <StockRisks d={d} />
                <Card title="Next 7 days" icon={CloudRain} subtitle="Feeds the forecast">
                  <div className="grid grid-cols-7 gap-1">
                    {d.context.days.map((c: any) => (
                      <div key={c.date} title={c.holiday ?? undefined} className={cx('rounded-md border px-0.5 py-1.5 text-center', c.holiday ? 'border-violet-200 bg-violet-50' : c.precipIn >= 0.2 ? 'border-blue-200 bg-blue-50' : 'border-line')}>
                        <div className="text-[11px] font-medium">{day(c.date).split(',')[0]}</div>
                        <div className="font-mono text-xs">{c.tmaxF === null ? '—' : `${Math.round(c.tmaxF)}°`}</div>
                        <div className="font-mono text-[10px] text-muted">{c.precipIn === null ? '' : `${c.precipIn.toFixed(2)}″`}</div>
                      </div>
                    ))}
                  </div>
                  {d.context.days.some((c: any) => c.holiday) && (
                    <p className="mt-2 text-xs text-violet-700">
                      Holiday: {d.context.days.filter((c: any) => c.holiday).map((c: any) => `${c.holiday} (${day(c.date).split(',')[0]})`).join(', ')}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    Weather <Status s={d.context.status.weather_forecast?.status ?? 'not_checked'} /> Holidays <Status s={d.context.status.holidays?.status ?? 'not_checked'} />
                  </div>
                  {d.context.status.weather_forecast?.status === 'unavailable' && <p className="mt-1 text-xs text-amber-700">Weather unavailable — the forecast model without weather is used.</p>}
                  <p className="mt-1 text-[11px] text-muted">{d.context.attribution} · Holidays by Nager.Date</p>
                </Card>
                <Card title="Forecast accuracy" icon={Gauge} subtitle="Backtest, last 28 days">
                  <div className="flex items-baseline gap-3">
                    <span className="text-xl font-semibold tabular-nums">{pct(d.forecastAccuracy.avgWapePct)}</span>
                    <span className="text-xs text-muted">avg WAPE vs {pct(d.forecastAccuracy.avgNaiveWapePct)} seasonal-naive</span>
                  </div>
                  <p className="mt-1 text-sm">
                    Beats or matches the baseline on <b>{d.forecastAccuracy.atOrBelowNaive}</b> of {d.forecastAccuracy.items} dishes.
                  </p>
                  <p className="mt-1 text-[11px] text-muted">{d.forecastAccuracy.note}</p>
                </Card>
                <RecentEvents events={d.recentEvents} />
              </div>
            </div>
            <p className="text-xs text-muted">
              Savings are computed by StockPilot from orders approved and credits recorded in this app, at the prices recorded in StockPilot. Verified and estimated amounts are never added together (estimates: waste avoided {usd(d.estimatedSavings.wasteAvoided)}, time saved {usd(d.estimatedSavings.timeSaved)}).
            </p>
          </>
        )}
      </Q>
    </div>
  );
}

function Attention({ d, waiting }: { d: any; waiting: number }) {
  const items: { tone: 'red' | 'amber'; text: string; to: string; cta: string }[] = [];
  if (waiting) items.push({ tone: 'amber', text: `${waiting} decision${waiting === 1 ? '' : 's'} waiting for you`, to: '/inbox', cta: 'Open Inbox' });
  if (d.stock.critical.length) items.push({ tone: 'red', text: `${d.stock.critical.length} ingredient${d.stock.critical.length === 1 ? '' : 's'} critically low: ${d.stock.critical.slice(0, 3).map((c: any) => c.name).join(', ')}${d.stock.critical.length > 3 ? '…' : ''}`, to: '/inventory', cta: 'View stock' });
  const red = d.supplierIssues.filter((i: any) => i.severity === 'red');
  if (red.length) items.push({ tone: 'red', text: `${red.length} supplier issue${red.length === 1 ? '' : 's'}: ${red[0].number} ${red[0].supplier} — ${red[0].detail}`, to: `/orders/${red[0].poId}`, cta: 'Open order' });
  if (!items.length) return null;
  return (
    <section aria-label="Needs attention" className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
      <ul className="divide-y divide-amber-200">
        {items.map((i, k) => (
          <li key={k} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <AlertTriangle aria-hidden className={cx('h-4 w-4 shrink-0', i.tone === 'red' ? 'text-red-700' : 'text-amber-700')} />
            <span className="min-w-0 flex-1 text-amber-900">{i.text}</span>
            <Link to={i.to} className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline">
              {i.cta} <ArrowRight aria-hidden className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanCard({ d, canRun, onRun, busy }: { d: any; canRun: boolean; onRun: () => void; busy: boolean }) {
  const p = d.purchasing.plan;
  if (!p)
    return (
      <Card title="Purchasing plan" icon={ShoppingCart}>
        <Empty title="No purchasing plan yet" icon={ShoppingCart} action={canRun && <Button variant="primary" icon={Play} busy={busy} onClick={onRun}>Run morning plan</Button>}>
          The Buyer compares every supplier's prices, pack sizes, minimums and fees against the forecast need.
        </Empty>
      </Card>
    );
  const max = Math.max(p.baseline, p.planned, 1);
  return (
    <Card
      title="Purchasing plan"
      icon={ShoppingCart}
      subtitle={`${dt(p.createdAt)} · ${p.method === 'milp' ? 'optimised (MILP, verified)' : p.method}`}
      actions={
        <Link to="/orders" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Orders <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <dl className="space-y-2.5 text-sm">
          {(
            [
              ['Preferred-supplier baseline', p.baseline, 'bg-slate-300'],
              ['Optimised plan', p.planned, 'bg-accent'],
            ] as const
          ).map(([label, v, bar]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono tabular-nums">{usd(v)}</dd>
              </div>
              <div className="mt-1 h-2 rounded-full bg-raised">
                <div className={cx('h-2 rounded-full', bar)} style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </dl>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-center sm:min-w-36">
          <div className="text-xs text-emerald-800">Saving</div>
          <div className="text-xl font-semibold tabular-nums text-emerald-700">{usd(p.saving)}</div>
          <div className="text-xs text-emerald-800">{pct(p.savingPct)} lower</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Both totals come from the optimiser for the same needs, including pack rounding and delivery or small-order fees.
        {d.purchasing.pendingApproval.count > 0 && ` ${d.purchasing.pendingApproval.count} order(s) worth ${usd(d.purchasing.pendingApproval.total)} wait for approval.`}
        {p.fallbackReason && ` Fallback: ${p.fallbackReason}.`}
      </p>
    </Card>
  );
}

function Standup({ d, canRun, onRun }: { d: any; canRun: boolean; onRun: () => void }) {
  const b = d.briefing;
  if (!b)
    return (
      <Card title="Standup" icon={Bot}>
        <Empty icon={Bot} action={canRun && <Button variant="primary" icon={Play} onClick={onRun}>Run morning plan</Button>}>Your team hasn't run yet today.</Empty>
      </Card>
    );
  return (
    <Card title="Standup" icon={Bot} subtitle={dt(b.createdAt)} actions={<ModeBadge mode={b.mode} reason={b.reason} />}>
      <p className="text-sm leading-relaxed">{b.briefing.summary}</p>
      {b.briefing.note && <p className="mt-1 text-sm text-muted">Pilot: {b.briefing.note}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {b.briefing.agents.map((a: any) => (
          <div key={a.agentId} className="rounded-md border border-line p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <AgentAvatar id={a.agentId} />
              {agentName(a.agentId)}
              {a.needsYou.length > 0 && <Badge tone="amber">needs you</Badge>}
            </div>
            {!a.needsYou.length && !a.done.length && !a.today.length && <p className="text-sm text-muted">Nothing to report today.</p>}
            <Section title="Needs you" items={a.needsYou} tone="text-amber-800" />
            <Section title="Done" items={a.done} />
            <Section title="Today" items={a.today} />
          </div>
        ))}
      </div>
      {b.briefing.wasteReductionIdeas.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted">Waste-reduction ideas</div>
          <ul className="mt-1 space-y-1">
            {b.briefing.wasteReductionIdeas.map((w: any, i: number) => (
              <li key={i} className="rounded-md bg-raised px-3 py-1.5 text-sm">
                {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.briefing.risks.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="text-xs font-medium text-muted">Risks</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {b.briefing.risks.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Numbers come from the engines; the AI writes the words and every number is checked against the facts.</p>
    </Card>
  );
}

function Section({ title, items, tone }: { title: string; items: any[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>
      <ul className="space-y-0.5 text-sm">
        {items.map((it, i) => (
          <li key={i} className={tone}>
            {it.refType && it.refId && REF_LINK[it.refType] ? (
              <Link className="hover:underline" to={REF_LINK[it.refType](it.refId)}>
                {it.text}
              </Link>
            ) : (
              it.text
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const TRIGGER: Record<string, string> = {
  manual: 'Started by a person',
  schedule: 'Daily schedule',
  catch_up: 'Missed schedule, caught up',
  delegation: 'Delegated by Pilot',
  mention: '@mention in chat',
  'supplier.responded': 'Supplier responded',
  'substitution.rejected': 'Substitute rejected',
  'delivery.received': 'Delivery received',
  'invoice.matched_with_variances': 'Invoice variances found',
  'dispute.accepted': 'Supplier accepted a credit',
  'po.unconfirmed_deadline': 'Confirmation deadline missed',
};

/** Hand-offs between agents: each top-level run with the runs it delegated, newest first. */
function AgentActivity({ runs }: { runs: any[] }) {
  const ids = new Set(runs.map((r) => r.id));
  const roots = runs.filter((r) => !r.parentRunId || !ids.has(r.parentRunId));
  const children = (id: string) => runs.filter((r) => r.parentRunId === id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const row = (r: any, child: boolean) => (
    <li key={r.id} className={cx('relative flex gap-3 py-2', child && 'pl-9')}>
      {child && <span aria-hidden className="absolute left-3 top-0 h-5 w-4 rounded-bl-md border-b border-l border-line-strong" />}
      <AgentAvatar id={r.agentId} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{agentName(r.agentId)}</span>
          <Status s={r.status} />
          {r.mode === 'deterministic' ? (
            <Badge tone="amber" title={r.fallbackReason ?? undefined}>
              rule-based
            </Badge>
          ) : (
            <Badge tone="green">AI</Badge>
          )}
          <span className="ml-auto whitespace-nowrap text-xs text-muted" title={dt(r.startedAt)}>
            {time(r.startedAt)}
          </span>
        </div>
        <Link to={`/activity/runs/${r.id}`} className="line-clamp-1 text-sm text-muted hover:text-ink hover:underline" title={r.goal}>
          {r.goal}
        </Link>
        <div className="text-[11px] text-muted">
          {TRIGGER[r.trigger] ?? r.trigger.replace(/[._]/g, ' ')} · {r.steps} step{r.steps === 1 ? '' : 's'}
        </div>
      </div>
    </li>
  );
  return (
    <Card
      title="Agent activity"
      icon={History}
      subtitle="Who did what, and why"
      actions={
        <Link to="/activity" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          All runs <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
    >
      {runs.length ? (
        <ul className="-my-2 divide-y divide-line">
          {roots.slice(0, 5).map((r) => (
            <li key={r.id}>
              <ul>
                {row(r, false)}
                {children(r.id).map((c) => row(c, true))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={Bot}>No agent runs yet. Run the morning plan to see Pilot hand work to Demand Planner and Buyer.</Empty>
      )}
    </Card>
  );
}

const ISSUE_TONE: Record<string, Tone> = { red: 'red', amber: 'amber', blue: 'blue' };
const ISSUE_LABEL: Record<string, string> = { unconfirmed: 'Unconfirmed', partial: 'Partial', late: 'Late', due_today: 'Due today' };

function SupplierIssues({ issues }: { issues: any[] }) {
  return (
    <Card title="Suppliers & deliveries" icon={Truck} pad={!issues.length}>
      {issues.length ? (
        <ul className="divide-y divide-line text-sm">
          {issues.map((i, k) => (
            <li key={k}>
              <Link to={`/orders/${i.poId}`} className="flex items-start gap-2 px-4 py-2 hover:bg-raised">
                <Badge tone={ISSUE_TONE[i.severity]}>{ISSUE_LABEL[i.kind]}</Badge>
                <span className="min-w-0">
                  <span className="font-medium">{i.number}</span> {i.supplier}
                  <span className="block text-xs text-muted">{i.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No late, unconfirmed or partial orders.</p>
      )}
    </Card>
  );
}

function StockRisks({ d }: { d: any }) {
  const rows = [...d.stock.critical.map((c: any) => ({ ...c, kind: 'critical' as const })), ...d.stock.low.map((c: any) => ({ ...c, kind: 'low' as const }))];
  return (
    <Card
      title="Stock risks"
      icon={PackageX}
      pad={false}
      actions={
        <Link className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" to="/inventory">
          Inventory <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
    >
      {!rows.length && !d.stock.expiryRisks.length ? (
        <p className="p-4 text-sm text-muted">No stock risks right now.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-auto text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="font-mono text-xs text-muted">{num(c.daysOfCover)} d</span>
              <Badge tone={c.kind === 'critical' ? 'red' : 'amber'} dot>
                {c.kind}
              </Badge>
            </li>
          ))}
          {d.stock.expiryRisks.map((c: any) => (
            <li key={`x${c.id}`} className="flex items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate" title={`${num(c.atRisk)} ${c.unit} before ${c.expiresAt}`}>
                {c.name}
              </span>
              <span className="font-mono text-xs text-muted">{usd(c.value)}</span>
              <Badge tone="blue" dot>
                expiring
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {d.stock.valueAtRisk > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">{usd(d.stock.valueAtRisk)} of stock may expire before it is used.</p>}
    </Card>
  );
}

function RecentEvents({ events }: { events: any[] }) {
  return (
    <Card title="Recent events" icon={CalendarClock} pad={false}>
      {events.length ? (
        <ul className="divide-y divide-line text-sm">
          {events.map((e) => (
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
      <Link to="/activity?tab=audit" className="block border-t border-line px-4 py-2 text-xs font-medium text-accent hover:underline">
        Full audit timeline
      </Link>
    </Card>
  );
}
