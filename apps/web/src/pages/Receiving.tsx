import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post, put, upload } from '../api/client';
import type { Me } from '../components/Layout';
import { Badge, Button, Card, cx, dt, Empty, ErrorCard, Field, inputCls, num, Q, Status, Table, usd } from '../components/ui';

const RECEIVABLE = new Set(['sent', 'confirmed', 'partially_confirmed', 'partially_received']);

export function ReceivingPage() {
  const nav = useNavigate();
  const pos = useQuery({ queryKey: ['orders'], queryFn: () => api<any[]>('/purchase-orders') });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<any[]>('/invoices') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const up = useMutation({
    mutationFn: () => {
      if (!file) return post<any>('/invoices/manual', { supplierId, purchaseOrderId: poId || undefined });
      const f = new FormData();
      f.append('supplierId', supplierId);
      if (poId) f.append('purchaseOrderId', poId);
      f.append('file', file);
      return upload<any>('/invoices', f);
    },
    onSuccess: (inv) => nav(`/receiving/invoices/${inv.id}`),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    up.mutate();
  };
  const supplierPos = (pos.data ?? []).filter((p) => p.supplier_id === supplierId && !['draft', 'pending_approval', 'cancelled'].includes(p.status));
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Receiving & invoices</h1>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Deliveries to receive">
          <Q q={pos}>
            {(rows) => {
              const list = rows.filter((p) => RECEIVABLE.has(p.status));
              if (!list.length) return <Empty>No deliveries expected. Sent and confirmed orders appear here.</Empty>;
              return (
                <ul className="divide-y divide-line">
                  {list.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="font-mono">{p.number}</span> {p.supplier} <Status s={p.status} />
                      <span className="text-xs text-muted">{p.delivery_date}</span>
                      <Link className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white" to={`/receiving/po/${p.id}`}>
                        Receive
                      </Link>
                    </li>
                  ))}
                </ul>
              );
            }}
          </Q>
        </Card>
        <Card title="Capture an invoice" subtitle="Photo (JPEG, PNG, WEBP, HEIC · ≤ 10 MB) or manual entry">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Supplier">
              <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Choose…</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Purchase order">
              <select className={inputCls} value={poId} onChange={(e) => setPoId(e.target.value)}>
                <option value="">Unknown</option>
                {supplierPos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {usd(p.total)} · {p.status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invoice photo" hint="Demo: use data/sample-invoice/INV-GG-20817.png for the Golden Gate order">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </Field>
            {up.error && <ErrorCard error={up.error} />}
            <Button type="submit" variant="primary" busy={up.isPending} disabled={!supplierId}>
              {file ? 'Upload & extract' : 'Enter manually'}
            </Button>
          </form>
        </Card>
      </div>
      <Card title="Invoices" pad={false}>
        <Q q={invoices}>
          {(rows) =>
            rows.length ? (
              <Table head={['Invoice', 'Supplier', 'PO', 'Total', 'Status', 'Captured']}>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">
                      <Link className="text-accent" to={`/receiving/invoices/${r.id}`}>
                        {r.number ?? 'draft'}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.supplier}</td>
                    <td className="px-3 py-2 font-mono">{r.po_number ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{usd(r.total)}</td>
                    <td className="px-3 py-2">
                      <Status s={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs">{dt(r.created_at)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-4">
                <Empty>No invoices yet.</Empty>
              </div>
            )
          }
        </Q>
      </Card>
    </div>
  );
}

export function ReceivePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receiving', id], queryFn: () => api<any>(`/receipts/form/${id}`) });
  const [lines, setLines] = useState<Record<string, { qty: number; condition: 'ok' | 'damaged' | 'rejected'; expiresAt: string }>>({});
  useEffect(() => {
    if (q.data) setLines(Object.fromEntries(q.data.lines.map((l: any) => [l.poLineId, { qty: l.prefill, condition: 'ok', expiresAt: '' }])));
  }, [q.data]);
  const m = useMutation({
    mutationFn: () => post('/receipts', { purchaseOrderId: id, lines: Object.entries(lines).map(([poLineId, v]) => ({ poLineId, qtyReceived: v.qty, condition: v.condition, expiresAt: v.expiresAt || undefined })) }),
    onSuccess: () => {
      qc.invalidateQueries();
      nav('/receiving');
    },
  });
  return (
    <Q q={q}>
      {(d) => (
        <Card title={`Receive ${d.po.number}`} subtitle={`Pre-filled from the supplier confirmation${d.po.eta ? ` · ETA ${d.po.eta}` : ''}`} actions={<Status s={d.po.status} />}>
          <ul className="space-y-3">
            {d.lines.map((l: any) => {
              const v = lines[l.poLineId];
              if (!v) return null;
              return (
                <li key={l.poLineId} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.ingredient}</span>
                    <span className="font-mono text-xs text-muted">
                      ordered {num(l.ordered)} {l.unit}
                      {l.confirmed !== null && ` · confirmed ${num(l.confirmed)}`}
                      {l.alreadyReceived > 0 && ` · received ${num(l.alreadyReceived)}`}
                    </span>
                    {l.unavailable && <Badge tone="red">unavailable</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Field label={`Received (${l.unit})`}>
                      <input className={cx(inputCls, 'font-mono')} type="number" min={0} step="any" inputMode="decimal" value={v.qty} onChange={(e) => setLines({ ...lines, [l.poLineId]: { ...v, qty: Number(e.target.value) } })} />
                    </Field>
                    <Field label="Condition">
                      <select className={inputCls} value={v.condition} onChange={(e) => setLines({ ...lines, [l.poLineId]: { ...v, condition: e.target.value as 'ok' } })}>
                        <option value="ok">OK</option>
                        <option value="damaged">Damaged (kept)</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </Field>
                    <Field label="Expiry">
                      <input className={inputCls} type="date" value={v.expiresAt} onChange={(e) => setLines({ ...lines, [l.poLineId]: { ...v, expiresAt: e.target.value } })} />
                    </Field>
                  </div>
                </li>
              );
            })}
          </ul>
          {m.error && <div className="mt-2"><ErrorCard error={m.error} /></div>}
          <Button variant="primary" className="mt-4 w-full sm:w-auto" busy={m.isPending} onClick={() => m.mutate()}>
            Confirm receipt
          </Button>
        </Card>
      )}
    </Q>
  );
}

