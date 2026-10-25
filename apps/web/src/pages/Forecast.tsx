import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartLine, CloudRain, Info, PackageSearch, PartyPopper, Table2 } from 'lucide-react';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { Badge, Button, Card, cx, day, ErrorCard, Field, inputCls, num, PageHeader, Q, Table } from '../components/ui';

// Forecast view (FR-027): actual vs forecast with intervals, selected model, WAPE vs seasonal naive, context, events.
const MODEL: Record<string, string> = { M1: 'Seasonal naive', M2: 'Weekday mean', M3: 'Holt-Winters', M4: 'Holt-Winters + weather/holiday' };

export function ForecastPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['forecast'], queryFn: () => api<any>('/forecast?days=7') });
  const [item, setItem] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Forecast" description="Expected dish demand for the next 7 days, how accurate each model has been, and what it means for purchasing." />
      <Q q={q}>
        {(f) => {
          const sel = f.items.find((i: any) => i.menuItemId === item) ?? f.items[0];
          return (
            <>
              <Card title={sel.name} icon={ChartLine} subtitle={`${sel.modelLabel} (${sel.model}) · WAPE ${num((sel.wape[sel.model] ?? 0) * 100)}% vs naive ${num((sel.baselineWape ?? 0) * 100)}%`} actions={<ItemSelect items={f.items} value={sel.menuItemId} onChange={setItem} />}>
                <Chart item={sel} />
                <p className="mt-1 text-[11px] text-muted">Grey line: actual sales (history). Green line: forecast, with its 80% prediction interval from backtest residuals. Weather data by Open-Meteo.com (CC BY 4.0) · Holidays by Nager.Date.</p>
              </Card>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Model per dish" icon={Table2} subtitle="Rolling-origin backtest, 28 origins × horizons 1–7" className="min-w-0 lg:col-span-2" pad={false}>
                  <Table head={['Dish', 'Selected', 'M1 naive', 'M2', 'M3', 'M4', 'Rain effect', 'Tomorrow']}>
                    {f.items.map((i: any) => (
                      <tr key={i.menuItemId} className={cx('cursor-pointer', i.menuItemId === sel.menuItemId && 'bg-accent-soft')} onClick={() => setItem(i.menuItemId)}>
                        <td className="px-3 py-2">
                          <button className="text-left hover:underline" onClick={() => setItem(i.menuItemId)} aria-pressed={i.menuItemId === sel.menuItemId}>
                            {i.name}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone="blue" title={MODEL[i.model]}>
                            {i.model}
                          </Badge>
                        </td>
                        {(['M1', 'M2', 'M3', 'M4'] as const).map((m) => (
                          <td key={m} className={cx('px-3 py-2 font-mono text-xs', m === i.model && 'font-semibold', m === 'M4' && !i.m4Eligible && 'text-muted line-through')}>
                            {i.wape[m] === null ? '—' : `${num(i.wape[m] * 100)}%`}
                          </td>
                        ))}
                        <td className="px-3 py-2 font-mono text-xs">{i.beta ? `${num(i.beta.rain * 100)}%` : '—'}</td>
                        <td className="px-3 py-2 font-mono">{num(i.daily[1]?.value)}</td>
                      </tr>
                    ))}
                  </Table>
                  <p className="px-3 py-2 text-[11px] text-muted">M4 is eligible only if it beats M3 and its effect stays within ±30%. Struck-through = not eligible. Backtest ran in {f.backtestMs} ms.</p>
                </Card>
                <div className="min-w-0 space-y-4">
                  <Assumptions />
                  <Card title="Context" icon={CloudRain}>
                    <ul className="space-y-1 text-sm">
                      {f.context.days.map((c: any) => (
                        <li key={c.date} className="flex gap-2">
                          <span className="w-24">{day(c.date)}</span>
                          <span className="font-mono text-xs">{c.tmaxF === null ? 'no weather' : `${Math.round(c.tmaxF)}°F · ${c.precipIn?.toFixed(2)} in`}</span>
                          {c.holiday && <Badge tone="violet">{c.holiday}</Badge>}
                          {c.holidayEve && <Badge tone="violet">eve</Badge>}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">
                      Weather {f.context.status.weather_forecast?.status ?? 'not checked'} · history {f.context.status.weather_history?.status ?? 'not checked'} · holidays {f.context.status.holidays?.status ?? 'not checked'}
                    </p>
                  </Card>
                  <EventsCard f={f} canAdd={me.user.role !== 'staff'} />
                </div>
              </div>
              <Requirements />
            </>
          );
        }}
      </Q>
    </div>
  );
}

function Assumptions() {
  return (
    <Card title="Assumptions" icon={Info}>
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
        <li>Models learn from up to 180 days of completed daily sales per dish; today is never included.</li>
        <li>The selected model is the one with the lowest backtest error (WAPE); M4 also uses rain, temperature and holidays when that helps.</li>
        <li>Demand events (parties, catering) are added on top of the model, not learned from.</li>
        <li>Ingredient needs = forecast portions × recipe quantities, plus safety stock and any reorder level.</li>
      </ul>
    </Card>
  );
}

/** What the forecast means for buying: ingredients the reorder engine says to order (same engine the Buyer uses). */
function Requirements() {
  const q = useQuery({ queryKey: ['reorder'], queryFn: () => api<any[]>('/reorder') });
  return (
    <Card title="Purchasing requirements" icon={PackageSearch} subtitle="From the forecast, recipes and stock on hand" pad={false}>
      <Q q={q}>
        {(rows) => {
          const need = rows.filter((r) => r.trace.need > 0).sort((a, b) => (a.trace.daysOfCover ?? 99) - (b.trace.daysOfCover ?? 99));
          if (!need.length) return <p className="p-4 text-sm text-muted">Stock covers the forecast — nothing needs ordering right now.</p>;
          return (
            <Table head={['Ingredient', 'On hand', 'Days of cover', 'To order', 'Status']} align={['left', 'right', 'right', 'right', 'left']}>
              {need.map((r) => (
                <tr key={r.ingredientId}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {num(r.onHand)} {r.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{num(r.trace.daysOfCover)}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    {num(r.trace.need)} {r.unit}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.trace.status === 'critical' ? 'red' : r.trace.status === 'low' ? 'amber' : 'gray'} dot>
                      {r.trace.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          );
        }}
      </Q>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Pack sizes, supplier choice and fees are applied by the optimiser when the Buyer drafts orders.</p>
    </Card>
  );
}

function ItemSelect({ items, value, onChange }: { items: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Dish" className={cx(inputCls.replace('w-full ', ''), 'w-full sm:w-56')} value={value} onChange={(e) => onChange(e.target.value)}>
      {items.map((i) => (
        <option key={i.menuItemId} value={i.menuItemId}>
          {i.name}
        </option>
      ))}
    </select>
  );
}

function Chart({ item }: { item: any }) {
  const data = useMemo(
    () => [
      ...item.recent.map((r: any) => ({ date: r.date.slice(5), actual: r.qty })),
      ...item.daily.map((d: any) => ({ date: d.date.slice(5), forecast: Math.round(d.value * 10) / 10, band: [Math.round(d.p10 * 10) / 10, Math.round(d.p90 * 10) / 10], event: d.eventExtra || undefined })),
    ],
    [item],
  );
  const firstForecast = item.daily[0]?.date.slice(5);
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} stroke="var(--chart-grid)" interval={3} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} stroke="var(--chart-grid)" />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, fontSize: 12, color: 'var(--foreground)' }} labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }} itemStyle={{ color: 'var(--foreground)' }} cursor={{ stroke: 'var(--border-strong)' }} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--chart-axis)' }} />
          {firstForecast && <ReferenceLine x={firstForecast} stroke="var(--border-strong)" strokeDasharray="4 3" label={{ value: 'forecast →', position: 'insideTopLeft', fontSize: 11, fill: 'var(--chart-axis)' }} />}
          <Area dataKey="band" name="80% interval" stroke="none" fill="var(--chart-forecast)" fillOpacity={0.14} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual (history)" stroke="var(--chart-actual)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line dataKey="forecast" name="Forecast" stroke="var(--chart-forecast)" strokeWidth={2} dot={{ r: 2, fill: 'var(--chart-forecast)' }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventsCard({ f, canAdd }: { f: any; canAdd: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [covers, setCovers] = useState('');
  const [description, setDescription] = useState('');
  const m = useMutation({
    mutationFn: () => post('/demand-events', { date, covers: Number(covers), description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecast'] });
      qc.invalidateQueries({ queryKey: ['reorder'] });
      toast('success', 'Demand event added', `${description} · +${covers} covers`);
      setDate('');
      setCovers('');
      setDescription('');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Card title="Demand events" icon={PartyPopper} subtitle="Added on top of the model">
      <ul className="mb-3 space-y-1 text-sm">
        {f.events.map((e: any) => (
          <li key={e.id}>
            {day(e.date)} — {e.description} <span className="font-mono text-xs text-muted">{e.extra.covers ? `+${e.extra.covers} covers` : ''}</span>
          </li>
        ))}
        {!f.events.length && <li className="text-muted">None in the next 7 days.</li>}
      </ul>
      {canAdd && (
        <form onSubmit={submit} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Extra covers">
              <input className={inputCls} type="number" min={1} value={covers} onChange={(e) => setCovers(e.target.value)} required />
            </Field>
          </div>
          <Field label="Description">
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} minLength={3} required placeholder="Private party" />
          </Field>
          {m.error && <ErrorCard error={m.error} />}
          <Button type="submit" busy={m.isPending}>
            Add event
          </Button>
          <p className="text-[11px] text-muted">Or tell the team in plain language — “Private party of 40 on Saturday, mostly burgers”.</p>
        </form>
      )}
    </Card>
  );
}
