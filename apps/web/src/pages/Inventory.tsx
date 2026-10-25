import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { CsvImportModal } from '../components/CsvImport';
import { Badge, Button, Card, cx, ErrorCard, Field, inputCls, Modal, num, PageHeader, Q, Status, Table, Tabs, usd } from '../components/ui';

// Inventory, sales, suppliers & offers, menu (FR-003 – FR-008, FR-030 – FR-036). Every need has a one-click "Why?".
// Everything entered here is used live by the forecast, reorder, optimiser, purchase orders and reconciliation.
const TABS = ['ingredients', 'sales', 'suppliers', 'offers', 'menu'] as const;

export function InventoryPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'ingredients') as (typeof TABS)[number];
  return (
    <div className="space-y-4">
      <PageHeader title="Inventory" description="Ingredients and stock, daily sales, suppliers and their offers, and the menu — everything the forecast and the Buyer use." actions={<Tabs label="Inventory section" value={tab} onChange={(t) => setParams({ tab: t })} options={TABS} />} />
      {tab === 'ingredients' && <Ingredients me={me} />}
      {tab === 'sales' && <Sales me={me} />}
      {tab === 'suppliers' && <Suppliers me={me} />}
      {tab === 'offers' && <Offers me={me} />}
      {tab === 'menu' && <Menu me={me} />}
    </div>
  );
}

