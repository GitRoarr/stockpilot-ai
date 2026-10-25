import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Boxes, ChevronDown, ChevronLeft, ClipboardList, Clock, CornerDownLeft, LogOut, Menu, MessageSquare, Monitor, Moon, Play, Search, Send, Settings, Sun, X, type LucideIcon } from 'lucide-react';
import { api, post } from '../api/client';
import { ALL, GROUPS, SETTINGS, type NavItem } from '../lib/nav';
import { useTheme, type ThemePref } from '../lib/theme';
import { useToast } from './toast';
import { Badge, Button, cx, dt, IconButton, inputCls, LogoMark, Modal, Tip } from './ui';

export type Me = { user: { id: string; name: string; email: string; role: 'owner' | 'chef' | 'staff' }; restaurant: string; onboardingComplete: boolean; illustrativeData: boolean };

const MOBILE = ['/', '/inbox', '/orders', '/receiving'];
const ROLE_LABEL = { owner: 'Owner', chef: 'Chef', staff: 'Staff' } as const;

const stored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference not persisted */
  }
};

/** Click-outside and Escape handling for header dropdowns. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const panel = 'animate-enter absolute right-0 z-40 mt-1.5 rounded-lg border border-line bg-card text-sm shadow-pop';

export function Layout({ me, connected, children }: { me: Me; connected: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/health'), refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const [collapsed, setCollapsed] = useState(() => stored('sp-sidebar', 'expanded') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const decisions = inbox.data ? inbox.data.counts.proposals + inbox.data.counts.questions + inbox.data.counts.agreements : 0;
  const canRun = me.user.role !== 'staff';
  const run = useMutation({
    mutationFn: () => post<{ runId: string }>('/agent-runs', { kind: 'morning' }),
    onSuccess: (r) => {
      toast('info', 'Morning plan started', 'Pilot is delegating to Demand Planner and Buyer.');
      nav(`/activity/runs/${r.runId}`);
    },
    onError: (e) => toast('error', 'Could not start the morning plan', (e as Error).message),
  });

  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      store('sp-sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };
  const logout = async () => {
    await post('/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen md:flex">
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-line bg-sidebar text-sidebar-fg transition-[width] duration-200 md:flex', collapsed ? 'w-[68px]' : 'w-64')}>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[68px] z-10 grid h-6 w-6 place-items-center rounded-full border border-line bg-card text-muted shadow-card hover:text-ink"
        >
          <ChevronLeft aria-hidden className={cx('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
        </button>
        <SidebarContent me={me} collapsed={collapsed} decisions={decisions} onLogout={logout} />
      </aside>

      {drawer && (
        <div className="animate-fade fixed inset-0 z-50 bg-overlay md:hidden" onClick={() => setDrawer(false)} role="presentation">
          <aside className="animate-enter flex h-full w-64 flex-col border-r border-sidebar-line bg-sidebar text-sidebar-fg" onClick={(e) => e.stopPropagation()} aria-label="Navigation menu">
            <div className="flex justify-end p-2">
              <button aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover" onClick={() => setDrawer(false)}>
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent me={me} collapsed={false} decisions={decisions} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 pb-16 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-3 sm:px-6">
            <button aria-label="Open menu" className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-raised md:hidden" onClick={() => setDrawer(true)}>
              <Menu aria-hidden className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPalette(true)}
              aria-label="Search"
              className="flex h-9 w-full min-w-0 max-w-[18rem] items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-muted shadow-card transition-colors hover:border-line-strong sm:w-72"
            >
              <Search aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">Search pages, orders, ingredients…</span>
              <kbd className="ml-auto hidden whitespace-nowrap rounded border border-line bg-card px-1.5 py-px font-sans text-[10px] text-muted sm:inline">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              <TeamMessage />
              <SystemStatus health={health.data} connected={connected} />
              <ThemeMenu />
              <Notifications />
              <UserMenu me={me} onLogout={logout} />
            </div>
          </div>
          {health.data?.clockOffsetMs ? (
            <div className="flex items-center gap-2 border-t border-violet-200 bg-violet-50 px-6 py-1 text-xs text-violet-800">
              <Clock aria-hidden className="h-3.5 w-3.5" />
              Simulated clock: {health.data.localDate} {health.data.localTime}
              <Link className="ml-auto underline" to="/settings#clock">
                Change in Settings
              </Link>
            </div>
          ) : null}
        </header>
        <main className="mx-auto max-w-[1440px] px-3 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card md:hidden" aria-label="Mobile">
        {ALL.filter((i) => MOBILE.includes(i.to)).map(({ to, label, icon: Ico }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'font-semibold text-accent' : 'text-muted')}>
            <Ico aria-hidden className="h-5 w-5" />
            {label}
            {to === '/inbox' && decisions > 0 && <span className="absolute right-[22%] top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-on-accent">{decisions}</span>}
          </NavLink>
        ))}
        <button className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted" onClick={() => setDrawer(true)} aria-label="More pages">
          <Menu aria-hidden className="h-5 w-5" />
          More
        </button>
      </nav>
      {palette && <CommandPalette onClose={() => setPalette(false)} canRun={canRun} onRun={() => run.mutate()} />}
    </div>
  );
}

function SidebarContent({ me, collapsed, decisions, onLogout }: { me: Me; collapsed: boolean; decisions: number; onLogout: () => void }) {
  const [closed, setClosed] = useState<string[]>(() => stored('sp-nav-closed', '').split(',').filter(Boolean));
  const toggle = (id: string) =>
    setClosed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      store('sp-nav-closed', next.join(','));
      return next;
    });
  const item = ({ to, label, icon: Ico }: NavItem) => {
    const link = (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          cx('relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors', collapsed && 'justify-center px-0', isActive ? 'bg-sidebar-active font-semibold text-sidebar-accent' : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-strong')
        }
      >
        {({ isActive }) => (
          <>
            <Ico aria-hidden className={cx('h-[18px] w-[18px] shrink-0', isActive ? 'text-sidebar-accent' : 'text-sidebar-muted')} />
            {!collapsed && <span className="truncate">{label}</span>}
            {to === '/inbox' && decisions > 0 && (collapsed ? <span aria-label={`${decisions} waiting`} className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-red-500" /> : <span className="ml-auto rounded-full bg-sidebar-strong px-2 text-[11px] font-semibold leading-5 tabular-nums text-sidebar">{decisions}</span>)}
          </>
        )}
      </NavLink>
    );
    return collapsed ? (
      <Tip key={to} label={label} side="right">
        {link}
      </Tip>
    ) : (
      link
    );
  };
  return (
    <>
      <div className={cx('flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-line px-4', collapsed && 'justify-center px-0')}>
        <LogoMark className="h-9 w-9" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold text-sidebar-strong">StockPilot AI</div>
            <div className="truncate text-[10.5px] font-medium uppercase tracking-wider text-sidebar-muted">{me.restaurant}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main">
        {GROUPS.map((g) => {
          const isClosed = !collapsed && closed.includes(g.id);
          return (
            <div key={g.id}>
              {!collapsed && (
                <button type="button" onClick={() => toggle(g.id)} aria-expanded={!isClosed} className="mb-1 flex w-full items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-fg">
                  {g.label}
                  <ChevronDown aria-hidden className={cx('ml-auto h-3.5 w-3.5 transition-transform', isClosed && '-rotate-90')} />
                </button>
              )}
              {!isClosed && <div className={cx('space-y-0.5', collapsed && 'flex flex-col items-stretch')}>{g.items.map(item)}</div>}
            </div>
          );
        })}
        <div className="border-t border-sidebar-line pt-3">{item(SETTINGS)}</div>
      </nav>
      <div className={cx('flex shrink-0 items-center gap-3 border-t border-sidebar-line px-4 py-3', collapsed && 'flex-col px-0')}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-strong text-xs font-semibold text-sidebar">{me.user.name.charAt(0)}</span>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-sidebar-strong">{me.user.name.replace(/\s*\(.*\)$/, '')}</div>
            <div className="text-xs text-sidebar-muted">{ROLE_LABEL[me.user.role]}</div>
          </div>
        )}
        <Tip label="Sign out" side={collapsed ? 'right' : 'top'}>
          <button onClick={onLogout} aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-strong">
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        </Tip>
      </div>
    </>
  );
}

type Cmd = { id: string; label: string; hint: string; icon: LucideIcon; group: string; run: () => void };

/** Ctrl/⌘ K: jump to pages, orders and ingredients, or run common actions. Uses data already loaded by the app. */
function CommandPalette({ onClose, canRun, onRun }: { onClose: () => void; canRun: boolean; onRun: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<any[]>('/purchase-orders') });
  const ingredients = useQuery({ queryKey: ['ingredients'], queryFn: () => api<any[]>('/ingredients') });
  const go = (to: string) => () => {
    nav(to);
    onClose();
  };
  const cmds = useMemo<Cmd[]>(() => {
    const t = q.trim().toLowerCase();
    const hit = (...f: string[]) => !t || f.some((x) => x.toLowerCase().includes(t));
    const pages: Cmd[] = ALL.filter((p) => hit(p.label, p.description, p.group)).map((p) => ({ id: `p${p.to}`, label: p.label, hint: p.description, icon: p.icon, group: 'Pages', run: go(p.to) }));
    const actions: Cmd[] = [
      ...(canRun ? [{ id: 'a-run', label: 'Run morning plan', hint: 'Forecast, compare suppliers and draft orders', icon: Play, group: 'Actions', run: () => (onRun(), onClose()) }] : []),
      { id: 'a-msg', label: 'Message the team', hint: 'Open team chat', icon: MessageSquare, group: 'Actions', run: go('/team?tab=chat') },
      { id: 'a-notes', label: 'Notifications', hint: 'Open the notifications list', icon: Bell, group: 'Actions', run: go('/inbox') },
    ].filter((a) => hit(a.label, a.hint));
    const po: Cmd[] = t
      ? (orders.data ?? [])
          .filter((o) => hit(o.number, o.supplier))
          .slice(0, 6)
          .map((o) => ({ id: `o${o.id}`, label: `${o.number} · ${o.supplier}`, hint: `${o.status.replace(/_/g, ' ')} · $${o.total.toFixed(2)}`, icon: ClipboardList, group: 'Orders', run: go(`/orders/${o.id}`) }))
      : [];
    const ing: Cmd[] = t
      ? (ingredients.data ?? [])
          .filter((i) => hit(i.name))
          .slice(0, 6)
          .map((i) => ({ id: `i${i.id}`, label: i.name, hint: `${i.status} · ${i.onHand} ${i.unit} on hand`, icon: Boxes, group: 'Ingredients', run: go('/inventory') }))
      : [];
    return [...actions, ...pages, ...po, ...ing];
  }, [q, orders.data, ingredients.data, canRun]);
  useEffect(() => setActive(0), [q]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, cmds.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === 'Enter' && cmds[active]) (e.preventDefault(), cmds[active].run());
    else if (e.key === 'Escape') onClose();
  };
  let lastGroup = '';
  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-start justify-center bg-overlay px-3 pt-[12vh]" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Search" className="animate-enter w-full max-w-xl overflow-hidden rounded-xl border border-line bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden className="h-4 w-4 text-muted" />
          <input
            autoFocus
            aria-label="Search pages, orders and ingredients"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Search pages, orders, ingredients…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {cmds.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="none">
                {header && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{header}</div>}
                <button role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={c.run} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm', i === active ? 'bg-accent-soft' : '')}>
                  <c.icon aria-hidden className={cx('h-4 w-4 shrink-0', i === active ? 'text-accent' : 'text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.label}</span>
                    <span className="block truncate text-xs text-muted">{c.hint}</span>
                  </span>
                  {i === active && <CornerDownLeft aria-hidden className="h-3.5 w-3.5 text-muted" />}
                </button>
              </li>
            );
          })}
          {!cmds.length && <li className="px-3 py-8 text-center text-sm text-muted">No results for “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

function TeamMessage() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const send = useMutation({
    mutationFn: (body: string) => post('/team/messages', { body }),
    onSuccess: () => {
      setMsg('');
      setOpen(false);
      nav('/team?tab=chat');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (msg.trim()) send.mutate(msg.trim());
  };
  return (
    <>
      <IconButton icon={MessageSquare} label="Message the team" onClick={() => setOpen(true)} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Message the team"
        footer={
          <Button variant="primary" icon={Send} busy={send.isPending} onClick={() => msg.trim() && send.mutate(msg.trim())}>
            Send
          </Button>
        }
      >
        <form onSubmit={submit}>
          <textarea aria-label="Message" className={cx(inputCls, 'h-24 py-2')} placeholder="e.g. Private party of 40 on Saturday, mostly burgers · @Buyer find a cheaper supplier for chicken" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
          <p className="mt-1.5 text-xs text-muted">Goes to Pilot, or to the agent you @mention. Replies appear in Team chat.</p>
        </form>
        {send.error && <p role="alert" className="mt-2 text-xs text-red-700">{(send.error as Error).message}</p>}
      </Modal>
    </>
  );
}

const STATUS_DOT = (s: string) => (s === 'ok' || s === 'configured' ? 'bg-emerald-500' : s === 'stale' || s === 'not_checked' ? 'bg-amber-500' : s === 'no_key' || s === 'disabled' ? 'bg-slate-300' : 'bg-red-500');

function SystemStatus({ health, connected }: { health: any; connected: boolean }) {
  const d = useDropdown();
  const rows: [string, string, string][] = [
    ['Gemini (AI)', health?.integrations.gemini ?? 'not_checked', 'Language model for the agents; rule-based fallback without a key'],
    ['Weather', health?.integrations.weather ?? 'not_checked', 'Open-Meteo forecast and history'],
    ['Holidays', health?.integrations.holidays ?? 'not_checked', 'Nager.Date public holidays'],
    ['Email', health?.integrations.email ?? 'not_checked', 'Brevo; portal links are used without a key'],
  ];
  const degraded = rows.some(([, s]) => !['ok', 'configured', 'no_key', 'disabled'].includes(s));
  return (
    <div className="relative" ref={d.ref}>
      <Tip label="System status">
        <button aria-label="System status" aria-expanded={d.open} onClick={() => d.setOpen(!d.open)} className="relative grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink">
          <Activity aria-hidden className="h-4 w-4" />
          <span aria-hidden className={cx('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', !connected ? 'bg-slate-300' : degraded ? 'bg-amber-500' : 'bg-emerald-500')} />
        </button>
      </Tip>
      {d.open && (
        <div className={cx(panel, 'w-80 p-3')}>
          <div className="mb-2 text-xs font-semibold">System status</div>
          <ul className="space-y-2">
            {rows.map(([label, s, help]) => (
              <li key={label} className="flex items-start gap-2">
                <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', STATUS_DOT(s))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted">{s.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-xs text-muted">{help}</div>
                </div>
              </li>
            ))}
            <li className="flex items-center justify-between border-t border-line pt-2 text-xs">
              <span className="text-muted">Model calls today / daily budget</span>
              <span className="font-mono">{health?.ai ? `${health.ai.used}/${health.ai.budget}` : '—'}</span>
            </li>
            <li className="flex items-center justify-between text-xs">
              <span className="text-muted">Live updates</span>
              <span>{connected ? 'connected' : 'disconnected'}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

const THEMES: [ThemePref, string, LucideIcon][] = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Monitor],
];

export function ThemeMenu() {
  const { pref, theme, setPref } = useTheme();
  const d = useDropdown();
  const Current = theme === 'dark' ? Moon : Sun;
  return (
    <div className="relative" ref={d.ref}>
      <Tip label="Theme">
        <button aria-label={`Theme: ${pref}`} aria-haspopup="menu" aria-expanded={d.open} onClick={() => d.setOpen(!d.open)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink">
          <Current aria-hidden className="h-4 w-4" />
        </button>
      </Tip>
      {d.open && (
        <div role="menu" aria-label="Theme" className={cx(panel, 'w-36 p-1')}>
          {THEMES.map(([v, label, Ico]) => (
            <button
              key={v}
              role="menuitemradio"
              aria-checked={pref === v}
              onClick={() => {
                setPref(v);
                d.setOpen(false);
              }}
              className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised', pref === v && 'font-medium text-accent')}
            >
              <Ico aria-hidden className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<any[]>('/notifications') });
  const d = useDropdown();
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="relative" ref={d.ref}>
      <IconButton icon={Bell} label={`Notifications (${unread} unread)`} badge={unread} onClick={() => d.setOpen(!d.open)} />
      {d.open && (
        <div className={cx(panel, 'w-[min(22rem,calc(100vw-1.5rem))]')}>
          <div className="flex items-center border-b border-line px-3 py-2 font-semibold">
            Notifications
            {unread > 0 && (
              <button
                className="ml-auto text-xs font-normal text-accent hover:underline"
                onClick={async () => {
                  await post('/notifications/read');
                  qc.invalidateQueries({ queryKey: ['notifications'] });
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-auto">
            {(notes.data ?? []).slice(0, 20).map((n) => (
              <li key={n.id}>
                <button
                  className="flex w-full gap-2 px-3 py-2 text-left hover:bg-raised"
                  onClick={() => {
                    d.setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <span aria-hidden className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} />
                  <span className="min-w-0">
                    <span className={cx('block', !n.read_at && 'font-medium')}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="block text-[11px] text-muted">{dt(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!notes.data?.length && <li className="px-3 py-6 text-center text-xs text-muted">No notifications yet</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const d = useDropdown();
  return (
    <div className="relative ml-1" ref={d.ref}>
      <button aria-label="Account menu" aria-haspopup="menu" aria-expanded={d.open} onClick={() => d.setOpen(!d.open)} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-raised">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{me.user.name.charAt(0)}</span>
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-xs font-medium">{me.user.name.replace(/\s*\(.*\)$/, '')}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[me.user.role]}</span>
        </span>
      </button>
      {d.open && (
        <div role="menu" className={cx(panel, 'w-60 p-1')}>
          <div className="border-b border-line px-2 py-2">
            <div className="font-medium">{me.user.name}</div>
            <div className="truncate text-xs text-muted">{me.user.email}</div>
            <div className="mt-1">
              <Badge tone="green">{ROLE_LABEL[me.user.role]}</Badge>
            </div>
          </div>
          <Link role="menuitem" to="/settings" onClick={() => d.setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised">
            <Settings aria-hidden className="h-4 w-4 text-muted" /> Settings
          </Link>
          <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised">
            <LogOut aria-hidden className="h-4 w-4 text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
