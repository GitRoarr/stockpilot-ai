import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { Badge, Button, Card, cx, dt, Empty, ErrorCard, inputCls, Modal, num, Q, Status, Table, usd } from '../components/ui';

const FILTERS = ['open', 'draft', 'pending_approval', 'approved', 'sent', 'partially_confirmed', 'confirmed', 'received', 'closed', 'cancelled'];
const OPEN = new Set(['draft', 'pending_approval', 'approved', 'sent', 'partially_confirmed', 'confirmed', 'partially_received']);

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') ?? 'open';
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api<any[]>('/purchase-orders') });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Purchase orders</h1>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setParams({ status: f })} className={cx('rounded-full border px-3 py-1 text-xs', f === filter ? 'border-accent bg-blue-50 text-accent' : 'border-line bg-card')}>
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <Card pad={false}>
        <Q q={q}>
          {(rows) => {
            const list = rows.filter((r) => (filter === 'open' ? OPEN.has(r.status) : r.status === filter));
            if (!list.length) return <div className="p-4"><Empty>No purchase orders here. The Buyer drafts them during the morning run.</Empty></div>;
            return (
              <Table head={['PO', 'Supplier', 'Lines', 'Total', 'Saving', 'Delivery', 'Status', '']}>
                {list.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">
                      <Link className="text-accent" to={`/orders/${r.id}`}>
                        {r.number}
                      </Link>
                      {r.parent_po_id && <Badge tone="violet">supplementary</Badge>}
                    </td>
                    <td className="px-3 py-2">{r.supplier}</td>
                    <td className="px-3 py-2 font-mono">{r.lineCount}</td>
                    <td className="px-3 py-2 font-mono">{usd(r.total)}</td>
                    <td className="px-3 py-2 font-mono text-emerald-700">{r.saving > 0 ? usd(r.saving) : '—'}</td>
                    <td className="px-3 py-2">{r.delivery_date}</td>
                    <td className="px-3 py-2">
                      <Status s={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link className="text-xs text-accent" to={`/orders/${r.id}`}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </Table>
            );
          }}
        </Q>
      </Card>
    </div>
  );
}