function Ingredients({ me }: { me: Me }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['ingredients'], queryFn: () => api<any[]>('/ingredients') });
  const [why, setWhy] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  return (
    <Card
      pad={false}
      title="Ingredients"
      actions={
        <>
          <input aria-label="Search" className={cx(inputCls.replace('w-full ', ''), 'w-44')} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Status filter" className={cx(inputCls.replace('w-full ', ''), 'w-28')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="low">Low</option>
            <option value="ok">OK</option>
          </select>
          <a className="inline-flex items-center rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium transition hover:bg-raised" href="/api/inventory/export.csv">
            Export CSV
          </a>
          {me.user.role !== 'staff' && <Button onClick={() => setImporting(true)}>Import CSV</Button>}
          {me.user.role !== 'staff' && <Button onClick={() => setEdit({})}>New</Button>}
          {importing && <CsvImportModal kind="inventory" onClose={() => setImporting(false)} />}
        </>
      }
    >
      <Q q={q}>
        {(rows) => (
          <Table head={['Ingredient', 'Category', 'On hand', 'Usable', 'Cover', 'Need', 'At risk', 'Status', '']}>
            {rows
              .filter((r) => (!search || r.name.toLowerCase().includes(search.toLowerCase())) && (!status || r.status === status))
              .map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted">
                      {r.perishable ? `${r.shelfLifeDays}-day shelf life` : 'non-perishable'} · service level {Math.round(r.serviceLevel * 100)}%{r.reorderLevel ? ` · reorder level ${num(r.reorderLevel)} ${r.unit}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.category}</td>
                  <td className="px-3 py-2 font-mono">
                    {num(r.onHand)} {r.unit}
                  </td>
                  <td className="px-3 py-2 font-mono">{num(r.usable)}</td>
                  <td className="px-3 py-2 font-mono">{r.daysOfCover === null ? '—' : `${num(r.daysOfCover)} d`}</td>
                  <td className="px-3 py-2 font-mono">
                    {r.need > 0 ? num(r.need) : '—'} {r.trace?.flags.includes('capped_by_shelf_life') && <Badge tone="violet">shelf cap</Badge>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.valueAtRisk > 0 ? usd(r.valueAtRisk) : r.expiredQty > 0 ? <Badge tone="red">expired {num(r.expiredQty)}</Badge> : '—'}</td>
                  <td className="px-3 py-2">
                    <Status s={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button variant="ghost" onClick={() => setWhy(r)}>
                      Why?
                    </Button>
                    <Button variant="ghost" onClick={() => setMove(r)}>
                      Stock
                    </Button>
                    {me.user.role !== 'staff' && (
                      <Button variant="ghost" onClick={() => setEdit(r)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
          </Table>
        )}
      </Q>
      {why && <WhyModal r={why} onClose={() => setWhy(null)} />}
      {move && <MoveModal r={move} onClose={() => setMove(null)} />}
      {edit && <EditIngredient r={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function WhyModal({ r, onClose }: { r: any; onClose: () => void }) {
  const t = r.trace;
  const rows: [string, string][] = t
    ? [
        ['Coverage horizon H', `${t.H} days (lead time + order cycle)`],
        ['Forecast demand over H', `${r.demandByDay.map((d: number) => num(d)).join(' + ')} = ${num(t.demandH)}`],
        ['Average daily', num(t.avgDaily)],
        ['Safety stock', `max(${num(t.safetyDaysTerm)} safety-days, z ${t.z} × σ_H ${num(t.sigmaH)} = ${num(t.safetyStatTerm)}${t.reorderLevel ? `, reorder level ${num(t.reorderLevel)}` : ''}) = ${num(t.safety)}`],
        ['Usable stock', `${num(t.usable)} (batches expiring after tomorrow)`],
        ['On order', num(t.onOrder)],
        ['Need', `max(0, ${num(t.demandH)} + ${num(t.safety)} − ${num(t.usable)} − ${num(t.onOrder)}) = ${num(t.net > 0 ? t.net : 0)}`],
        ...(t.shelfCap !== null ? ([['Shelf-life cap', `${num(t.shelfCap)}${t.flags.includes('capped_by_shelf_life') ? ' — applied' : ''}`]] as [string, string][]) : []),
        ['Result', `${num(t.need)} ${r.unit} · ${t.status} · forecast model ${t.model}`],
      ]
    : [];
  return (
    <Modal open onClose={onClose} title={`Why ${num(r.need)} ${r.unit} of ${r.name}?`}>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1.5 pr-3 text-muted">{k}</td>
              <td className="py-1.5 font-mono text-xs">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.expiry?.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-medium">Expiry risk (FIFO simulation)</div>
          {r.expiry.map((e: any) => (
            <div key={e.batchId} className="font-mono text-xs">
              batch {num(e.qty)} expires {e.expiresAt}: uses {num(e.projectedUse)}, at risk {num(e.atRisk)} ({usd(e.valueAtRisk)})
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Pack rounding happens in the optimiser, which knows each supplier's pack size.</p>
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 text-sm font-medium">Thread</div>
        <Thread type="ingredient" id={r.id} placeholder="@Buyer find a cheaper supplier for this" />
      </div>
    </Modal>
  );
}

function MoveModal({ r, onClose }: { r: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'receive' | 'waste' | 'count_adjust' | 'write_off'>('count_adjust');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const exp = expiresAt || undefined;
  const m = useMutation({
    mutationFn: () =>
      post(
        `/ingredients/${r.id}/movements`,
        type === 'count_adjust' ? { type, countedQty: Number(qty), expiresAt: exp, reason: reason || undefined } : type === 'write_off' ? { type, reason: reason || undefined } : type === 'receive' ? { type, qty: Number(qty), expiresAt: exp, reason: reason || undefined } : { type, qty: Number(qty), reason: reason || 'waste' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open onClose={onClose} title={`Stock: ${r.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          On hand <b className="font-mono">{num(r.onHand)} {r.unit}</b>
        </p>
        <Field label="Movement">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="count_adjust">Count (set on-hand)</option>
            <option value="waste">Waste</option>
            <option value="receive">Receive (no PO)</option>
            <option value="write_off">Write off expired</option>
          </select>
        </Field>
        {type !== 'write_off' && (
          <Field label={type === 'count_adjust' ? `Counted (${r.unit})` : `Quantity (${r.unit})`}>
            <input className={inputCls} type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
        )}
        {(type === 'receive' || type === 'count_adjust') && (
          <Field label="Expiry date" hint={`Applies to stock added. Default: today + ${r.shelfLifeDays}-day shelf life`}>
            <input className={inputCls} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        )}
        <Field label="Reason">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required={type === 'waste'} />
        </Field>
        {m.error && <ErrorCard error={m.error} />}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={m.isPending}>
            Record
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditIngredient({ r, onClose }: { r: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !r.id;
  const [f, setF] = useState({ name: r.name ?? '', category: r.category ?? 'produce', unit: r.unit ?? 'lb', perishable: r.perishable ?? true, shelfLifeDays: r.shelfLifeDays ?? 7, safetyDays: r.safetyDays ?? 1, serviceLevel: r.serviceLevel ?? 0.95, maxOverbuyDays: r.maxOverbuyDays ?? 3, reorderLevel: (r.reorderLevel ?? '') as number | '' });
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, reorderLevel: f.reorderLevel === '' ? null : Number(f.reorderLevel) };
      return isNew ? post('/ingredients', body) : patch(`/ingredients/${r.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      onClose();
    },
  });
  const deact = useMutation({
    mutationFn: () => patch(`/ingredients/${r.id}`, { active: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={isNew ? 'New ingredient' : `Edit ${r.name}`} footer={<>{!isNew && <Button variant="danger" onClick={() => deact.mutate()}>Deactivate</Button>}<Button variant="primary" busy={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Category">
          <input className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <Field label="Unit">
          <select className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {['lb', 'oz', 'gal', 'qt', 'each'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="Shelf life (days)">
          <input className={inputCls} type="number" min={1} max={365} value={f.shelfLifeDays} onChange={(e) => setF({ ...f, shelfLifeDays: Number(e.target.value) })} />
        </Field>
        <Field label="Safety days">
          <input className={inputCls} type="number" min={0} max={7} step="0.5" value={f.safetyDays} onChange={(e) => setF({ ...f, safetyDays: Number(e.target.value) })} />
        </Field>
        <Field label="Service level">
          <select className={inputCls} value={f.serviceLevel} onChange={(e) => setF({ ...f, serviceLevel: Number(e.target.value) })}>
            {[0.9, 0.95, 0.98].map((s) => (
              <option key={s} value={s}>
                {s * 100}%
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Reorder level (${f.unit})`} hint="Minimum stock to keep; raises safety stock if higher. Leave empty to use safety days only">
          <input className={inputCls} type="number" min={0} step="any" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value === '' ? '' : Number(e.target.value) })} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.perishable} onChange={(e) => setF({ ...f, perishable: e.target.checked })} /> Perishable
        </label>
      </div>
      {(m.error || deact.error) && <div className="mt-2"><ErrorCard error={m.error ?? deact.error} /></div>}
    </Modal>
  );
}


const useInvalidate = () => {
  const qc = useQueryClient();
  return () => ['suppliers', 'offers', 'menu', 'ingredients', 'forecast', 'dashboard', 'sales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
};

function Suppliers({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const [edit, setEdit] = useState<any>(null);
  const can = me.user.role !== 'staff';
  return (
    <Card pad={false} title="Suppliers" subtitle="Minimum order value, small-order fee, delivery fee, order cycle and cut-off feed the optimiser" actions={can && <Button onClick={() => setEdit({})}>New supplier</Button>}>
      <Q q={q}>
        {(rows) => (
          <Table head={['Supplier', 'Email', 'Minimum order', 'Delivery fee', 'Order cycle', 'Cut-off', 'Offers', 'Trusted', '']}>
            {rows.map((s) => (
              <tr key={s.id} className={cx(!s.active && 'opacity-50')}>
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2 text-xs">{s.email}</td>
                <td className="px-3 py-2 text-xs">
                  {usd(s.min_order_value)} {s.min_order_type}
                  {s.min_order_type === 'soft' && ` (+${usd(s.below_min_fee)} below)`}
                </td>
                <td className="px-3 py-2 font-mono">{usd(s.delivery_fee)}</td>
                <td className="px-3 py-2">{s.order_cycle_days} d</td>
                <td className="px-3 py-2">{s.cutoff_time}</td>
                <td className="px-3 py-2 font-mono">{s.offers}</td>
                <td className="px-3 py-2">{s.trusted ? <Badge tone="green">trusted</Badge> : '—'}</td>
                <td className="px-3 py-2 text-right">{can && <Button variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function SupplierModal({ s, onClose }: { s: any; onClose: () => void }) {
  const done = useInvalidate();
  const isNew = !s.id;
  const [f, setF] = useState({
    name: s.name ?? '',
    email: s.email ?? '',
    minOrderValue: s.min_order_value ?? 0,
    minOrderType: (s.min_order_type ?? 'hard') as 'hard' | 'soft',
    belowMinFee: s.below_min_fee ?? 0,
    deliveryFee: s.delivery_fee ?? 0,
    orderCycleDays: s.order_cycle_days ?? 2,
    deliveryWeekdays: s.delivery_weekdays ?? '1,2,3,4,5,6',
    cutoffTime: s.cutoff_time ?? '14:00',
    trusted: Boolean(s.trusted),
    active: s.active === undefined ? true : Boolean(s.active),
  });
  const m = useMutation({
    mutationFn: () => (isNew ? post('/suppliers', f) : patch(`/suppliers/${s.id}`, f)),
    onSuccess: () => {
      done();
      onClose();
    },
  });
  const n = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <Modal open onClose={onClose} title={isNew ? 'New supplier' : `Edit ${s.name}`} footer={<Button variant="primary" busy={m.isPending} onClick={() => m.mutate()}>Save</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Order email" hint="Use a .example or your own test inbox">
          <input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Minimum order value (USD)">
          <input className={inputCls} type="number" min={0} step="0.01" value={f.minOrderValue} onChange={n('minOrderValue')} />
        </Field>
        <Field label="Minimum type" hint="Hard: must be met · Soft: small-order fee below it">
          <select className={inputCls} value={f.minOrderType} onChange={(e) => setF({ ...f, minOrderType: e.target.value as 'hard' | 'soft' })}>
            <option value="hard">Hard</option>
            <option value="soft">Soft (fee below minimum)</option>
          </select>
        </Field>
        <Field label="Small-order fee (USD)">
          <input className={inputCls} type="number" min={0} step="0.01" value={f.belowMinFee} disabled={f.minOrderType === 'hard'} onChange={n('belowMinFee')} />
        </Field>
        <Field label="Delivery fee (USD)">
          <input className={inputCls} type="number" min={0} step="0.01" value={f.deliveryFee} onChange={n('deliveryFee')} />
        </Field>
        <Field label="Order cycle (days)" hint="Days until the next order; sets the coverage horizon">
          <input className={inputCls} type="number" min={1} max={14} value={f.orderCycleDays} onChange={n('orderCycleDays')} />
        </Field>
        <Field label="Order cut-off">
          <input className={inputCls} type="time" value={f.cutoffTime} onChange={(e) => setF({ ...f, cutoffTime: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.trusted} onChange={(e) => setF({ ...f, trusted: e.target.checked })} /> Trusted (eligible for bounded auto-send)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
      {m.error && <div className="mt-2"><ErrorCard error={m.error} /></div>}
    </Modal>
  );
}

function Offers({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['offers'], queryFn: () => api<any[]>('/offers') });
  const done = useInvalidate();
  const prefer = useMutation({ mutationFn: (id: string) => patch(`/offers/${id}`, { preferred: true }), onSuccess: done });
  const [edit, setEdit] = useState<any>(null);
  const can = me.user.role !== 'staff';
  return (
    <Card pad={false} title="Supplier offers" subtitle="Pack size = minimum order quantity per line · one preferred offer per ingredient is the savings baseline" actions={can && <Button onClick={() => setEdit({})}>Add offer</Button>}>
      <Q q={q}>
        {(rows) => (
          <Table head={['Ingredient', 'Supplier', 'SKU', 'Pack (min qty)', 'Unit price', 'Lead time', 'Preferred', '']}>
            {rows.map((o) => (
              <tr key={o.id} className={cx(!o.active && 'opacity-50')}>
                <td className="px-3 py-2">{o.ingredient}</td>
                <td className="px-3 py-2 text-xs">{o.supplier}</td>
                <td className="px-3 py-2 font-mono text-xs">{o.sku}</td>
                <td className="px-3 py-2 font-mono">
                  {o.pack_size} {o.unit}
                </td>
                <td className="px-3 py-2 font-mono">{usd(o.unit_price)}</td>
                <td className="px-3 py-2">{o.lead_time_days} d</td>
                <td className="px-3 py-2">
                  {o.preferred ? (
                    <Badge tone="green">preferred</Badge>
                  ) : can ? (
                    <Button variant="ghost" onClick={() => prefer.mutate(o.id)}>
                      make preferred
                    </Button>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">{can && <Button variant="ghost" onClick={() => setEdit(o)}>Edit</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
      {edit && <OfferModal o={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function OfferModal({ o, onClose }: { o: any; onClose: () => void }) {
  const done = useInvalidate();
  const isNew = !o.id;
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers'), enabled: isNew });
  const ingredients = useQuery({ queryKey: ['ingredients'], queryFn: () => api<any[]>('/ingredients'), enabled: isNew });
  const [f, setF] = useState({ supplierId: o.supplier_id ?? '', ingredientId: o.ingredient_id ?? '', sku: o.sku ?? '', packSize: o.pack_size ?? 1, unitPrice: o.unit_price ?? 0, leadTimeDays: o.lead_time_days ?? 1, preferred: Boolean(o.preferred), active: o.active === undefined ? true : Boolean(o.active) });
  const m = useMutation({
    mutationFn: () => (isNew ? post('/offers', f) : patch(`/offers/${o.id}`, { sku: f.sku, packSize: f.packSize, unitPrice: f.unitPrice, leadTimeDays: f.leadTimeDays, preferred: f.preferred, active: f.active })),
    onSuccess: () => {
      done();
      onClose();
    },
  });
  const unit = ingredients.data?.find((i) => i.id === f.ingredientId)?.unit ?? o.unit ?? '';
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add supplier offer' : `Edit ${o.sku}`} footer={<Button variant="primary" busy={m.isPending} disabled={!f.supplierId || !f.ingredientId || !f.sku} onClick={() => m.mutate()}>Save</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {isNew ? (
          <>
            <Field label="Supplier">
              <select className={inputCls} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                <option value="">Choose…</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ingredient">
              <select className={inputCls} value={f.ingredientId} onChange={(e) => setF({ ...f, ingredientId: e.target.value })}>
                <option value="">Choose…</option>
                {(ingredients.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <p className="col-span-2 text-sm">
            {o.ingredient} from <b>{o.supplier}</b>
          </p>
        )}
        <Field label="Supplier SKU">
          <input className={cx(inputCls, 'font-mono')} value={f.sku} maxLength={40} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        </Field>
        <Field label={`Pack size / minimum order quantity (${unit})`}>
          <input className={inputCls} type="number" min={0.01} step="any" value={f.packSize} onChange={(e) => setF({ ...f, packSize: Number(e.target.value) })} />
        </Field>
        <Field label={`Unit price (USD per ${unit || 'unit'})`}>
          <input className={inputCls} type="number" min={0} step="0.01" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: Number(e.target.value) })} />
        </Field>
        <Field label="Lead time (days)">
          <input className={inputCls} type="number" min={0} max={14} value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: Number(e.target.value) })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.checked })} /> Preferred (savings baseline)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
      {m.error && <div className="mt-2"><ErrorCard error={m.error} /></div>}
    </Modal>
  );
}

function Menu({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['menu'], queryFn: () => api<any[]>('/menu-items') });
  const [edit, setEdit] = useState<any>(null);
  const can = me.user.role !== 'staff';
  return (
    <Card title="Menu and recipes" subtitle="Plate cost from preferred offer prices · recipes turn dish forecasts into ingredient demand" actions={can && <Button onClick={() => setEdit({})}>New dish</Button>}>
      <Q q={q}>
        {(rows) => (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((m) => (
              <div key={m.id} className={cx('rounded-lg border border-line p-3', !m.active && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {!m.active && <Badge>inactive</Badge>}
                  <span className="ml-auto font-mono text-sm">{usd(m.price)}</span>
                  {can && (
                    <Button variant="ghost" onClick={() => setEdit(m)}>
                      Edit
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted">
                  Plate cost {usd(m.plateCost)} · food cost {num(m.foodCostPct)}% (target {Math.round(m.target_food_cost_pct * 100)}%)
                </div>
                <ul className="mt-1 text-xs">
                  {m.recipe.map((l: any) => (
                    <li key={l.id}>
                      {l.name}: <span className="font-mono">{l.qty}</span> {l.unit}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Q>
      {edit && <DishModal d={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function DishModal({ d, onClose }: { d: any; onClose: () => void }) {
  const done = useInvalidate();
  const isNew = !d.id;
  const ingredients = useQuery({ queryKey: ['ingredients'], queryFn: () => api<any[]>('/ingredients') });
  const [name, setName] = useState<string>(d.name ?? '');
  const [price, setPrice] = useState<number>(d.price ?? 0);
  const [active, setActive] = useState<boolean>(d.active === undefined ? true : Boolean(d.active));
  const [lines, setLines] = useState<{ ingredientId: string; qty: number }[]>(d.recipe?.map((l: any) => ({ ingredientId: l.id, qty: l.qty })) ?? [{ ingredientId: '', qty: 0 }]);
  const m = useMutation({
    mutationFn: () => {
      const body = { name, price, active, recipe: lines.filter((l) => l.ingredientId && l.qty > 0) };
      return isNew ? post('/menu-items', body) : patch(`/menu-items/${d.id}`, body);
    },
    onSuccess: () => {
      done();
      onClose();
    },
  });
  const unitOf = (id: string) => ingredients.data?.find((i) => i.id === id)?.unit ?? '';
  return (
    <Modal open onClose={onClose} title={isNew ? 'New dish' : `Edit ${d.name}`} footer={<Button variant="primary" busy={m.isPending} disabled={!name || !lines.some((l) => l.ingredientId && l.qty > 0)} onClick={() => m.mutate()}>Save</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dish name">
            <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Menu price (USD)">
            <input className={inputCls} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </Field>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Recipe — quantity per serving</div>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select aria-label="Ingredient" className={inputCls} value={l.ingredientId} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, ingredientId: e.target.value } : x)))}>
                <option value="">Ingredient…</option>
                {(ingredients.data ?? []).map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name}
                  </option>
                ))}
              </select>
              <input aria-label="Quantity per serving" className={cx(inputCls.replace('w-full ', ''), 'w-24 shrink-0 font-mono')} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              <span className="w-10 text-xs text-muted">{unitOf(l.ingredientId)}</span>
              <button aria-label="Remove line" className="text-xs text-red-700" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                ✕
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setLines([...lines, { ingredientId: '', qty: 0 }])}>
            + Add ingredient
          </Button>
        </div>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (inactive dishes are not forecast)
          </label>
        )}
        <p className="text-xs text-muted">Enter daily sales for a new dish in the Sales tab so the forecast can learn it.</p>
        {m.error && <ErrorCard error={m.error} />}
      </div>
    </Modal>
  );
}

function Sales({ me }: { me: Me }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ localDate: string }>('/health') });
  const [importing, setImporting] = useState(false);
  if (!health.data) return <Q q={health}>{() => null}</Q>;
  return (
    <div className="space-y-4">
      {me.user.role !== 'staff' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm shadow-card">
          <span className="text-muted">Have a POS export? Import many days at once with a preview first.</span>
          <Button className="ml-auto" onClick={() => setImporting(true)}>
            Import sales CSV
          </Button>
        </div>
      )}
      {importing && <CsvImportModal kind="sales" onClose={() => setImporting(false)} />}
      <SalesSheet me={me} today={health.data.localDate} />
    </div>
  );
}

/** `today` is the restaurant's date from the server (timezone and simulated clock), not the browser's. */
function SalesSheet({ me, today }: { me: Me; today: string }) {
  const qc = useQueryClient();
  const shift = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const yesterday = shift(today, -1);
  const [date, setDate] = useState(yesterday);
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api<any[]>('/menu-items') });
  const from = shift(yesterday, -13);
  const recent = useQuery({ queryKey: ['sales', from, yesterday], queryFn: () => api<any[]>(`/sales?from=${from}&to=${yesterday}`) });
  const [qty, setQty] = useState<Record<string, string>>({});
  const existing = (mid: string) => recent.data?.find((r) => r.date === date && r.menu_item_id === mid)?.qty;
  const m = useMutation({
    mutationFn: () =>
      post('/sales', {
        date,
        lines: (menu.data ?? []).filter((d) => d.active && qty[d.id] !== undefined && qty[d.id] !== '').map((d) => ({ menuItemId: d.id, qty: Number(qty[d.id]) })),
      }),
    onSuccess: () => {
      setQty({});
      ['sales', 'forecast', 'ingredients', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  const dates = Array.from({ length: 14 }, (_, k) => shift(yesterday, -13 + k));
  const canEdit = me.user.role !== 'staff';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card title="Daily sales sheet" subtitle="Portions sold per dish on a completed day" className="lg:col-span-2">
        {canEdit ? (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Date" hint="Completed days only. Saving refits the forecast on your numbers">
              <input className={inputCls} type="date" max={yesterday} value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Q q={menu}>
              {(dishes) => (
                <div className="max-h-[28rem] space-y-1 overflow-auto pr-1">
                  {dishes
                    .filter((d) => d.active)
                    .map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{d.name}</span>
                        <input
                          aria-label={`Portions of ${d.name}`}
                          className={cx(inputCls.replace('w-full ', ''), 'w-24 shrink-0 font-mono')}
                          type="number"
                          min={0}
                          step={1}
                          placeholder={existing(d.id) !== undefined ? String(existing(d.id)) : '—'}
                          value={qty[d.id] ?? ''}
                          onChange={(e) => setQty({ ...qty, [d.id]: e.target.value })}
                        />
                      </label>
                    ))}
                </div>
              )}
            </Q>
            {m.error && <ErrorCard error={m.error} />}
            {m.isSuccess && <p className="text-xs text-emerald-700">Saved — the forecast and reorder plan now use these sales.</p>}
            <Button type="submit" variant="primary" busy={m.isPending} disabled={!Object.values(qty).some((v) => v !== '')}>
              Save sales
            </Button>
            <p className="text-[11px] text-muted">Grey numbers are what is already recorded for that day; only dishes you fill in are changed.</p>
          </form>
        ) : (
          <p className="text-sm text-muted">Only the Owner or Chef can record sales.</p>
        )}
      </Card>
      <Card title="Last 14 days" subtitle="Portions per dish (seeded or entered)" className="lg:col-span-3" pad={false}>
        <Q q={recent}>
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-2 py-1.5">Dish</th>
                    {dates.map((d) => (
                      <th key={d} className={cx('px-1 py-1.5 text-right font-mono', d === date && 'text-accent')}>
                        {d.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(menu.data ?? [])
                    .filter((d) => d.active)
                    .map((d) => (
                      <tr key={d.id}>
                        <td className="whitespace-nowrap px-2 py-1">{d.name}</td>
                        {dates.map((dt) => (
                          <td key={dt} className="px-1 py-1 text-right font-mono">
                            {rows.find((r) => r.date === dt && r.menu_item_id === d.id)?.qty ?? '·'}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Q>
      </Card>
    </div>
  );
}
