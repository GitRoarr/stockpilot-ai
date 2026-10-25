import { useId, useMemo, useState } from 'react';
import { cx } from './ui';

// Lightweight SVG charts (no chart library on the main bundle). Colours come from theme tokens via currentColor/CSS vars.
type Point = { date: string; value: number };

const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

/** Small trend line with a soft area fill, for KPI cards. */
export function Sparkline({ data, color = 'var(--chart-primary)', className = 'h-12 w-full' }: { data: number[]; color?: string; className?: string }) {
  const id = useId();
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const W = 120;
  const H = 36;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 2 - ((v - min) / (max - min || 1)) * (H - 6)] as [number, number]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path(pts)} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
      <path d={path(pts)} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Area chart: actual series (solid) followed by an optional projected series (dashed), with axes and a hover readout. */
export function AreaChart({ actual, projected = [], format = (n) => n.toLocaleString('en-US'), label }: { actual: Point[]; projected?: Point[]; format?: (n: number) => string; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const all = useMemo(() => [...actual.map((p) => ({ ...p, kind: 'actual' as const })), ...projected.map((p) => ({ ...p, kind: 'projected' as const }))], [actual, projected]);
  if (!all.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  const W = 720;
  const H = 240;
  const L = 44;
  const B = 24;
  const T = 10;
  const max = Math.max(...all.map((p) => p.value), 1) * 1.1;
  const step = (W - L - 8) / Math.max(all.length - 1, 1);
  const x = (i: number) => L + i * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const a = actual.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const pr = projected.length ? [[x(actual.length - 1), y(actual[actual.length - 1]?.value ?? 0)] as [number, number], ...projected.map((p, i) => [x(actual.length + i), y(p.value)] as [number, number])] : [];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const every = Math.ceil(all.length / 8);
  const h = hover !== null ? all[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--chart-forecast)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--chart-forecast)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={t ? '3 4' : undefined} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-axis)">
              {format(Math.round(t))}
            </text>
          </g>
        ))}
        {all.map((p, i) =>
          (i % every === 0 && all.length - 1 - i >= every / 2) || i === all.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 6} textAnchor={i === all.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--chart-axis)">
              {p.date.slice(5).replace('-', '/')}
            </text>
          ) : null,
        )}
        {a.length > 1 && <path d={`${path(a)} L${a[a.length - 1][0]} ${y(0)} L${a[0][0]} ${y(0)} Z`} fill={`url(#${id})`} />}
        {a.length > 1 && <path d={path(a)} fill="none" stroke="var(--chart-forecast)" strokeWidth="2.2" strokeLinejoin="round" />}
        {pr.length > 1 && <path d={path(pr)} fill="none" stroke="var(--chart-forecast)" strokeWidth="2.2" strokeDasharray="5 5" strokeLinejoin="round" opacity="0.8" />}
        {all.map((p, i) => (
          <rect key={p.date} x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--border-strong)" />
            <circle cx={x(hover)} cy={y(h.value)} r="4" fill="var(--surface)" stroke="var(--chart-forecast)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-xs shadow-pop" style={{ left: `clamp(0px, calc(${((x(hover) / W) * 100).toFixed(1)}% - 60px), calc(100% - 130px))` }}>
          <div className="text-muted">
            {h.date} · {h.kind === 'actual' ? 'actual' : 'forecast'}
          </div>
          <div className="font-semibold tabular-nums">{format(h.value)}</div>
        </div>
      )}
    </div>
  );
}

const PALETTE = ['var(--chart-primary)', '#0e9f8f', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444'];

/** Donut with a centre total and a legend with shares. */
export function Donut({ items, centerLabel, format }: { items: { label: string; value: number }[]; centerLabel: string; format: (n: number) => string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img" aria-label={`${centerLabel}: ${format(total)}`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-muted)" strokeWidth="14" />
        {total > 0 &&
          items.map((it, i) => {
            const len = (it.value / total) * C;
            const seg = <circle key={it.label} cx="60" cy="60" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="14" strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
            offset += len;
            return seg;
          })}
        <text x="60" y="58" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--foreground)">
          {format(total)}
        </text>
        <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">
          {centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            <span className="font-semibold tabular-nums">{total ? Math.round((it.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Labelled progress bar. */
export function Progress({ label, value, max, detail, tone = 'var(--chart-primary)' }: { label: string; value: number; max: number; detail?: string; tone?: string }) {
  const pctv = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{pctv}%</span>
      </div>
      <div className={cx('mt-1.5 h-2 overflow-hidden rounded-full bg-raised')}>
        <div className="h-2 rounded-full" style={{ width: `${pctv}%`, background: tone }} />
      </div>
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
    </div>
  );
}
