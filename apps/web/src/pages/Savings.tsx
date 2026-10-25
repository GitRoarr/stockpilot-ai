import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Card, dt, Empty, Q, Table, usd } from '../components/ui';

// Savings ledger (FR-095 – FR-097): verified and estimated panels are separate and never summed.
const LINK: Record<string, (id: string) => string> = { purchase_order: (id) => `/orders/${id}`, dispute: (id) => `/disputes/${id}` };

export function SavingsPage() {
  const q = useQuery({ queryKey: ['ledger'], queryFn: () => api<any>('/ledger') });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Savings</h1>
      <Q q={q}>
        {(d) => (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card title="Verified this month" subtitle={d.summary.month}>
                <div className="font-mono text-3xl text-emerald-700">{usd(d.summary.verified.total)}</div>
                <div className="mt-1 text-sm text-muted">
                  Optimiser {usd(d.summary.verified.optimiserSaving)} · Credits recovered {usd(d.summary.verified.creditRecovered)}
                </div>
                <p className="mt-2 text-[11px] text-muted">Optimiser savings count when a PO is approved: baseline (preferred suppliers, same needs, pack rounding and fees) minus the optimised cost.</p>
              </Card>
              <Card title="Pending credits">
                <div className="font-mono text-3xl">{usd(d.summary.pending.creditPending)}</div>
                <p className="mt-2 text-[11px] text-muted">Open disputes — not counted as saved until credited.</p>
              </Card>
              <Card title="Estimates" subtitle="Separate — never added to verified savings">
                <div className="space-y-1 text-sm">
                  <div>
                    Waste avoided <span className="font-mono">{usd(d.summary.estimates.wasteAvoided)}</span>
                  </div>
                  <div>
                    Time saved <span className="font-mono">{usd(d.summary.estimates.timeSaved)}</span>
                  </div>
                </div>
                {Object.entries(d.summary.estimates.methods).map(([k, v]) => (
                  <p key={k} className="mt-1 text-[11px] text-muted">
                    {k}: {String(v)}
                  </p>
                ))}
              </Card>
            </div>
            <Card title="Ledger" subtitle="Every entry with its source and method" pad={false}>
              {d.entries.length ? (
                <Table head={['When', 'Type', 'Amount', 'Verified', 'Source', 'Method']}>
                  {d.entries.map((e: any) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2 text-xs">{dt(e.created_at)}</td>
                      <td className="px-3 py-2">{e.type.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 font-mono">{usd(e.amount)}</td>
                      <td className="px-3 py-2">{e.verified ? <Badge tone="green">verified</Badge> : <Badge>estimate / pending</Badge>}</td>
                      <td className="px-3 py-2 text-xs">
                        {LINK[e.source_type] ? (
                          <Link className="text-accent" to={LINK[e.source_type](e.source_id)}>
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
                  <Empty>No savings recorded yet. Approve an optimised order or recover a credit.</Empty>
                </div>
              )}
            </Card>
          </>
        )}
      </Q>
    </div>
  );
}
