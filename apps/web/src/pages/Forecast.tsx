import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Badge, Button, Card, cx, day, ErrorCard, Field, inputCls, num, Q, Table } from '../components/ui';

// Forecast view (FR-027): actual vs forecast with intervals, selected model, WAPE vs seasonal naive, context, events.
const MODEL: Record<string, string> = { M1: 'Seasonal naive', M2: 'Weekday mean', M3: 'Holt-Winters', M4: 'Holt-Winters + weather/holiday' };

export function ForecastPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['forecast'], queryFn: () => api<any>('/forecast?days=7') });
  const [item, setItem] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Forecast</h1>
        <Badge tone="amber">Accuracy on illustrative data demonstrates the pipeline, not real-world accuracy</Badge>
      </div>
      <Q q={q}>
        {(f) => {
          const sel = f.items.find((i: any) => i.menuItemId === item) ?? f.items[0];
          return (
            <>
              <Card title={sel.name} subtitle={`${sel.modelLabel} (${sel.model}) · WAPE ${num((sel.wape[sel.model] ?? 0) * 100)}% vs naive ${num((sel.baselineWape ?? 0) * 100)}%`} actions={<ItemSelect items={f.items} value={sel.menuItemId} onChange={setItem} />}>
                <Chart item={sel} />
                <p className="mt-1 text-[11px] text-muted">Shaded band: 80% prediction interval from backtest residuals. Weather data by Open-Meteo.com (CC BY 4.0) · Holidays by Nager.Date.</p>
              </Card>
              <div className="grid gap-5 lg:grid-cols-3">
                <Card title="Model per dish" subtitle="Rolling-origin backtest, 28 origins × horizons 1–7" className="lg:col-span-2" pad={false}>
                  <Table head={['Dish', 'Selected', 'M1 naive', 'M2', 'M3', 'M4', 'Rain effect', 'Tomorrow']}>
                    {f.items.map((i: any) => (
                      <tr key={i.menuItemId} className={cx('cursor-pointer hover:bg-slate-50', i.menuItemId === sel.menuItemId && 'bg-blue-50/50')} onClick={() => setItem(i.menuItemId)}>
                        <td className="px-3 py-2">{i.name}</td>
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
                <div className="space-y-5">
                  <Card title="Context">
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
            </>
          );
        }}
      </Q>
    </div>
  );
}

function ItemSelect({ items, value, onChange }: { items: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Dish" className={cx(inputCls, 'w-56')} value={value} onChange={(e) => onChange(e.target.value)}>
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
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={3} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="band" name="80% interval" stroke="none" fill="#2f55d4" fillOpacity={0.12} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual" stroke="#475467" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line dataKey="forecast" name="Forecast" stroke="#2f55d4" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventsCard({ f, canAdd }: { f: any; canAdd: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [covers, setCovers] = useState('');
  const [description, setDescription] = useState('');
  const m = useMutation({
    mutationFn: () => post('/demand-events', { date, covers: Number(covers), description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecast'] });
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
    <Card title="Demand events" subtitle="Added on top of the model">
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
