import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, Check, ChevronRight, ClipboardList, Download, ExternalLink, History, Mail, Printer, Send, Truck } from 'lucide-react';
import { api, patch, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { useToast } from '../components/toast';
import { Badge, Button, Card, ConfirmDialog, cx, dt, Empty, ErrorCard, inputCls, Modal, num, PageHeader, Q, SearchInput, Status, Table, Tabs, usd, usePaged, useSorted } from '../components/ui';

const FILTERS = [
  ['open', 'Open'],
  ['pending_approval', 'Pending approval'],
  ['sent', 'Sent'],
  ['partially_confirmed', 'Partial'],
  ['confirmed', 'Confirmed'],
  ['received', 'Received'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const;
type Filter = (typeof FILTERS)[number][0];
const OPEN = new Set(['draft', 'pending_approval', 'approved', 'sent', 'partially_confirmed', 'confirmed', 'partially_received']);
const inFilter = (f: Filter, s: string) => (f === 'all' ? true : f === 'open' ? OPEN.has(s) : f === 'received' ? s === 'received' || s === 'partially_received' : s === f);

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const filter = ((params.get('status') as Filter) ?? 'open') as Filter;
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api<any[]>('/purchase-orders') });
  const counts = q.data && (Object.fromEntries(FILTERS.map(([f]) => [f, q.data!.filter((r) => inFilter(f, r.status)).length])) as Record<Filter, number>);
  return (
    <div className="space-y-4">
      <PageHeader title="Purchase orders" description="Orders drafted by the Buyer from the optimiser plan, from approval to delivery." />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label="Order status" value={filter} onChange={(f) => setParams({ status: f })} options={FILTERS} counts={counts} />
        <SearchInput className="ml-auto w-full sm:w-56" value={search} onChange={setSearch} placeholder="Search PO or supplier…" label="Search orders" />
      </div>
      <Card pad={false}>
        <Q q={q}>
          {(rows) => {
            const list = rows.filter((r) => inFilter(filter, r.status) && (!search || `${r.number} ${r.supplier}`.toLowerCase().includes(search.toLowerCase())));
            if (!list.length)
              return (
                <div className="p-4">
                  <Empty icon={ClipboardList} title="No purchase orders here">
                    {search ? 'No order matches your search.' : 'The Buyer drafts orders during the morning plan; they appear here for approval.'}
                  </Empty>
                </div>
              );
            return <OrderTable rows={list} />;
          }}
        </Q>
      </Card>
    </div>
  );
}

const RECEIVABLE = new Set(['sent', 'confirmed', 'partially_confirmed', 'partially_received']);