export function OrderDetailPage({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<any>(`/purchase-orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };
  const act = useMutation({ mutationFn: (a: 'approve' | 'send' | 'cancel') => post(`/purchase-orders/${id}/${a}`), onSuccess: refresh });
  const [send, setSend] = useState(false);
  const canEdit = me.user.role !== 'staff';
  return (
    <Q q={q}>
      {(po) => {
        const draft = po.status === 'draft';
        const portal = po.emails.map((e: any) => e.text?.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)?.[0]).filter(Boolean).pop();
        const limitBlocked = me.user.role === 'chef' && po.requiredRole === 'owner';
        return (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card
                title={
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{po.number}</span> {po.supplier.name}
                  </span>
                }
                subtitle={`Delivery ${po.delivery_date ?? '—'}${po.eta ? ` · ETA ${po.eta}` : ''}`}
                actions={<Status s={po.status} />}
              >
                {po.min_order_warning && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{po.min_order_warning}</div>}
                <Table head={['Item', 'SKU', 'Need', 'Packs', 'Qty', 'Price', 'Line', 'Supplier said']}>
                  {po.lines.map((l: any) => (
                    <Line key={l.id} po={po} l={l} editable={draft && canEdit} onSaved={refresh} />
                  ))}
                </Table>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <span>
                    Subtotal <b className="font-mono">{usd(po.subtotal)}</b>
                  </span>
                  <span>
                    Fees <b className="font-mono">{usd(po.fees)}</b>
                  </span>
                  <span>
                    Total <b className="font-mono text-lg">{usd(po.total)}</b>
                  </span>
                  {po.saving > 0 && (
                    <Badge tone="green">
                      Saves {usd(po.saving)} vs baseline {usd(po.baseline_total)}
                    </Badge>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['draft', 'pending_approval'].includes(po.status) && canEdit && (
                    <Button variant="primary" disabled={limitBlocked} busy={act.isPending && act.variables === 'approve'} onClick={() => act.mutate('approve')} title={limitBlocked ? 'Above your approval limit — Owner approval required' : undefined}>
                      Approve
                    </Button>
                  )}
                  {['draft', 'pending_approval', 'approved'].includes(po.status) && canEdit && (
                    <Button variant={po.status === 'approved' ? 'primary' : 'secondary'} disabled={limitBlocked && po.status !== 'approved'} onClick={() => setSend(true)}>
                      {po.status === 'approved' ? 'Send to supplier…' : 'Approve & send…'}
                    </Button>
                  )}
                  {['draft', 'pending_approval', 'approved'].includes(po.status) && canEdit && (
                    <Button variant="danger" onClick={() => act.mutate('cancel')}>
                      Cancel PO
                    </Button>
                  )}
                  {!['draft', 'pending_approval', 'cancelled'].includes(po.status) && (
                    <>
                      <a className="self-center text-sm text-accent" href={`/api/purchase-orders/${po.id}/print`} target="_blank" rel="noreferrer">
                        Print
                      </a>
                      <a className="self-center text-sm text-accent" href={`/api/purchase-orders/${po.id}/csv`}>
                        CSV
                      </a>
                    </>
                  )}
                  {['sent', 'confirmed', 'partially_confirmed', 'partially_received'].includes(po.status) && (
                    <Link className="self-center text-sm text-accent" to={`/receiving/po/${po.id}`}>
                      Receive delivery →
                    </Link>
                  )}
                </div>
                {limitBlocked && ['draft', 'pending_approval'].includes(po.status) && <p className="mt-2 text-xs text-amber-800">Above the Chef approval limit — the Owner must approve this order.</p>}
                {act.error && <div className="mt-2"><ErrorCard error={act.error} /></div>}
              </Card>
              {po.plan && <WhyPanel po={po} />}
              <Card title="Thread">
                <Thread type="purchase_order" id={po.id} />
              </Card>
            </div>
            <div className="space-y-4">
              <Card title="Supplier">
                <div className="space-y-1 text-sm">
                  <div className="font-medium">{po.supplier.name}</div>
                  <div className="text-xs text-muted">{po.supplier.email}</div>
                  <div className="text-xs">
                    Minimum {usd(po.supplier.minOrderValue)} ({po.supplier.minOrderType}
                    {po.supplier.minOrderType === 'soft' ? `, ${usd(po.supplier.belowMinFee)} fee below` : ''}) · delivery {usd(po.supplier.deliveryFee)} · cut-off {po.supplier.cutoffTime} {po.supplier.trusted && <Badge tone="green">trusted</Badge>}
                  </div>
                  {po.confirmation_deadline && <div className="text-xs">Confirmation due {dt(po.confirmation_deadline)} · reminders sent {po.reminders_sent}</div>}
                </div>
              </Card>
              {portal && (
                <Card title="Supplier portal link">
                  <p className="text-xs text-muted">{po.send_channel === 'manual_link' ? 'Email is not configured — share this link with the supplier.' : 'Sent by email. Single-PO link, valid 7 days.'}</p>
                  <a className="mt-1 block break-all font-mono text-xs text-accent" href={portal.replace(/^https?:\/\/[^/]+/, '')} target="_blank" rel="noreferrer">
                    {portal}
                  </a>
                </Card>
              )}
              <Card title="Supplier responses">
                {po.responses.length ? (
                  <ol className="space-y-2 text-sm">
                    {po.responses.map((r: any) => (
                      <li key={r.id} className="rounded-lg border border-line p-2">
                        <div className="text-xs text-muted">
                          v{r.version} · {dt(r.receivedAt)} {r.eta && `· ETA ${r.eta}`}
                        </div>
                        <ul className="text-xs">
                          {r.lines.map((l: any) => (
                            <li key={l.poLineId}>
                              {po.lines.find((x: any) => x.id === l.poLineId)?.ingredient}: {l.action}
                              {l.qty !== undefined ? ` ${l.qty}` : ''}
                              {l.substitute ? ` → “${l.substitute.description}” ${usd(l.substitute.unitPrice)}` : ''}
                            </li>
                          ))}
                        </ul>
                        {r.untrustedNote && <div className="mt-1 text-xs text-amber-800">Note (untrusted supplier text): “{r.untrustedNote}”</div>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">No response yet.</p>
                )}
              </Card>
              <Card title="Emails (outbox)">
                <ul className="space-y-1 text-xs">
                  {po.emails.map((e: any) => (
                    <li key={e.id}>
                      {e.kind} → {e.to_email} <Status s={e.status} /> {e.error && <span className="text-red-700">{e.error}</span>}
                    </li>
                  ))}
                  {!po.emails.length && <li className="text-muted">None</li>}
                </ul>
              </Card>
            </div>
            {send && <SendDialog po={po} onClose={() => setSend(false)} onDone={refresh} />}
          </div>
        );
      }}
    </Q>
  );
}

function Line({ po, l, editable, onSaved }: { po: any; l: any; editable: boolean; onSaved: () => void }) {
  const [packs, setPacks] = useState<number>(l.packs);
  const m = useMutation({ mutationFn: () => patch(`/purchase-orders/${po.id}/lines/${l.id}`, { packs }), onSuccess: onSaved });
  const said = l.unavailable ? 'unavailable' : l.substitute ? `substitute: ${l.substitute.description}` : l.confirmed_qty !== null ? `${num(l.confirmed_qty)} confirmed` : '—';
  return (
    <tr className={cx(l.packs === 0 && 'opacity-50')}>
      <td className="px-3 py-2">
        <div className="font-medium">{l.ingredient}</div>
        {l.rationale && <div className="text-[11px] text-muted">{l.rationale}</div>}
        {l.edited_by_user ? <Badge tone="violet">edited</Badge> : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{l.sku}</td>
      <td className="px-3 py-2 font-mono">{num(l.need)}</td>
      <td className="px-3 py-2">
        {editable ? (
          <span className="flex items-center gap-1">
            <input aria-label={`Packs of ${l.ingredient}`} type="number" min={0} className={cx(inputCls, 'w-16 font-mono')} value={packs} onChange={(e) => setPacks(Math.max(0, Math.floor(Number(e.target.value))))} />
            {packs !== l.packs && (
              <Button busy={m.isPending} onClick={() => m.mutate()}>
                Save
              </Button>
            )}
          </span>
        ) : (
          <span className="font-mono">
            {l.packs} × {l.pack_size}
          </span>
        )}
        {m.error && <div className="text-xs text-red-700">{(m.error as Error).message}</div>}
      </td>
      <td className="px-3 py-2 font-mono">
        {num(l.qty)} {l.unit}
      </td>
      <td className="px-3 py-2 font-mono">{usd(l.unit_price)}</td>
      <td className="px-3 py-2 font-mono">{usd(l.line_total)}</td>
      <td className="px-3 py-2 text-xs">{said}</td>
    </tr>
  );
}

function WhyPanel({ po }: { po: any }) {
  const p = po.plan;
  return (
    <Card title="Why this supplier?" subtitle={`Plan ${p.method === 'milp' ? 'MILP (HiGHS), verified' : 'heuristic'}${p.fallbackReason ? ` · ${p.fallbackReason}` : ''}`} actions={p.method !== 'milp' && <Badge>heuristic plan</Badge>}>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Optimised (all suppliers)</div>
          <div className="font-mono text-xl">{usd(p.total)}</div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Baseline (preferred suppliers)</div>
          <div className="font-mono text-xl">{usd(p.baselineTotal)}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Saving</div>
          <div className="font-mono text-xl text-emerald-700">{usd(p.saving)}</div>
        </div>
      </div>
      {p.explanations._summary && <p className="mt-2 text-sm">Across today's orders: {p.explanations._summary}.</p>}
      <div className="mt-3 text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Baseline would have been</div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {p.baseline.suppliers.map((s: any) => (
            <li key={s.supplierId}>
              {s.name}: lines {usd(s.subtotal)} + delivery {usd(s.deliveryFee)}
              {s.belowMinFee ? ` + small-order fee ${usd(s.belowMinFee)}` : ''} = <span className="font-mono">{usd(s.total)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-[11px] text-muted">Quantities, prices and totals come from the optimiser and are independently verified; the AI never writes them. [Illustrative demo data]</p>
    </Card>
  );
}

function SendDialog({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => post(`/purchase-orders/${po.id}/send`),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Send ${po.number}`}
      footer={
        <Button variant="primary" busy={m.isPending} onClick={() => m.mutate()}>
          {po.status === 'approved' ? 'Send' : 'Approve & send'}
        </Button>
      }
    >
      <div className="space-y-2 text-sm">
        <p>
          To <b>{po.supplier.name}</b> &lt;{po.supplier.email}&gt; — in demo mode the email goes to the demo inbox (SUPPLIER_EMAIL_OVERRIDE).
        </p>
        <p>
          {po.lines.filter((l: any) => l.packs > 0).length} lines · total <b className="font-mono">{usd(po.total)}</b>. The email contains a single-PO portal link (7 days) to confirm, short or substitute.
        </p>
        {m.error && <ErrorCard error={m.error} />}
      </div>
    </Modal>
  );
}
