import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { canOpen, navFor, type Role } from '../lib/nav';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Inbox as InboxIcon, Loader2, RotateCw, Search, X, type LucideIcon } from 'lucide-react';

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

/** Page title with an automatic breadcrumb (section › page) unless explicit crumbs are given. */
export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  const loc = useLocation();
  const here = navFor(loc.pathname);
  const trail = crumbs ?? (here && here.to !== '/' ? [{ label: here.group }, { label: here.label }] : undefined);
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0">
        {trail && (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-muted">
            {trail.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
                {c.to ? (
                  <Link className="hover:text-ink" to={c.to}>
                    {c.label}
                  </Link>
                ) : (
                  <span className={cx(i === trail.length - 1 && 'font-medium text-ink')} aria-current={i === trail.length - 1 ? 'page' : undefined}>
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; icon?: LucideIcon }) {
  const head = Boolean(title || actions);
  return (
    <section className={cx('rounded-2xl border border-line bg-card shadow-card', className)}>
      {head && (
        <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pb-4 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold leading-tight tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? (head ? 'px-5 pb-5' : 'p-5') : ''}>{children}</div>
    </section>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
} as const;
const DOTS = { gray: 'bg-slate-300', blue: 'bg-blue-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-700' } as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, title, dot }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-medium leading-5', TONES[tone])}>
      {dot && <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: 'gray',
  pending_approval: 'amber',
  approved: 'violet',
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
  disputed: 'red',
  needs_review: 'amber',
  extracted: 'blue',
  proposed: 'amber',
  active: 'green',
  revoked: 'gray',
  executed: 'green',
  forbidden: 'red',
};

// Solid status pills (white text on a saturated fill; amber uses dark text for contrast).
const SOLID: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
  blue: 'bg-ink text-paper',
  green: 'bg-[#16a34a] text-white',
  amber: 'bg-[#f59e0b] text-[#1f1300]',
  red: 'bg-[#dc2626] text-white',
  violet: 'bg-[#7c3aed] text-white',
};

export function Status({ s }: { s: string | null | undefined }) {
  if (!s) return null;
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 first-letter:uppercase', SOLID[STATUS_TONE[s] ?? 'gray'])}>{s.replace(/_/g, ' ')}</span>;
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
  secondary: 'border-line bg-card text-ink hover:bg-raised',
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
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium shadow-card transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'ghost' || variant === 'subtle' ? 'shadow-none' : '',
        BTN[variant],
        className,
      )}
    >
      {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : Ico && <Ico aria-hidden className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** Icon-only button: always labelled for screen readers, with a hover/focus tooltip. */
export function IconButton({ icon: Ico, label, onClick, className, badge, pressed }: { icon: LucideIcon; label: string; onClick?: () => void; className?: string; badge?: number; pressed?: boolean }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} className={cx('relative grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink', className)}>
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
    <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
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
    <div className="h-full px-5 py-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {Ico && <Ico aria-hidden className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={cx('mt-1.5 text-2xl font-bold tabular-nums tracking-tight', tone && KPI_TONE[tone])}>{value}</div>
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
    <div className={cx('relative overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-ink">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cx('whitespace-nowrap px-3 py-3 font-medium first:pl-4 last:pr-4', align?.[i] === 'right' && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-raised/60 [&>tr>td]:py-3 [&>tr>td:first-child]:pl-4 [&>tr>td:last-child]:pr-4">{children}</tbody>
      </table>
    </div>
  );
}

/** Accessible dialog: labelled, Escape closes, focus moves into the dialog and returns afterwards. */
export function Modal({ open, onClose, title, children, footer, size = 'md', center = false, bare = false, closeClassName }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; center?: boolean; bare?: boolean; closeClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = [...(ref.current?.querySelectorAll<HTMLElement>('input, select, textarea, button:not([aria-label="Close"]), [href]') ?? [])].find((el) => !el.closest('[inert]'));
    (first ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.closest('[inert]'));
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
    <div className={cx('animate-fade fixed inset-0 z-50 flex justify-center bg-overlay backdrop-blur-[2px] sm:items-center sm:p-4', center ? 'items-center p-4' : 'items-end')} onClick={onClose} role="presentation">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cx('animate-enter max-h-[92vh] w-full overflow-auto border border-line bg-card shadow-pop outline-none sm:rounded-2xl', center ? 'rounded-2xl' : 'rounded-t-2xl', size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-md' : 'max-w-lg', bare && 'relative')}
        onClick={(e) => e.stopPropagation()}
      >
        {bare ? (
          <>
            {/* Bare: the content draws its own layout; the title stays as the dialog's accessible name. */}
            <h3 id={id} className="sr-only">
              {title}
            </h3>
            <button aria-label="Close" className={cx('absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink', closeClassName)} onClick={onClose}>
              <X aria-hidden className="h-4 w-4" />
            </button>
            {children}
          </>
        ) : (
          <>
            <div className="flex items-center border-b border-line px-5 py-4">
              <h3 id={id} className="text-base font-semibold tracking-tight">
                {title}
              </h3>
              <button aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink" onClick={onClose}>
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </>
        )}
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
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
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
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
  'w-full h-9 rounded-lg border border-line bg-card px-3 text-sm text-ink shadow-card outline-none transition-colors placeholder:text-muted hover:border-line-strong focus-visible:outline-none focus:border-muted focus:ring-[3px] focus:ring-[var(--ring)] disabled:opacity-60 [&[type=file]]:h-auto [&[type=file]]:py-1.5';

export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input type="search" aria-label={label} className={cx(inputCls, 'pl-9')} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Segmented tabs / filters; `counts` shows a number next to each option. */
export function Tabs<T extends string>({ value, onChange, options, counts, label }: { value: T; onChange: (v: T) => void; options: readonly (T | readonly [T, string])[]; counts?: Partial<Record<T, number>>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-raised p-1 text-[13px]">
      {options.map((o) => {
        const derived = !Array.isArray(o);
        const [v, l] = derived ? [o as T, String(o).replace(/_/g, ' ')] : (o as readonly [T, string]);
        const active = v === value;
        return (
          <button key={v} role="tab" aria-selected={active} onClick={() => onChange(v)} className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 font-medium transition-colors', derived && 'capitalize', active ? 'bg-card text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink')}>
            {l}
            {counts?.[v] !== undefined && <span className={cx('rounded px-1 text-[11px] tabular-nums', active ? 'bg-ink text-paper' : 'bg-slate-200 text-slate-700')}>{counts[v]}</span>}
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


/** Plain-language reason for a rule-based fallback (FR-061); codes come from the LLM gateway. */
export function fallbackText(reason?: string | null) {
  const why: Record<string, string> = {
    no_api_key: 'no AI key was configured',
    timeout: 'the AI model did not respond in time',
    model_cooldown: 'the AI model was paused after repeated errors',
    rate_limited: 'the AI usage limit was reached',
    validation_failed: 'the AI draft did not pass the number check',
    budget_exhausted: "the run's AI budget was used up",
  };
  return why[reason ?? ''] ?? 'the AI model was unavailable';
}

export function ModeBadge({ mode, reason }: { mode: string; reason?: string | null }) {
  if (mode === 'ai') return <Badge tone="green" title={reason?.startsWith('model:') ? `Written by ${reason.slice(6)}` : undefined}>AI-written</Badge>;
  return (
    <Badge tone="gray" title={`Prepared by the built-in rules engine because ${fallbackText(reason)}. The figures are the same either way.`}>
      Rules engine
    </Badge>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-raised p-2 text-[11px] leading-snug text-slate-700">{JSON.stringify(value, null, 2)}</pre>;
}

/** A link that becomes plain text when the signed-in role cannot open the target page (lib/nav.ts). */
export function RoleLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const role = useQueryClient().getQueryData<{ user: { role: Role } }>(['me'])?.user.role;
  if (role && !canOpen(to.split('?')[0], role)) return <span>{children}</span>;
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

/** Initials avatar for a supplier or person (first letters of the first two words). */
export function Initials({ name, className = 'h-10 w-10 text-xs' }: { name: string; className?: string }) {
  const text = name
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-full bg-raised font-semibold text-muted ring-1 ring-line', className)}>
      {text}
    </span>
  );
}

/** Product logo (/public/logo.png) on a white tile, so it reads on light and dark surfaces. */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg bg-white ring-1 ring-black/5', className)}>
      <img src="/logo.png" alt="" className="h-[90%] w-[90%] object-contain" draggable={false} />
    </span>
  );
}

/** Client-side sorting for a table; `header(key, label)` renders a clickable column header. */
export function useSorted<T, K extends string>(rows: T[], get: Record<K, (r: T) => string | number | null | undefined>, initial: { key: NoInfer<K>; dir: 'asc' | 'desc' }) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const f = get[sort.key];
    return [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort]);
  const header = (key: K, label: string) => {
    const active = sort.key === key;
    const Ico = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button type="button" onClick={() => setSort({ key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })} className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')} aria-label={`Sort by ${label}${active ? (sort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}>
        {label}
        <Ico aria-hidden className={cx('h-3 w-3', !active && 'opacity-40')} />
      </button>
    );
  };
  return { rows: sorted, header };
}

/** Client-side pagination with rows-per-page; the footer is hidden when everything fits on one page of the smallest size. */
export function usePaged<T>(rows: T[], initialSize = 10) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * size, current * size + size);
  const nums = Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1);
  const pager =
    rows.length > 10 ? (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
        <span>
          Showing <span className="font-medium text-ink">{current * size + 1}–{Math.min(rows.length, current * size + size)}</span> of <span className="font-medium text-ink">{rows.length}</span> results
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            Rows
            <select className="h-9 rounded-lg border border-line bg-card px-2 text-sm text-ink" value={size} onChange={(e) => (setSize(Number(e.target.value)), setPage(0))}>
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="h-9 rounded-lg border border-line bg-card px-3 font-medium text-ink hover:bg-raised disabled:opacity-40">
            Previous
          </button>
          {nums.map((n, k) => (
            <span key={n} className="flex items-center gap-2">
              {k > 0 && n - nums[k - 1] > 1 && <span aria-hidden>…</span>}
              <button type="button" aria-current={n === current ? 'page' : undefined} onClick={() => setPage(n)} className={cx('h-9 min-w-9 rounded-lg border px-2 font-medium tabular-nums', n === current ? 'border-accent bg-accent text-on-accent' : 'border-line bg-card text-ink hover:bg-raised')}>
                {n + 1}
              </button>
            </span>
          ))}
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="h-9 rounded-lg border border-line bg-card px-3 font-medium text-ink hover:bg-raised disabled:opacity-40">
            Next
          </button>
        </span>
      </div>
    ) : null;
  return { rows: slice, pager, reset: () => setPage(0) };
}

/** Compact label/value row used in summary panels (numbers right-aligned). */
export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="min-w-0 text-sm text-muted">
        {label}
        {hint && <span className="block text-[11px]">{hint}</span>}
      </dt>
      <dd className={cx('whitespace-nowrap text-sm font-semibold tabular-nums', tone && KPI_TONE[tone])}>{value}</dd>
    </div>
  );
}
