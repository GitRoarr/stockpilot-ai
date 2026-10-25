import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileImage, FileText, Loader2, PackageCheck, Plus, ScanLine, Trash2, Truck, Upload, X } from 'lucide-react';
import { api, post, put, upload } from '../api/client';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { Badge, Button, Card, cx, dt, Empty, ErrorCard, Field, inputCls, num, PageHeader, Q, RoleLink, Status, Table, usd } from '../components/ui';

const RECEIVABLE = new Set(['sent', 'confirmed', 'partially_confirmed', 'partially_received']);
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX = 10 * 1024 * 1024;

export function ReceivingPage() {
  const nav = useNavigate();
  const pos = useQuery({ queryKey: ['orders'], queryFn: () => api<any[]>('/purchase-orders') });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<any[]>('/invoices') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const pick = (f: File | null | undefined) => {
    setFileError(null);
    if (!f) return setFile(null);
    if (!TYPES.includes(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) return setFileError(`${f.name} is not a supported image (JPEG, PNG, WEBP or HEIC).`);
    if (f.size > MAX) return setFileError(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB.`);
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files?.[0]);
  };
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
    <div className="space-y-4">
      <PageHeader title="Receiving & invoices" description="Check deliveries against the order, then match the supplier's invoice to what was ordered and received." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Deliveries to receive" icon={Truck} pad={false}>
          <Q q={pos}>
            {(rows) => {
              const list = rows.filter((p) => RECEIVABLE.has(p.status));
              if (!list.length)
                return (
                  <div className="p-4">
                    <Empty icon={Truck}>No deliveries expected. Sent and confirmed orders appear here.</Empty>
                  </div>
                );
              return (
                <ul className="divide-y divide-line">
                  {list.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-mono font-medium">{p.number}</span> {p.supplier}
                        <span className="block text-xs text-muted">
                          Due {p.delivery_date ?? '—'} · {p.lineCount} items · {usd(p.total)}
                        </span>
                      </span>
                      <Status s={p.status} />
                      <Link className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-on-accent hover:bg-accent-strong" to={`/receiving/po/${p.id}`}>
                        <PackageCheck aria-hidden className="h-3.5 w-3.5" />
                        Receive
                      </Link>
                    </li>
                  ))}
                </ul>
              );
            }}
          </Q>
        </Card>
        <Card title="Capture an invoice" icon={ScanLine} subtitle="Photo or manual entry">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
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
                <select className={inputCls} value={poId} onChange={(e) => setPoId(e.target.value)} disabled={!supplierId}>
                  <option value="">Unknown</option>
                  {supplierPos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} · {usd(p.total)} · {p.status.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {file ? (
              <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-2.5">
                {preview ? <img src={preview} alt="" className="h-14 w-14 rounded border border-line object-cover" /> : <FileImage aria-hidden className="h-8 w-8 text-muted" />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{file.name}</div>
                  <div className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · ready to extract</div>
                </div>
                <button type="button" aria-label="Remove file" className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-card hover:text-ink" onClick={() => (pick(null), input.current && (input.current.value = ''))}>
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                onDragOver={(e) => (e.preventDefault(), setDrag(true))}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                className={cx('flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center text-sm transition-colors', drag ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent/60 hover:bg-raised')}
              >
                <Upload aria-hidden className="h-5 w-5 text-muted" />
                <span className="font-medium">Drop the invoice photo here, or click to choose</span>
                <span className="text-xs text-muted">JPEG, PNG, WEBP or HEIC · up to 10 MB</span>
                <input ref={input} aria-label="Invoice photo" type="file" accept={TYPES.join(',')} capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
            )}
            {fileError && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-red-700">
                <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> {fileError}
              </p>
            )}
            {up.error && <ErrorCard error={up.error} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" icon={file ? ScanLine : FileText} busy={up.isPending} disabled={!supplierId}>
                {file ? 'Upload & extract' : 'Enter manually'}
              </Button>
              {up.isPending && file && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Uploading and reading the invoice…
                </span>
              )}
              {!supplierId && <span className="text-xs text-muted">Choose the supplier first.</span>}
            </div>
          </form>
        </Card>
      </div>
      <Card title="Invoices" icon={FileText} pad={false}>
        <Q q={invoices}>
          {(rows) =>
            rows.length ? (
              <Table head={['Invoice', 'Supplier', 'Order', 'Total', 'Status', 'Captured']} align={['left', 'left', 'left', 'right', 'left', 'left']}>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono">
                      <Link className="font-medium text-accent hover:underline" to={`/receiving/invoices/${r.id}`}>
                        {r.number ?? 'draft'}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.supplier}</td>
                    <td className="px-3 py-2 font-mono">{r.po_number ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{usd(r.total)}</td>
                    <td className="px-3 py-2">
                      <Status s={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{dt(r.created_at)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-4">
                <Empty icon={FileText}>No invoices yet. Capture one after a delivery.</Empty>
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
  const toast = useToast();
  const q = useQuery({ queryKey: ['receiving', id], queryFn: () => api<any>(`/receipts/form/${id}`) });
  const [lines, setLines] = useState<Record<string, { qty: number; condition: 'ok' | 'damaged' | 'rejected'; expiresAt: string }>>({});
  useEffect(() => {
    if (q.data) setLines(Object.fromEntries(q.data.lines.map((l: any) => [l.poLineId, { qty: l.prefill, condition: 'ok', expiresAt: '' }])));
  }, [q.data]);
  const m = useMutation({
    mutationFn: () => post('/receipts', { purchaseOrderId: id, lines: Object.entries(lines).map(([poLineId, v]) => ({ poLineId, qtyReceived: v.qty, condition: v.condition, expiresAt: v.expiresAt || undefined })) }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast('success', 'Delivery received', 'Stock is updated; the AP Clerk checks for an invoice to reconcile.');
      nav('/receiving');
    },
  });
  return (
    <Q q={q}>
      {(d) => {
        const expected = (l: any) => (l.confirmed ?? l.ordered) - (l.alreadyReceived ?? 0);
        const issues = d.lines.filter((l: any) => {
          const v = lines[l.poLineId];
          return v && (Math.abs(v.qty - expected(l)) > 1e-9 || v.condition !== 'ok');
        }).length;
        return (
          <div className="space-y-4">
            <PageHeader crumbs={[{ label: 'Receiving', to: '/receiving' }, { label: d.po.number }]} title={`Receive ${d.po.number}`} description={`Quantities are pre-filled from the supplier's confirmation${d.po.eta ? ` · ETA ${d.po.eta}` : ''}. Record what actually arrived.`} actions={<Status s={d.po.status} />} />
            <Card pad={false}>
              <ul className="divide-y divide-line">
                {d.lines.map((l: any) => {
                  const v = lines[l.poLineId];
                  if (!v) return null;
                  const diff = Math.round((v.qty - expected(l)) * 1000) / 1000;
                  return (
                    <li key={l.poLineId} className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.ingredient}</span>
                        {l.unavailable && <Badge tone="red">unavailable</Badge>}
                        {diff < 0 && <Badge tone="amber">short by {num(-diff)} {l.unit}</Badge>}
                        {diff > 0 && <Badge tone="amber">over by {num(diff)} {l.unit}</Badge>}
                        {v.condition !== 'ok' && <Badge tone="red">{v.condition}</Badge>}
                        {diff === 0 && v.condition === 'ok' && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> as expected
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted">
                        ordered {num(l.ordered)} {l.unit}
                        {l.confirmed !== null && ` · confirmed ${num(l.confirmed)}`}
                        {l.alreadyReceived > 0 && ` · already received ${num(l.alreadyReceived)}`} · expected now {num(expected(l))}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Field label={`Received (${l.unit})`}>
                          <input className={cx(inputCls, 'font-mono', diff !== 0 && 'border-amber-300')} type="number" min={0} step="any" inputMode="decimal" value={v.qty} onChange={(e) => setLines({ ...lines, [l.poLineId]: { ...v, qty: Math.max(0, Number(e.target.value)) } })} />
                        </Field>
                        <Field label="Condition">
                          <select className={inputCls} value={v.condition} onChange={(e) => setLines({ ...lines, [l.poLineId]: { ...v, condition: e.target.value as 'ok' } })}>
                            <option value="ok">OK</option>
                            <option value="damaged">Damaged (kept)</option>
                            <option value="rejected">Rejected (returned)</option>
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
              <div className="flex flex-wrap items-center gap-3 border-t border-line bg-raised/50 px-4 py-3">
                <span className={cx('text-sm', issues ? 'text-amber-800' : 'text-muted')}>{issues ? `${issues} line(s) differ from the confirmation — they will be flagged when the invoice is matched.` : 'Everything matches the confirmation.'}</span>
                <Button variant="primary" icon={PackageCheck} className="ml-auto" busy={m.isPending} onClick={() => m.mutate()}>
                  Confirm receipt
                </Button>
              </div>
              {m.error && (
                <div className="px-4 pb-3">
                  <ErrorCard error={m.error} />
                </div>
              )}
            </Card>
          </div>
        );
      }}
    </Q>
  );
}

/** Readable extraction mode: "gemini:<model>" → "AI · <model>", "recorded_sample (reason)" → "Stored extraction (reason)". */
const extractionLabel = (mode: string | null | undefined) =>
  !mode ? '—' : mode.startsWith('gemini:') ? `AI · ${mode.slice(7)}` : mode.startsWith('recorded_') ? mode.replace(/^recorded_\w+/, 'Stored extraction') : mode;

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
          <div className="space-y-4">
          <PageHeader crumbs={[{ label: 'Receiving', to: '/receiving' }, { label: inv.number ?? 'Invoice' }]} title={`Invoice ${inv.number ?? '(draft)'}`} description={`${inv.supplier} · ${inv.poNumber ?? 'no purchase order'}`} actions={<Status s={inv.status} />} />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <Card title="Source document" icon={FileImage}>
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  Extraction <Badge tone={inv.extractionMode?.startsWith('gemini') ? 'green' : 'amber'} title={inv.extractionMode?.startsWith('gemini') ? 'Read by Gemini' : 'No model available: a stored or manual extraction is used'}>{extractionLabel(inv.extractionMode)}</Badge>
                </div>
                {inv.imageUrl ? <img src={inv.imageUrl} alt="Invoice photo" className="w-full rounded-md border border-line bg-white" /> : <Empty icon={FileText}>No photo — manual entry.</Empty>}
              </Card>
              {inv.dispute && (
                <Card title="Dispute">
                  <RoleLink className="font-medium text-accent hover:underline" to={`/disputes/${inv.dispute.id}`}>
                    {inv.dispute.number}
                  </RoleLink>{' '}
                  <Status s={inv.dispute.status} /> {usd(inv.dispute.amount_claimed)}
                </Card>
              )}
            </div>
            <div className="min-w-0 space-y-4 lg:col-span-3">
              {editable && ext && (
                <Card title="Review extraction" subtitle="Low-confidence and failed checks are highlighted" actions={<Button busy={save.isPending} onClick={() => save.mutate()}>Save & re-check</Button>}>
                  {inv.issues.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {inv.issues.map((x: any, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
                        <div key={i} className={cx('grid grid-cols-6 gap-1.5 rounded-md border p-2', lineIssue(i) ? 'border-amber-300 bg-amber-50' : 'border-line')}>
                          <input aria-label="Description" className={cx(inputCls, 'col-span-6 sm:col-span-2')} value={l.description} onChange={(e) => set({ description: e.target.value })} />
                          <input aria-label="SKU" className={cx(inputCls, 'font-mono')} value={l.sku ?? ''} onChange={(e) => set({ sku: e.target.value })} placeholder="SKU" />
                          <input aria-label="Qty" className={cx(inputCls, 'font-mono')} type="number" step="any" value={l.qty} onChange={(e) => set({ qty: Number(e.target.value) })} />
                          <input aria-label="Unit price" className={cx(inputCls, 'font-mono')} type="number" step="0.01" value={l.unitPrice} onChange={(e) => set({ unitPrice: Number(e.target.value) })} />
                          <input aria-label="Amount" className={cx(inputCls, 'font-mono', bad && 'border-red-400')} type="number" step="0.01" value={l.extended} onChange={(e) => set({ extended: Number(e.target.value) })} />
                          <span className="col-span-6 flex items-center gap-2 text-[11px] text-muted">
                            {bad ? <Badge tone="red">math_error</Badge> : <Badge tone="green">arithmetic ok</Badge>} confidence {num(l.confidence, 2)}
                            <button type="button" className="ml-auto inline-flex items-center gap-1 text-red-700 hover:underline" onClick={() => setExt({ ...ext, lines: ext.lines.filter((_, k) => k !== i) })}>
                              <Trash2 aria-hidden className="h-3 w-3" /> Remove line
                            </button>
                          </span>
                        </div>
                      );
                    })}
                    <Button variant="ghost" icon={Plus} onClick={() => setExt({ ...ext, lines: [...ext.lines, { description: '', sku: '', qty: 0, unit: '', unitPrice: 0, extended: 0, confidence: 1 }] })}>
                      Add line
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
                            <select className={cx(inputCls.replace('w-full ', ''), 'w-full sm:w-56')} value={mapping[l.id] ?? s?.poLineId ?? ''} onChange={(e) => setMapping({ ...mapping, [l.id]: e.target.value })}>
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
                <Card title="Three-way match" subtitle="ordered · received · invoiced" pad={false}>
                  <Table head={['Item', 'Ordered', 'Received', 'Invoiced', 'Agreed', 'Invoiced price', 'Matched by']} align={['left', 'right', 'right', 'right', 'right', 'right', 'left']}>
                    {inv.lines.map((l: any) => {
                      const qtyBad = l.poLine && l.qty > l.poLine.received;
                      const priceBad = l.poLine && l.unit_price > l.poLine.agreedPrice + 0.02;
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-2">{l.poLine?.ingredient ?? <span className="text-red-700">{l.description} (not ordered)</span>}</td>
                          <td className="px-3 py-2 text-right font-mono">{num(l.poLine?.ordered)}</td>
                          <td className="px-3 py-2 text-right font-mono">{num(l.poLine?.received)}</td>
                          <td className={cx('px-3 py-2 text-right font-mono', qtyBad && 'bg-red-50 font-semibold text-red-700')} title={qtyBad ? 'Billed for more than was received' : undefined}>
                            {num(l.qty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{usd(l.poLine?.agreedPrice)}</td>
                          <td className={cx('px-3 py-2 text-right font-mono', priceBad && 'bg-red-50 font-semibold text-red-700')} title={priceBad ? 'Above the agreed price' : undefined}>
                            {usd(l.unit_price)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{l.match_method}</td>
                        </tr>
                      );
                    })}
                  </Table>
                  <div className="border-t border-line p-4">
                    {inv.variances.length ? (
                      <ul className="space-y-1 text-sm">
                        {inv.variances.map((v: any) => (
                          <li key={v.id} className="flex items-center gap-2">
                            <Badge tone="red">{v.type.replace('_', ' ')}</Badge> <span className="min-w-0 flex-1">{v.description}</span> <span className="font-mono">{usd(v.amount)}</span>
                          </li>
                        ))}
                        <li className="flex border-t border-line pt-1 font-semibold">
                          Total variances <span className="ml-auto font-mono">{usd(inv.varianceTotal)}</span>
                        </li>
                      </ul>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                        <CheckCircle2 aria-hidden className="h-4 w-4" /> No variances — the invoice matches the order and the delivery.
                      </p>
                    )}
                  </div>
                  {inv.priceCreep.length > 0 && (
                    <div className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
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
          </div>
        );
      }}
    </Q>
  );
}
