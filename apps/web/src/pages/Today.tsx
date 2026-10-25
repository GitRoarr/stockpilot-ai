import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { agentName, Badge, Button, Card, cx, day, dt, Empty, ErrorCard, Kpi, ModeBadge, num, Q, Status, usd } from '../components/ui';

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
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard') });
  const run = useMutation({ mutationFn: () => post<{ runId: string }>('/agent-runs', { kind: 'morning' }), onSuccess: (r) => nav(`/activity/runs/${r.runId}`) });
  const canRun = me.user.role !== 'staff';
  const hour = new Date().getHours();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {me.user.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-muted">
            {q.data ? day(q.data.date) : ''}
            {q.data?.lastMorningRun && (
              <>
                {' '}· Morning run {dt(q.data.lastMorningRun.started_at)} <Status s={q.data.lastMorningRun.status} /> {q.data.lastMorningRun.mode === 'deterministic' && <ModeBadge mode="deterministic" reason={q.data.lastMorningRun.fallback_reason} />}
              </>
            )}
          </p>
        </div>
        {canRun && (
          <Button variant="primary" className="ml-auto" busy={run.isPending} onClick={() => run.mutate()}>
            Run morning now
          </Button>
        )}
      </div>
      {run.error && <ErrorCard error={run.error} />}

      <Q q={q}>
        {(d) => (
          <>
            <div className="grid grid-cols-2 divide-line overflow-hidden rounded-xl border border-line bg-card sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
              <Kpi label="Verified savings" value={usd(d.verifiedSavings.total)} sub={`${d.verifiedSavings.month}: optimiser ${usd(d.verifiedSavings.optimiser)} · credits ${usd(d.verifiedSavings.creditsRecovered)}`} tone="green" to="/savings" />
              <Kpi label="Pending credits" value={usd(d.pendingCredits)} sub="Open disputes (not counted as saved)" to="/disputes" />
              <Kpi label="Needs ordering" value={`${d.stock.critical.length} critical`} sub={`${d.stock.low.length} low`} tone={d.stock.critical.length ? 'red' : undefined} to="/inventory" />
              <Kpi label="At risk of expiry" value={usd(d.stock.valueAtRisk)} sub={`${d.stock.expiryRisks.length} item(s) within the window`} tone={d.stock.valueAtRisk > 0 ? 'amber' : undefined} to="/inventory" />
              <Kpi label="Decisions waiting" value={d.decisions.proposals + d.decisions.questions + d.decisions.agreements} sub={`${d.decisions.proposals} approvals · ${d.decisions.questions} questions`} tone={d.decisions.proposals + d.decisions.questions ? 'amber' : undefined} to="/inbox" />
              <Kpi
                label="Purchase orders"
                value={Object.entries(d.posByStatus)
                  .filter(([s]) => !['closed'].includes(s))
                  .reduce((a, [, n]) => a + (n as number), 0)}
                sub={Object.entries(d.posByStatus)
                  .filter(([s]) => s !== 'closed')
                  .map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`)
                  .join(' · ') || 'none open'}
                to="/orders"
              />
            </div>
            <p className="text-xs text-muted">Verified and estimated savings are kept separate and never added together. Estimates: waste avoided {usd(d.estimatedSavings.wasteAvoided)}, time saved {usd(d.estimatedSavings.timeSaved)}.</p>

            <div className="grid gap-5 lg:grid-cols-5">
              <div className="space-y-5 lg:col-span-3">
                <Standup d={d} canRun={canRun} onRun={() => run.mutate()} />
              </div>
              <div className="space-y-5 lg:col-span-2">
                <Card title="Next 7 days" subtitle="Weather and holidays feed the forecast">
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {d.context.days.map((c: any) => (
                      <div key={c.date} className={cx('rounded-lg border px-1.5 py-2 text-center', c.holiday ? 'border-violet-300 bg-violet-50' : c.precipIn >= 0.2 ? 'border-blue-300 bg-blue-50' : 'border-line')}>
                        <div className="text-xs font-semibold">{day(c.date).split(',')[0]}</div>
                        <div className="font-mono text-xs">{c.tmaxF === null ? '—' : `${Math.round(c.tmaxF)}°F`}</div>
                        <div className="font-mono text-[10px] text-muted">{c.precipIn === null ? '' : `${c.precipIn.toFixed(2)} in`}</div>
                        {c.holiday && <div className="mt-0.5 truncate text-[10px] text-violet-700" title={c.holiday}>{c.holiday}</div>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    Weather <Status s={d.context.status.weather_forecast?.status ?? 'not_checked'} /> Holidays <Status s={d.context.status.holidays?.status ?? 'not_checked'} />
                    {d.context.status.weather_forecast?.status === 'unavailable' && <span className="text-amber-700">Weather unavailable — model without weather used</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{d.context.attribution} · Holidays by Nager.Date</p>
                </Card>
                <Card title="Stock risks" actions={<Link className="text-xs text-accent" to="/inventory">Inventory →</Link>}>
                  {[...d.stock.critical.map((c: any) => ({ ...c, kind: 'critical' })), ...d.stock.low.map((c: any) => ({ ...c, kind: 'low' }))].length === 0 && !d.stock.expiryRisks.length ? (
                    <Empty>No stock risks right now.</Empty>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {d.stock.critical.map((c: any) => (
                        <li key={c.id} className="flex items-center gap-2 py-1.5">
                          <span className="h-6 w-1 rounded bg-red-500" />
                          {c.name}
                          <span className="ml-auto font-mono text-xs text-muted">{num(c.daysOfCover)} days cover</span>
                          <Badge tone="red">critical</Badge>
                        </li>
                      ))}
                      {d.stock.low.map((c: any) => (
                        <li key={c.id} className="flex items-center gap-2 py-1.5">
                          <span className="h-6 w-1 rounded bg-amber-400" />
                          {c.name}
                          <span className="ml-auto font-mono text-xs text-muted">{num(c.daysOfCover)} days cover</span>
                          <Badge tone="amber">low</Badge>
                        </li>
                      ))}
                      {d.stock.expiryRisks.map((c: any) => (
                        <li key={`x${c.id}`} className="flex items-center gap-2 py-1.5">
                          <span className="h-6 w-1 rounded bg-blue-500" />
                          {c.name}
                          <span className="ml-auto font-mono text-xs text-muted">
                            {num(c.atRisk)} {c.unit} · {usd(c.value)} before {c.expiresAt}
                          </span>
                          <Badge tone="blue">expiring</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Forecast accuracy" subtitle="Backtest, last 28 days">
                  <div className="text-sm">
                    Selected models beat or match the seasonal-naive baseline on <b>{d.forecastAccuracy.atOrBelowNaive}</b> of {d.forecastAccuracy.items} dishes. Average WAPE <span className="font-mono">{num(d.forecastAccuracy.avgWapePct)}%</span> vs naive <span className="font-mono">{num(d.forecastAccuracy.avgNaiveWapePct)}%</span>.
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{d.forecastAccuracy.note}</p>
                </Card>
              </div>
            </div>
          </>
        )}
      </Q>
    </div>
  );
}

function Standup({ d, canRun, onRun }: { d: any; canRun: boolean; onRun: () => void }) {
  const b = d.briefing;
  if (!b)
    return (
      <Card title="Standup">
        <Empty action={canRun && <Button variant="primary" onClick={onRun}>Run morning now</Button>}>Your team hasn't run yet today.</Empty>
      </Card>
    );
  return (
    <Card title="Standup" subtitle={dt(b.createdAt)} actions={<ModeBadge mode={b.mode} reason={b.reason} />}>
      <p className="text-[15px] leading-relaxed">{b.briefing.summary}</p>
      {b.briefing.note && <p className="mt-1 text-sm text-muted">Pilot: {b.briefing.note}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {b.briefing.agents.map((a: any) => (
          <div key={a.agentId} className="rounded-lg border border-line p-3">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              {agentName(a.agentId)}
              {a.needsYou.length > 0 && <Badge tone="amber">needs you</Badge>}
            </div>
            <Section title="Needs you" items={a.needsYou} tone="text-amber-800" />
            <Section title="Done" items={a.done} />
            <Section title="Today" items={a.today} />
          </div>
        ))}
      </div>
      {b.briefing.wasteReductionIdeas.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Waste-reduction ideas</div>
          <ul className="mt-1 space-y-1">
            {b.briefing.wasteReductionIdeas.map((w: any, i: number) => (
              <li key={i} className="rounded-lg border border-dashed border-line px-3 py-2 text-sm">
                {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.briefing.risks.length > 0 && (
        <div className="mt-3 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Risks</span>
          <ul className="list-disc pl-5">
            {b.briefing.risks.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Numbers come from the engines; the AI writes the words and every number is checked against the facts. [Illustrative demo data]</p>
    </Card>
  );
}

function Section({ title, items, tone }: { title: string; items: any[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</div>
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
