import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Inbox as InboxIcon, Loader2, RotateCw, Search, X, type LucideIcon } from 'lucide-react';

// Shared UI primitives (Solution Design §D8.3 states: loading, empty, error with retry, badges). All colours come from
// theme tokens in index.css, so every component works in light and dark mode without per-component overrides.
export const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: d })}%`);
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const time = (s: string | null | undefined) => (s ? new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const ago = (s: string | null | undefined) => {
  if (!s) return '—';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return dt(s);
};
export const agentName = (id: string | null | undefined) => ({ pilot: 'Pilot', 'demand-planner': 'Demand Planner', buyer: 'Buyer', 'ap-clerk': 'AP Clerk' })[id ?? ''] ?? id ?? '';
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight aria-hidden className="h-3 w-3" />}
                {c.to ? (
                  <Link className="hover:text-ink" to={c.to}>
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true, icon: Ico }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; icon?: LucideIcon }) {
  return (
    <section className={cx('rounded-lg border border-line bg-card shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line px-4 py-2.5">
          {Ico && <Ico aria-hidden className="h-4 w-4 text-muted" />}
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
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
const DOTS = { gray: 'bg-slate-300', blue: 'bg-blue-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-700' } as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, title, dot }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-medium leading-5', TONES[tone])}>
      {dot && <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
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
  return (
    <Badge tone={STATUS_TONE[s] ?? 'gray'} dot>
      {s.replace(/_/g, ' ')}
    </Badge>
  );
}

type ButtonProps = {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
  'aria-label'?: string;
};

const BTN = {
  primary: 'border-transparent bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'border-line-strong bg-card text-ink hover:bg-raised',
  danger: 'border-red-300 bg-card text-red-700 hover:bg-red-50',
  subtle: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-ink',
  ghost: 'border-transparent bg-transparent px-0! text-accent hover:underline',
};

export function Button({ children, onClick, variant = 'secondary', size = 'md', icon: Ico, disabled, busy, type = 'button', className, title, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      title={title}
      aria-label={rest['aria-label']}
      onClick={onClick}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium shadow-card transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        variant === 'ghost' || variant === 'subtle' ? 'shadow-none' : '',
        BTN[variant],
        className,
      )}
    >
      {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : Ico && <Ico aria-hidden className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/** Icon-only button: always labelled for screen readers, with a hover/focus tooltip. */
export function IconButton({ icon: Ico, label, onClick, className, badge, pressed }: { icon: LucideIcon; label: string; onClick?: () => void; className?: string; badge?: number; pressed?: boolean }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} className={cx('relative grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink', className)}>
        <Ico aria-hidden className="h-4 w-4" />
        {badge ? <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{badge > 99 ? '99+' : badge}</span> : null}
      </button>
    </Tip>
  );
}

/** Lightweight tooltip shown on hover and keyboard focus. */
export function Tip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'bottom' | 'right' | 'top' }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] font-medium text-paper opacity-0 shadow-pop transition-opacity delay-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100',
          side === 'bottom' && 'left-1/2 top-full mt-1.5 -translate-x-1/2',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cx('h-3.5 w-3.5 animate-spin', className)} />;
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2 p-1" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cx('skeleton h-4 rounded', ['w-1/3', 'w-2/3', 'w-1/2', 'w-3/4'][i % 4])} />
      ))}
    </div>
  );
}

export function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{(error as Error)?.message ?? 'Something went wrong'}</span>
      {retry && (
        <Button size="sm" variant="danger" icon={RotateCw} onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Empty({ children, action, icon: Ico = InboxIcon, title }: { children: ReactNode; action?: ReactNode; icon?: LucideIcon; title?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
      <Ico aria-hidden className="h-5 w-5" />
      {title && <div className="font-medium text-ink">{title}</div>}
      <div className="max-w-sm">{children}</div>
      {action && <div className="mt-1">{action}</div>}
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

const KPI_TONE = { red: 'text-red-700', green: 'text-emerald-700', amber: 'text-amber-700' } as const;

export function Kpi({ label, value, sub, tone, to, icon: Ico }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof KPI_TONE; to?: string; icon?: LucideIcon }) {
  const body = (
    <div className="h-full px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {Ico && <Ico aria-hidden className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={cx('mt-1 text-xl font-semibold tabular-nums tracking-tight', tone && KPI_TONE[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block transition-colors hover:bg-raised">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Table({ head, children, className, align }: { head: ReactNode[]; children: ReactNode; className?: string; align?: ('left' | 'right')[] }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-raised text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cx('whitespace-nowrap px-3 py-2 font-medium', align?.[i] === 'right' && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-raised/60">{children}</tbody>
      </table>
    </div>
  );
}

/** Accessible dialog: labelled, Escape closes, focus moves into the dialog and returns afterwards. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"]), [href]');
    (first ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (f[f.length - 1].focus(), e.preventDefault());
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (f[0].focus(), e.preventDefault());
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center sm:p-4" onClick={onClose} role="presentation">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cx('animate-enter max-h-[92vh] w-full overflow-auto rounded-t-xl border border-line bg-card shadow-pop outline-none sm:rounded-lg', size === 'lg' ? 'max-w-2xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-4 py-3">
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          <button aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-raised/50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for consequential actions. */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'primary', busy, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; tone?: 'primary' | 'danger'; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={tone} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{body}</div>
    </Modal>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}

export const inputCls =
  'w-full h-8 rounded-md border border-line-strong bg-card px-2.5 text-sm text-ink shadow-card outline-none transition-colors placeholder:text-muted hover:border-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60 [&[type=file]]:h-auto [&[type=file]]:py-1.5';

export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
      <input type="search" aria-label={label} className={cx(inputCls, 'pl-8')} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Segmented tabs / filters; `counts` shows a number next to each option. */
export function Tabs<T extends string>({ value, onChange, options, counts, label }: { value: T; onChange: (v: T) => void; options: readonly (T | readonly [T, string])[]; counts?: Partial<Record<T, number>>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-raised p-0.5 text-sm">
      {options.map((o) => {
        const derived = !Array.isArray(o);
        const [v, l] = derived ? [o as T, String(o).replace(/_/g, ' ')] : (o as readonly [T, string]);
        const active = v === value;
        return (
          <button key={v} role="tab" aria-selected={active} onClick={() => onChange(v)} className={cx('flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 transition-colors', derived && 'capitalize', active ? 'bg-card font-medium text-ink shadow-card' : 'text-muted hover:text-ink')}>
            {l}
            {counts?.[v] !== undefined && <span className={cx('rounded px-1 text-[11px] tabular-nums', active ? 'bg-accent-soft text-accent' : 'bg-slate-200 text-slate-700')}>{counts[v]}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Collapse({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />} {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}


export function ModeBadge({ mode, reason }: { mode: string; reason?: string | null }) {
  if (mode === 'ai') return <Badge tone="green">AI{reason?.startsWith('model:') ? ` · ${reason.slice(6)}` : ''}</Badge>;
  return (
    <Badge tone="amber" title="Deterministic fallback (FR-061): the same engines ran without the language model">
      rule-based{reason ? ` (${reason})` : ''}
    </Badge>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-md border border-line bg-raised p-2 text-[11px] leading-snug text-slate-700">{JSON.stringify(value, null, 2)}</pre>;
}

/** Product mark: an upward stock line on a solid tile. */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-md bg-accent text-on-accent', className)}>
      <svg aria-hidden viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
    </span>
  );
}