function OrderTable({ rows }: { rows: any[] }) {
  const sorted = useSorted(rows, { number: (r) => r.number, supplier: (r) => r.supplier, total: (r) => r.total, delivery: (r) => r.delivery_date, status: (r) => r.status }, { key: 'number', dir: 'desc' });
  const paged = usePaged(sorted.rows, 15);
  return (
    <>
      <Table
        head={[sorted.header('number', 'Order'), sorted.header('supplier', 'Supplier'), 'Items', sorted.header('total', 'Total'), 'Saving', sorted.header('delivery', 'Delivery'), sorted.header('status', 'Status'), <span className="sr-only">Actions</span>]}
        align={['left', 'left', 'right', 'right', 'right', 'left', 'left', 'right']}
      >
        {paged.rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap px-3 py-2">
              <Link className="font-mono text-[13px] font-medium text-accent hover:underline" to={`/orders/${r.id}`}>
                {r.number}
              </Link>
              {r.parent_po_id && (
                <span className="ml-1.5">
                  <Badge tone="violet">follow-up</Badge>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              <span className="flex items-center gap-2.5">
                <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised text-[11px] font-semibold text-muted ring-1 ring-line">
                  {initials(r.supplier)}
                </span>
                <span className="min-w-0 truncate">{r.supplier}</span>
              </span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{r.lineCount}</td>
            <td className="px-3 py-2 text-right tabular-nums">{usd(r.total)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.saving > 0 ? usd(r.saving) : <span className="text-muted">—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2">{r.delivery_date ?? '—'}</td>
            <td className="px-3 py-2">
              <Status s={r.status} />
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right">
              {r.status === 'pending_approval' || r.status === 'draft' ? (
                <Link className="text-xs font-medium text-accent hover:underline" to={`/orders/${r.id}`}>
                  Review
                </Link>
              ) : RECEIVABLE.has(r.status) ? (
                <Link className="text-xs font-medium text-accent hover:underline" to={`/receiving/po/${r.id}`}>
                  Receive
                </Link>
              ) : (
                <Link aria-label={`Open ${r.number}`} className="inline-grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink" to={`/orders/${r.id}`}>
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </Link>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {paged.pager}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const linkBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-sm font-medium shadow-card hover:bg-raised';

export function OrderDetailPage({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<any>(`/purchase-orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const act = useMutation({
    mutationFn: (a: 'approve' | 'cancel') => post(`/purchase-orders/${id}/${a}`),
    onSuccess: (_r, a) => {
      refresh();
      setCancel(false);
      toast(a === 'approve' ? 'success' : 'info', a === 'approve' ? 'Order approved' : 'Order cancelled');
    },
    onError: (e) => toast('error', 'Action failed', (e as Error).message),
  });
  const [send, setSend] = useState(false);
  const [cancel, setCancel] = useState(false);
  const canEdit = me.user.role !== 'staff';
  return (
    <Q q={q}>
      {(po) => {
        const draft = po.status === 'draft';
        const portal = po.emails.map((e: any) => e.text?.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)?.[0]).filter(Boolean).pop();
        const limitBlocked = me.user.role === 'chef' && po.requiredRole === 'owner';
        const decidable = ['draft', 'pending_approval'].includes(po.status) && canEdit;
        const sendable = ['draft', 'pending_approval', 'approved'].includes(po.status) && canEdit;
        return (
          <div className="space-y-4">
            <PageHeader
              crumbs={[{ label: 'Orders', to: '/orders' }, { label: po.number }]}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{po.number}</span>
                  <span className="font-normal text-muted">·</span> {po.supplier.name} <Status s={po.status} />
                </span>
              }
              description={`Delivery ${po.delivery_date ?? '—'}${po.eta ? ` · ETA ${po.eta}` : ''} · created ${dt(po.created_at)}`}
              actions={
                <>
                  {!['draft', 'pending_approval', 'cancelled'].includes(po.status) && (
                    <>
                      <a className={linkBtn} href={`/api/purchase-orders/${po.id}/print`} target="_blank" rel="noreferrer">
                        <Printer aria-hidden className="h-3.5 w-3.5" /> Print
                      </a>
                      <a className={linkBtn} href={`/api/purchase-orders/${po.id}/csv`}>
                        <Download aria-hidden className="h-3.5 w-3.5" /> CSV
                      </a>
                    </>
                  )}
                  {['sent', 'confirmed', 'partially_confirmed', 'partially_received'].includes(po.status) && (
                    <Link className={linkBtn} to={`/receiving/po/${po.id}`}>
                      <Truck aria-hidden className="h-3.5 w-3.5" /> Receive delivery
                    </Link>
                  )}
                  {sendable && (
                    <Button variant="danger" icon={Ban} onClick={() => setCancel(true)}>
                      Cancel order
                    </Button>
                  )}
                  {decidable && (
                    <Button disabled={limitBlocked} icon={Check} busy={act.isPending && act.variables === 'approve'} onClick={() => act.mutate('approve')} title={limitBlocked ? 'Above your approval limit — Owner approval required' : undefined}>
                      Approve
                    </Button>
                  )}
                  {sendable && (
                    <Button variant="primary" icon={Send} disabled={limitBlocked && po.status !== 'approved'} onClick={() => setSend(true)}>
                      {po.status === 'approved' ? 'Send to supplier…' : 'Approve & send…'}
                    </Button>
                  )}
                </>
              }
            />
            {limitBlocked && decidable && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Above the Chef approval limit — the Owner must approve this order.</p>}
            {act.error && <ErrorCard error={act.error} />}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <Card title="Order lines" icon={ClipboardList} pad={false} subtitle={draft && canEdit ? 'Draft — pack counts can be edited' : undefined}>
                  {po.min_order_warning && <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{po.min_order_warning}</div>}
                  <Table head={['Item', 'SKU', 'Need', 'Packs', 'Qty', 'Price', 'Line', 'Supplier said']} align={['left', 'left', 'right', 'left', 'right', 'right', 'right', 'left']}>
                    {po.lines.map((l: any) => (
                      <Line key={l.id} po={po} l={l} editable={draft && canEdit} onSaved={refresh} />
                    ))}
                  </Table>
                  <dl className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-muted">Subtotal</dt>
                      <dd className="font-mono">{usd(po.subtotal)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted">Fees</dt>
                      <dd className="font-mono">{usd(po.fees)}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="text-muted">Total</dt>
                      <dd className="font-mono text-base font-semibold">{usd(po.total)}</dd>
                    </div>
                    {po.saving > 0 && (
                      <Badge tone="green">
                        Saves {usd(po.saving)} vs baseline {usd(po.baseline_total)}
                      </Badge>
                    )}
                  </dl>
                </Card>
                {po.plan && <WhyPanel po={po} />}
                <Card title="Thread" subtitle="Discuss this order with the team; @mention an agent to ask it">
                  <Thread type="purchase_order" id={po.id} />
                </Card>
              </div>
              <div className="min-w-0 space-y-4">
                <Card title="Supplier">
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      {po.supplier.name} {po.supplier.trusted && <Badge tone="green">trusted</Badge>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <Mail aria-hidden className="h-3.5 w-3.5" /> {po.supplier.email}
                    </div>
                    <Row label="Minimum order" value={`${usd(po.supplier.minOrderValue)} (${po.supplier.minOrderType}${po.supplier.minOrderType === 'soft' ? `, ${usd(po.supplier.belowMinFee)} fee below` : ''})`} />
                    <Row label="Delivery fee" value={usd(po.supplier.deliveryFee)} />
                    <Row label="Order cut-off" value={po.supplier.cutoffTime} />
                    {po.confirmation_deadline && <Row label="Confirmation due" value={`${dt(po.confirmation_deadline)} · ${po.reminders_sent} reminder(s)`} />}
                  </dl>
                </Card>
                {portal && (
                  <Card title="Supplier portal link">
                    <p className="text-xs text-muted">{po.send_channel === 'manual_link' ? 'Email is not configured — share this link with the supplier.' : 'Sent by email. Single-order link, valid 7 days.'}</p>
                    <a className="mt-1.5 flex items-start gap-1 break-all font-mono text-xs text-accent hover:underline" href={portal.replace(/^https?:\/\/[^/]+/, '')} target="_blank" rel="noreferrer">
                      {portal}
                      <ExternalLink aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                    </a>
                  </Card>
                )}
                <Card title="Supplier responses">
                  {po.responses.length ? (
                    <ol className="space-y-2 text-sm">
                      {po.responses.map((r: any) => (
                        <li key={r.id} className="rounded-md border border-line p-2.5">
                          <div className="text-xs text-muted">
                            v{r.version} · {dt(r.receivedAt)} {r.eta && `· ETA ${r.eta}`}
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {r.lines.map((l: any) => (
                              <li key={l.poLineId} className="flex flex-wrap gap-1">
                                <span className="font-medium">{po.lines.find((x: any) => x.id === l.poLineId)?.ingredient}:</span>
                                <Badge tone={l.action === 'confirm' ? 'green' : l.action === 'unavailable' ? 'red' : 'amber'}>{l.action}</Badge>
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
                <Card title="History" icon={History}>
                  {po.history?.length ? (
                    <ol className="relative space-y-3 border-l border-line pl-4 text-sm">
                      {po.history.map((h: any) => (
                        <li key={h.id} className="relative">
                          <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-card bg-slate-300" />
                          <div className="first-letter:uppercase">{h.action.replace(/^po\./, '').replace(/[._]/g, ' ')}</div>
                          <div className="text-xs text-muted">
                            {h.actor} · {dt(h.at)}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted">No changes recorded.</p>
                  )}
                </Card>
                <Card title="Emails (outbox)">
                  <ul className="space-y-1.5 text-xs">
                    {po.emails.map((e: any) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{e.kind.replace(/_/g, ' ')}</span> → {e.to_email} <Status s={e.status} /> {e.error && <span className="text-red-700">{e.error}</span>}
                      </li>
                    ))}
                    {!po.emails.length && <li className="text-muted">None</li>}
                  </ul>
                </Card>
              </div>
            </div>
            {send && <SendDialog po={po} onClose={() => setSend(false)} onDone={refresh} />}
            <ConfirmDialog
              open={cancel}
              title={`Cancel ${po.number}?`}
              body={`The order to ${po.supplier.name} (${usd(po.total)}) will be cancelled and will not be sent. This cannot be undone.`}
              confirmLabel="Cancel order"
              tone="danger"
              busy={act.isPending && act.variables === 'cancel'}
              onConfirm={() => act.mutate('cancel')}
              onClose={() => setCancel(false)}
            />
          </div>
        );
      }}
    </Q>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Line({ po, l, editable, onSaved }: { po: any; l: any; editable: boolean; onSaved: () => void }) {
  const [packs, setPacks] = useState<number>(l.packs);
  const toast = useToast();
  const m = useMutation({ mutationFn: () => patch(`/purchase-orders/${po.id}/lines/${l.id}`, { packs }), onSuccess: () => (onSaved(), toast('success', `${l.ingredient} updated`, 'Recorded as a correction.')) });
  const said = l.unavailable ? <Badge tone="red">unavailable</Badge> : l.substitute ? <Badge tone="amber">substitute: {l.substitute.description}</Badge> : l.confirmed_qty !== null ? <span className={cx(l.confirmed_qty < l.qty && 'text-amber-800')}>{num(l.confirmed_qty)} confirmed</span> : <span className="text-muted">—</span>;
  return (
    <tr className={cx(l.packs === 0 && 'opacity-50')}>
      <td className="px-3 py-2">
        <div className="font-medium">{l.ingredient}</div>
        {l.rationale && <div className="text-[11px] text-muted">{l.rationale}</div>}
        {l.edited_by_user ? <Badge tone="violet">edited</Badge> : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{l.sku}</td>
      <td className="px-3 py-2 text-right font-mono">{num(l.need)}</td>
      <td className="px-3 py-2">
        {editable ? (
          <span className="flex items-center gap-1">
            <input aria-label={`Packs of ${l.ingredient}`} type="number" min={0} className={cx(inputCls.replace('w-full ', ''), 'w-16 font-mono')} value={packs} onChange={(e) => setPacks(Math.max(0, Math.floor(Number(e.target.value))))} />
            {packs !== l.packs && (
              <Button size="sm" busy={m.isPending} onClick={() => m.mutate()}>
                Save
              </Button>
            )}
          </span>
        ) : (
          <span className="whitespace-nowrap font-mono">
            {l.packs} × {l.pack_size}
          </span>
        )}
        {m.error && <div className="text-xs text-red-700">{(m.error as Error).message}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
        {num(l.qty)} {l.unit}
      </td>
      <td className="px-3 py-2 text-right font-mono">{usd(l.unit_price)}</td>
      <td className="px-3 py-2 text-right font-mono">{usd(l.line_total)}</td>
      <td className="px-3 py-2 text-xs">{said}</td>
    </tr>
  );
}

function WhyPanel({ po }: { po: any }) {
  const p = po.plan;
  return (
    <Card title="Why this supplier?" subtitle={`Plan ${p.method === 'milp' ? 'MILP (HiGHS), verified' : 'heuristic'}${p.fallbackReason ? ` · ${p.fallbackReason}` : ''}`} actions={p.method !== 'milp' && <Badge>heuristic plan</Badge>}>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-md border border-line p-3">
          <div className="text-xs text-muted">Optimised (all suppliers)</div>
          <div className="mt-0.5 font-mono text-lg font-semibold">{usd(p.total)}</div>
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="text-xs text-muted">Baseline (preferred suppliers)</div>
          <div className="mt-0.5 font-mono text-lg font-semibold">{usd(p.baselineTotal)}</div>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xs text-emerald-800">Saving</div>
          <div className="mt-0.5 font-mono text-lg font-semibold text-emerald-700">{usd(p.saving)}</div>
        </div>
      </div>
      {p.explanations._summary && <p className="mt-3 text-sm">Across today's orders: {p.explanations._summary}.</p>}
      <div className="mt-3 text-sm">
        <div className="text-xs font-medium text-muted">The preferred-supplier baseline would have been</div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {p.baseline.suppliers.map((s: any) => (
            <li key={s.supplierId} className="flex flex-wrap justify-between gap-x-3">
              <span>
                {s.name}: lines {usd(s.subtotal)} + delivery {usd(s.deliveryFee)}
                {s.belowMinFee ? ` + small-order fee ${usd(s.belowMinFee)}` : ''}
              </span>
              <span className="font-mono">{usd(s.total)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[11px] text-muted">Quantities, prices and totals come from the optimiser and are independently verified; the AI never writes them.</p>
    </Card>
  );
}

function SendDialog({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => post(`/purchase-orders/${po.id}/send`),
    onSuccess: () => {
      onDone();
      onClose();
      toast('success', `${po.number} sent`, `${po.supplier.name} can now confirm, reduce or substitute lines.`);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Send ${po.number} to ${po.supplier.name}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Send} busy={m.isPending} onClick={() => m.mutate()}>
            {po.status === 'approved' ? 'Send' : 'Approve & send'}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm">
        <p>
          To <b>{po.supplier.name}</b> &lt;{po.supplier.email}&gt; — while SUPPLIER_EMAIL_OVERRIDE is set, it goes to that inbox instead.
        </p>
        <p>
          {po.lines.filter((l: any) => l.packs > 0).length} lines · total <b className="font-mono">{usd(po.total)}</b>. The email contains a single-order portal link (7 days) to confirm, short or substitute.
        </p>
        <p className="flex items-center gap-1 text-xs text-muted">
          <ArrowRight aria-hidden className="h-3 w-3" /> Without email configured, a portal link appears on this page to share instead.
        </p>
        {m.error && <ErrorCard error={m.error} />}
      </div>
    </Modal>
  );
}
