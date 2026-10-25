import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, Clock, Hourglass, PiggyBank, Receipt, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { Badge, Card, dt, Empty, PageHeader, Q, Table, Tabs, usd } from '../components/ui';

// Savings ledger (FR-095 – FR-097): realized (verified) and projected amounts are separate panels and never summed.
const LINK: Record<string, (id: string) => string> = { purchase_order: (id) => `/orders/${id}`, dispute: (id) => `/disputes/${id}` };
const PERIODS = [
  ['month', 'This month'],
  ['30d', 'Last 30 days'],
  ['all', 'All time'],
] as const;
type Period = (typeof PERIODS)[number][0];
const TYPE_LABEL: Record<string, string> = {
  optimiser_saving: 'Optimiser saving',
  credit_recovered: 'Credit recovered',
  credit_pending: 'Credit pending',
  waste_avoided_estimate: 'Waste avoided (estimate)',
  time_saved_estimate: 'Time saved (estimate)',
};

export function SavingsPage() {
  const q = useQuery({ queryKey: ['ledger'], queryFn: () => api<any>('/ledger') });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard') });
  const [period, setPeriod] = useState<Period>('month');
  return (
    <div className="space-y-4">
      <PageHeader title="Savings" description="What StockPilot saved, where each figure comes from, and what is still only projected." actions={<Tabs label="Period" value={period} onChange={setPeriod} options={PERIODS} />} />
      <Q q={q}>
        {(d) => {
          const since = new Date(Date.now() - 30 * 864e5).toISOString();
          const inPeriod = (e: any) => (period === 'all' ? true : period === 'month' ? e.created_at.slice(0, 7) === d.summary.month : e.created_at >= since);
          const entries = d.entries.filter(inPeriod);
          const sum = (type: string) => Math.round(entries.filter((e: any) => e.type === type).reduce((s: number, e: any) => s + e.amount, 0) * 100) / 100;
          const optimiser = sum('optimiser_saving');
          const credits = sum('credit_recovered');
          const realized = Math.round((optimiser + credits) * 100) / 100;
          const pendingOrders = dash.data?.purchasing.pendingApproval;
          return (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Realized savings" icon={ShieldCheck} subtitle={`Verified in this app · ${PERIODS.find(([p]) => p === period)![1].toLowerCase()}`}>
                  <div className="text-2xl font-semibold tabular-nums text-emerald-700">{usd(realized)}</div>
                  <dl className="mt-3 divide-y divide-line text-sm">
                    <div className="flex justify-between gap-3 py-1.5">
                      <dt className="flex items-center gap-1.5 text-muted">
                        <PiggyBank aria-hidden className="h-3.5 w-3.5" /> Optimiser savings on approved orders
                      </dt>
                      <dd className="font-mono">{usd(optimiser)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-1.5">
                      <dt className="flex items-center gap-1.5 text-muted">
                        <Receipt aria-hidden className="h-3.5 w-3.5" /> Supplier credits recovered
                      </dt>
                      <dd className="font-mono">{usd(credits)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-muted">An optimiser saving counts when an order is approved: preferred-supplier baseline (same needs, pack rounding and fees) minus the optimised cost.</p>
                </Card>
                <Card title="Projected" icon={Hourglass} subtitle="Not counted until it happens">
                  <dl className="divide-y divide-line text-sm">
                    <div className="flex justify-between gap-3 py-1.5">
                      <dt className="text-muted">
                        Savings in orders awaiting approval
                        {pendingOrders?.count ? (
                          <Link to="/inbox" className="ml-1 text-xs text-accent hover:underline">
                            {pendingOrders.count} order(s)
                          </Link>
                        ) : null}
                      </dt>
                      <dd className="font-mono">{usd(pendingOrders?.saving ?? null)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-1.5">
                      <dt className="text-muted">
                        Credits claimed in open disputes{' '}
                        <Link to="/disputes" className="text-xs text-accent hover:underline">
                          view
                        </Link>
                      </dt>
                      <dd className="font-mono">{usd(d.summary.pending.creditPending)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 rounded-md border border-line bg-raised p-3 text-sm">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                      <Clock aria-hidden className="h-3.5 w-3.5" /> Estimates ({d.summary.month}) — separate, never added to realized savings
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                      <span>
                        Waste avoided <span className="font-mono">{usd(d.summary.estimates.wasteAvoided)}</span>
                      </span>
                      <span>
                        Time saved <span className="font-mono">{usd(d.summary.estimates.timeSaved)}</span>
                      </span>
                    </div>
                    {Object.entries(d.summary.estimates.methods).map(([k, v]) => (
                      <p key={k} className="mt-1 text-[11px] text-muted">
                        {TYPE_LABEL[k] ?? k}: {String(v)}
                      </p>
                    ))}
                  </div>
                </Card>
              </div>
              <Card title="Ledger" icon={CircleDollarSign} subtitle="Every entry with its source and method" pad={false}>
                {entries.length ? (
                  <Table head={['When', 'Type', 'Amount', 'Status', 'Source', 'Method']} align={['left', 'left', 'right', 'left', 'left', 'left']}>
                    {entries.map((e: any) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{dt(e.created_at)}</td>
                        <td className="px-3 py-2">{TYPE_LABEL[e.type] ?? e.type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-right font-mono">{usd(e.amount)}</td>
                        <td className="px-3 py-2">{e.verified ? <Badge tone="green">verified</Badge> : <Badge>estimate / pending</Badge>}</td>
                        <td className="px-3 py-2 text-xs">
                          {LINK[e.source_type] ? (
                            <Link className="text-accent hover:underline" to={LINK[e.source_type](e.source_id)}>
                              {e.source_type.replace('_', ' ')}
                            </Link>
                          ) : (
                            e.source_type
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{e.method}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <div className="p-4">
                    <Empty icon={PiggyBank}>No savings recorded in this period. Approve an optimised order or recover a supplier credit.</Empty>
                  </div>
                )}
              </Card>
            </>
          );
        }}
      </Q>
    </div>
  );
}
