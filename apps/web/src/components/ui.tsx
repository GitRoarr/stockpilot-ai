import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Shared UI primitives (Solution Design §D8.3 states: loading, empty, error with retry, badges).
export const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const agentName = (id: string | null | undefined) => ({ pilot: 'Pilot', 'demand-planner': 'Demand Planner', buyer: 'Buyer', 'ap-clerk': 'AP Clerk' })[id ?? ''] ?? id ?? '';
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-card shadow-[0_1px_0_rgba(0,0,0,0.02)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', TONES[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  draft: 'gray',
  pending_approval: 'amber',
  approved: 'blue',
  sent: 'blue',
  confirmed: 'green',
  partially_confirmed: 'amber',
  received: 'green',
  partially_received: 'amber',
  closed: 'gray',
  cancelled: 'gray',
  completed: 'green',
  running: 'blue',
  queued: 'gray',
  waiting_for_children: 'violet',
  waiting_for_human: 'amber',
  failed: 'red',
  budget_exhausted: 'red',
  idle: 'gray',
  working: 'blue',
  paused: 'gray',
  todo: 'gray',
  in_progress: 'blue',
  waiting: 'amber',
  blocked: 'red',
  done: 'green',
  critical: 'red',
  low: 'amber',
  ok: 'green',
  stale: 'amber',
  unavailable: 'red',
  no_key: 'gray',
  configured: 'green',
  not_checked: 'gray',
  disabled: 'gray',
  not_configured: 'amber',
  credited: 'green',
  partially_credited: 'amber',
  acknowledged: 'blue',
  rejected: 'red',
  matched: 'green',
  variances: 'red',
  disputed: 'amber',
  needs_review: 'amber',
  extracted: 'blue',
  proposed: 'amber',
  active: 'green',
  revoked: 'gray',
  executed: 'green',
  forbidden: 'red',
};

export function Status({ s }: { s: string | null | undefined }) {
  if (!s) return null;
  return <Badge tone={STATUS_TONE[s] ?? 'gray'}>{s.replace(/_/g, ' ')}</Badge>;
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  busy,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-strong border-transparent',
    secondary: 'bg-card text-ink border-line hover:bg-slate-50',
    danger: 'bg-card text-red-700 border-red-200 hover:bg-red-50',
    ghost: 'bg-transparent border-transparent text-accent hover:underline px-1',
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy} className={cx('inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50', styles[variant], className)}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-2 p-1" aria-busy="true" aria-label={label}>
      <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

export function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{(error as Error)?.message ?? 'Something went wrong'}</span>
      {retry && (
        <Button variant="danger" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      <div>{children}</div>
      {action}
    </div>
  );
}

/** Wraps a query: loading skeleton, error with retry, then children. */
export function Q<T>({ q, children, empty }: { q: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (d: T) => ReactNode; empty?: (d: T) => ReactNode | null }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorCard error={q.error} retry={() => q.refetch()} />;
  if (q.data === undefined) return null;
  const e = empty?.(q.data);
  return <>{e ?? children(q.data)}</>;
}

export function Kpi({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'green' | 'amber'; to?: string }) {
  const body = (
    <div className="h-full px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={cx('mt-1 font-mono text-2xl', tone === 'red' && 'text-red-700', tone === 'green' && 'text-emerald-700', tone === 'amber' && 'text-amber-700')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:bg-slate-50">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center border-b border-line px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button aria-label="Close" className="ml-auto rounded px-2 text-muted hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

export function Collapse({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="amber" title="All restaurant inventory, sales, supplier and price figures are invented for the demo (San Francisco Bay Area, USD). Not verified market data.">
      ILLUSTRATIVE DEMO DATA
    </Badge>
  );
}

export function ModeBadge({ mode, reason }: { mode: string; reason?: string | null }) {
  if (mode === 'ai') return <Badge tone="green">AI{reason?.startsWith('model:') ? ` · ${reason.slice(6)}` : ''}</Badge>;
  return <Badge tone="amber" title="Deterministic fallback (FR-061)">rule-based{reason ? ` (${reason})` : ''}</Badge>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-700">{JSON.stringify(value, null, 2)}</pre>;
}