type Ext = { supplierName: string; invoiceNumber: string; date: string; currency: string; lines: { description: string; sku?: string | null; qty: number; unit?: string | null; unitPrice: number; extended: number; confidence: number }[]; subtotal?: number | null; tax?: number | null; deliveryFee?: number | null; total: number };

export function InvoicePage({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<any>(`/invoices/${id}`) });
  const [ext, setExt] = useState<Ext | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [suggest, setSuggest] = useState<any>(null);
  useEffect(() => {
    if (q.data) setExt(q.data.extraction ?? { supplierName: q.data.supplier, invoiceNumber: '', date: new Date().toISOString().slice(0, 10), currency: 'USD', lines: [], subtotal: null, tax: 0, deliveryFee: 0, total: 0 });
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice', id] });
  const save = useMutation({ mutationFn: () => put(`/invoices/${id}/extraction`, ext), onSuccess: refresh });
  const confirm = useMutation({
    mutationFn: (acceptIssues: boolean) => post(`/invoices/${id}/confirm`, { acceptIssues, mappings: Object.entries(mapping).map(([lineId, poLineId]) => ({ lineId, poLineId: poLineId === 'none' ? null : poLineId })) }),
    onSuccess: refresh,
  });
  const sug = useMutation({ mutationFn: () => post<any>(`/invoices/${id}/suggest-mappings`), onSuccess: (r) => setSuggest(r) });
  const accept = useMutation({ mutationFn: (lineId: string) => post(`/invoices/${id}/accept-price`, { lineId }), onSuccess: refresh });
  return (
    <Q q={q}>
      {(inv) => {
        const editable = ['uploaded', 'extracted', 'needs_review'].includes(inv.status);
        const lineIssue = (i: number) => inv.issues.find((x: any) => x.field === `lines.${i}.extended` || x.field === `lines.${i}`);
        return (
          <div className="grid gap-5 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-2">
              <Card title={`Invoice ${inv.number ?? ''}`} subtitle={`${inv.supplier} · ${inv.poNumber ?? 'no PO'}`} actions={<Status s={inv.status} />}>
                <div className="mb-2 text-xs">
                  Extraction: <Badge tone={inv.extractionMode?.startsWith('gemini') ? 'green' : 'amber'}>{inv.extractionMode}</Badge>
                </div>
                {inv.imageUrl ? <img src={inv.imageUrl} alt="Invoice photo" className="w-full rounded-lg border border-line" /> : <Empty>No photo — manual entry.</Empty>}
              </Card>
              {inv.dispute && (
                <Card title="Dispute">
                  <Link className="text-accent" to={`/disputes/${inv.dispute.id}`}>
                    {inv.dispute.number}
                  </Link>{' '}
                  <Status s={inv.dispute.status} /> {usd(inv.dispute.amount_claimed)}
                </Card>
              )}
            </div>
            <div className="space-y-4 lg:col-span-3">
              {editable && ext && (
                <Card title="Review extraction" subtitle="Low-confidence and failed checks are highlighted" actions={<Button busy={save.isPending} onClick={() => save.mutate()}>Save & re-check</Button>}>
                  {inv.issues.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {inv.issues.map((x: any, i: number) => (
                        <li key={i} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          <b>{x.field}</b>: {x.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label="Invoice #">
                      <input className={inputCls} value={ext.invoiceNumber} onChange={(e) => setExt({ ...ext, invoiceNumber: e.target.value })} />
                    </Field>
                    <Field label="Date">
                      <input className={inputCls} type="date" value={ext.date} onChange={(e) => setExt({ ...ext, date: e.target.value })} />
                    </Field>
                    <Field label="Supplier name">
                      <input className={inputCls} value={ext.supplierName} onChange={(e) => setExt({ ...ext, supplierName: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-3 space-y-2">
                    {ext.lines.map((l, i) => {
                      const set = (patch: Partial<typeof l>) => setExt({ ...ext, lines: ext.lines.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                      const bad = Math.abs(Math.round(l.qty * l.unitPrice * 100) / 100 - l.extended) > 0.01;
                      return (
                        <div key={i} className={cx('grid grid-cols-6 gap-1 rounded-lg border p-2', lineIssue(i) ? 'border-amber-300 bg-amber-50/50' : 'border-line')}>
                          <input aria-label="Description" className={cx(inputCls, 'col-span-6 sm:col-span-2')} value={l.description} onChange={(e) => set({ description: e.target.value })} />
                          <input aria-label="SKU" className={cx(inputCls, 'font-mono')} value={l.sku ?? ''} onChange={(e) => set({ sku: e.target.value })} placeholder="SKU" />
                          <input aria-label="Qty" className={cx(inputCls, 'font-mono')} type="number" step="any" value={l.qty} onChange={(e) => set({ qty: Number(e.target.value) })} />
                          <input aria-label="Unit price" className={cx(inputCls, 'font-mono')} type="number" step="0.01" value={l.unitPrice} onChange={(e) => set({ unitPrice: Number(e.target.value) })} />
                          <input aria-label="Amount" className={cx(inputCls, 'font-mono', bad && 'border-red-400')} type="number" step="0.01" value={l.extended} onChange={(e) => set({ extended: Number(e.target.value) })} />
                          <span className="col-span-6 flex items-center gap-2 text-[11px] text-muted">
                            {bad ? <Badge tone="red">math_error</Badge> : <Badge tone="green">arithmetic ok</Badge>} confidence {num(l.confidence, 2)}
                            <button className="ml-auto text-red-700" onClick={() => setExt({ ...ext, lines: ext.lines.filter((_, k) => k !== i) })}>
                              remove
                            </button>
                          </span>
                        </div>
                      );
                    })}
                    <Button variant="ghost" onClick={() => setExt({ ...ext, lines: [...ext.lines, { description: '', sku: '', qty: 0, unit: '', unitPrice: 0, extended: 0, confidence: 1 }] })}>
                      + Add line
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['subtotal', 'deliveryFee', 'tax', 'total'] as const).map((k) => (
                      <Field key={k} label={k}>
                        <input className={cx(inputCls, 'font-mono')} type="number" step="0.01" value={ext[k] ?? ''} onChange={(e) => setExt({ ...ext, [k]: e.target.value === '' ? null : Number(e.target.value) })} />
                      </Field>
                    ))}
                  </div>
                  {save.error && <ErrorCard error={save.error} />}
                  {inv.lines.length > 0 && inv.poLines.length > 0 && (
                    <div className="mt-4 border-t border-line pt-3">
                      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                        Line mapping <span className="text-xs font-normal text-muted">SKU → description similarity → AP Clerk suggestion (you confirm)</span>
                        <Button className="ml-auto" busy={sug.isPending} onClick={() => sug.mutate()}>
                          Ask AP Clerk
                        </Button>
                      </div>
                      {suggest && <p className="text-xs text-muted">Suggestion mode: {suggest.mode}</p>}
                      {inv.lines.map((l: any) => {
                        const s = suggest?.mappings?.find((m: any) => m.lineId === l.id);
                        return (
                          <div key={l.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                            <span className="w-48 truncate">{l.description}</span>
                            <select className={cx(inputCls, 'w-56')} value={mapping[l.id] ?? s?.poLineId ?? ''} onChange={(e) => setMapping({ ...mapping, [l.id]: e.target.value })}>
                              <option value="">Auto (SKU / similarity)</option>
                              {inv.poLines.map((p: any) => (
                                <option key={p.id} value={p.id}>
                                  {p.ingredient} ({p.sku})
                                </option>
                              ))}
                              <option value="none">Not ordered</option>
                            </select>
                            {s && <span className="text-xs text-muted">AP Clerk: {s.reason}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="primary" busy={confirm.isPending} disabled={!inv.poNumber} onClick={() => confirm.mutate(false)}>
                      Confirm & match
                    </Button>
                    {inv.issues.length > 0 && <Button onClick={() => confirm.mutate(true)}>I checked the flagged fields — match anyway</Button>}
                  </div>
                  {confirm.error && <div className="mt-2"><ErrorCard error={confirm.error} /></div>}
                </Card>
              )}
              {!editable && (
                <Card title="Three-way match" subtitle="ordered · received · invoiced">
                  <Table head={['Item', 'Ordered', 'Received', 'Invoiced', 'Agreed', 'Invoiced price', 'Matched by']}>
                    {inv.lines.map((l: any) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">{l.poLine?.ingredient ?? <span className="text-red-700">{l.description} (not ordered)</span>}</td>
                        <td className="px-3 py-2 font-mono">{num(l.poLine?.ordered)}</td>
                        <td className="px-3 py-2 font-mono">{num(l.poLine?.received)}</td>
                        <td className={cx('px-3 py-2 font-mono', l.poLine && l.qty > l.poLine.received && 'text-red-700')}>{num(l.qty)}</td>
                        <td className="px-3 py-2 font-mono">{usd(l.poLine?.agreedPrice)}</td>
                        <td className={cx('px-3 py-2 font-mono', l.poLine && l.unit_price > l.poLine.agreedPrice + 0.02 && 'text-red-700')}>{usd(l.unit_price)}</td>
                        <td className="px-3 py-2 text-xs">{l.match_method}</td>
                      </tr>
                    ))}
                  </Table>
                  <div className="mt-3">
                    {inv.variances.length ? (
                      <ul className="space-y-1 text-sm">
                        {inv.variances.map((v: any) => (
                          <li key={v.id} className="flex items-center gap-2">
                            <Badge tone="red">{v.type.replace('_', ' ')}</Badge> {v.description} <span className="ml-auto font-mono">{usd(v.amount)}</span>
                          </li>
                        ))}
                        <li className="flex border-t border-line pt-1 font-semibold">
                          Total variances <span className="ml-auto font-mono">{usd(inv.varianceTotal)}</span>
                        </li>
                      </ul>
                    ) : (
                      <p className="text-sm text-emerald-700">No variances — the invoice matches the order and the delivery.</p>
                    )}
                  </div>
                  {inv.priceCreep.length > 0 && (
                    <div className="mt-3 rounded-lg bg-amber-50 p-2 text-sm">
                      <div className="font-medium text-amber-900">Price creep (&gt; 5% over the 8-week median)</div>
                      {inv.priceCreep.map((c: any) => (
                        <div key={c.lineId} className="flex flex-wrap items-center gap-2 text-xs">
                          {c.description}: {usd(c.invoiced)} vs median {usd(c.median)} (+{num(c.pct)}%)
                          {me.user.role !== 'staff' && (
                            <Button variant="ghost" onClick={() => accept.mutate(c.lineId)}>
                              Accept as new price
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </div>
          </div>
        );
      }}
    </Q>
  );
}
