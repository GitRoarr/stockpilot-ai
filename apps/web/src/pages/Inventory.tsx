import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { Badge, Button, Card, cx, ErrorCard, Field, inputCls, Modal, num, Q, Status, Table, usd } from '../components/ui';

// Inventory, suppliers & offers, menu (FR-003 – FR-008, FR-030 – FR-036). Every need has a one-click "Why?".
const TABS = ['ingredients', 'suppliers', 'offers', 'menu'] as const;

export function InventoryPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'ingredients') as (typeof TABS)[number];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <div className="ml-auto flex gap-1 rounded-lg border border-line bg-card p-1 text-sm">
          {TABS.map((t) => (
            <button key={t} onClick={() => setParams({ tab: t })} className={cx('rounded-md px-3 py-1 capitalize', tab === t ? 'bg-blue-50 font-semibold text-accent' : 'text-slate-600')}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'ingredients' && <Ingredients me={me} />}
      {tab === 'suppliers' && <Suppliers me={me} />}
      {tab === 'offers' && <Offers me={me} />}
      {tab === 'menu' && <Menu />}
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
  return (
    <Card
      pad={false}
      title="Ingredients"
      actions={
        <>
          <input aria-label="Search" className={cx(inputCls, 'w-44')} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Status filter" className={cx(inputCls, 'w-28')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="low">Low</option>
            <option value="ok">OK</option>
          </select>
          {me.user.role !== 'staff' && <Button onClick={() => setEdit({})}>New</Button>}
        </>
      }
    >
      <Q q={q}>
        {(rows) => (
          <Table head={['Ingredient', 'Category', 'On hand', 'Usable', 'Cover', 'Need', 'At risk', 'Status', '']}>
            {rows
              .filter((r) => (!search || r.name.toLowerCase().includes(search.toLowerCase())) && (!status || r.status === status))
              .map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted">
                      {r.perishable ? `${r.shelfLifeDays}-day shelf life` : 'non-perishable'} · service level {Math.round(r.serviceLevel * 100)}%
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
        ['Safety stock', `max(${num(t.safetyDaysTerm)} safety-days, z ${t.z} × σ_H ${num(t.sigmaH)} = ${num(t.safetyStatTerm)}) = ${num(t.safety)}`],
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
      <p className="mt-3 text-[11px] text-muted">Pack rounding happens in the optimiser, which knows each supplier's pack size. [Illustrative demo data]</p>
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
  const m = useMutation({
    mutationFn: () => post(`/ingredients/${r.id}/movements`, type === 'count_adjust' ? { type, countedQty: Number(qty), reason: reason || undefined } : type === 'write_off' ? { type, reason: reason || undefined } : { type, qty: Number(qty), reason: reason || (type === 'waste' ? 'waste' : undefined) }),
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
  const [f, setF] = useState({ name: r.name ?? '', category: r.category ?? 'produce', unit: r.unit ?? 'lb', perishable: r.perishable ?? true, shelfLifeDays: r.shelfLifeDays ?? 7, safetyDays: r.safetyDays ?? 1, serviceLevel: r.serviceLevel ?? 0.95, maxOverbuyDays: r.maxOverbuyDays ?? 3 });
  const m = useMutation({
    mutationFn: () => (isNew ? post('/ingredients', f) : patch(`/ingredients/${r.id}`, f)),
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
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.perishable} onChange={(e) => setF({ ...f, perishable: e.target.checked })} /> Perishable
        </label>
      </div>
      {(m.error || deact.error) && <div className="mt-2"><ErrorCard error={m.error ?? deact.error} /></div>}
    </Modal>
  );
}

function Suppliers({ me }: { me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const toggle = useMutation({ mutationFn: (s: any) => patch(`/suppliers/${s.id}`, { trusted: !s.trusted }), onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }) });
  return (
    <Card pad={false} title="Suppliers" subtitle="Minimums, fees, cut-offs (illustrative)">
      <Q q={q}>
        {(rows) => (
          <Table head={['Supplier', 'Email', 'Minimum', 'Delivery fee', 'Order cycle', 'Cut-off', 'Offers', 'Trusted']}>
            {rows.map((s) => (
              <tr key={s.id}>
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
                <td className="px-3 py-2">
                  {me.user.role === 'staff' ? (
                    s.trusted ? 'yes' : 'no'
                  ) : (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={s.trusted} onChange={() => toggle.mutate(s)} /> trusted
                    </label>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </Card>
  );
}

function Offers({ me }: { me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['offers'], queryFn: () => api<any[]>('/offers') });
  const setPrice = useMutation({ mutationFn: ({ id, unitPrice }: { id: string; unitPrice: number }) => patch(`/offers/${id}`, { unitPrice }), onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }) });
  const prefer = useMutation({ mutationFn: (id: string) => patch(`/offers/${id}`, { preferred: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }) });
  return (
    <Card pad={false} title="Supplier offers" subtitle="Price per unit, pack size, lead time · one preferred offer per ingredient (savings baseline)">
      <Q q={q}>
        {(rows) => (
          <Table head={['Ingredient', 'Supplier', 'SKU', 'Pack', 'Unit price', 'Lead', 'Preferred']}>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-2">{o.ingredient}</td>
                <td className="px-3 py-2 text-xs">{o.supplier}</td>
                <td className="px-3 py-2 font-mono text-xs">{o.sku}</td>
                <td className="px-3 py-2 font-mono">
                  {o.pack_size} {o.unit}
                </td>
                <td className="px-3 py-2 font-mono">
                  {me.user.role === 'staff' ? (
                    usd(o.unit_price)
                  ) : (
                    <input
                      aria-label={`Price of ${o.sku}`}
                      className={cx(inputCls, 'w-24 font-mono')}
                      type="number"
                      step="0.01"
                      defaultValue={o.unit_price}
                      onBlur={(e) => Number(e.target.value) !== o.unit_price && setPrice.mutate({ id: o.id, unitPrice: Number(e.target.value) })}
                    />
                  )}
                </td>
                <td className="px-3 py-2">{o.lead_time_days} d</td>
                <td className="px-3 py-2">
                  {o.preferred ? (
                    <Badge tone="green">preferred</Badge>
                  ) : me.user.role !== 'staff' ? (
                    <Button variant="ghost" onClick={() => prefer.mutate(o.id)}>
                      make preferred
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </Card>
  );
}

function Menu() {
  const q = useQuery({ queryKey: ['menu'], queryFn: () => api<any[]>('/menu-items') });
  return (
    <Card title="Menu and recipes" subtitle="Plate cost from preferred offer prices">
      <Q q={q}>
        {(rows) => (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((m) => (
              <div key={m.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-auto font-mono text-sm">{usd(m.price)}</span>
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
    </Card>
  );
}
