import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Boxes,
  ChartLine,
  ClipboardList,
  Clock,
  House,
  Inbox,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PiggyBank,
  Scale,
  Send,
  Settings,
  Sun,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, post } from '../api/client';
import { useTheme, type ThemePref } from '../lib/theme';
import { Badge, Button, cx, dt, IconButton, inputCls, LogoMark, Modal, Tip } from './ui';

export type Me = { user: { id: string; name: string; email: string; role: 'owner' | 'chef' | 'staff' }; restaurant: string; onboardingComplete: boolean; illustrativeData: boolean };

type NavItem = { to: string; label: string; icon: LucideIcon };
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Today', icon: House },
      { to: '/inbox', label: 'Inbox', icon: Inbox },
      { to: '/orders', label: 'Orders', icon: ClipboardList },
      { to: '/receiving', label: 'Receiving', icon: Truck },
      { to: '/disputes', label: 'Disputes', icon: Scale },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/forecast', label: 'Forecast', icon: ChartLine },
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/savings', label: 'Savings', icon: PiggyBank },
    ],
  },
  {
    label: 'Collaboration',
    items: [
      { to: '/team', label: 'Team', icon: Users },
      { to: '/tasks', label: 'Tasks', icon: ListChecks },
      { to: '/activity', label: 'Activity', icon: Activity },
    ],
  },
];
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings };
const ALL = [...GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), { ...SETTINGS, group: 'Workspace' }];
const MOBILE = ['/', '/inbox', '/orders', '/receiving'];
const ROLE_LABEL = { owner: 'Owner', chef: 'Chef', staff: 'Staff' } as const;

const readCollapsed = () => {
  try {
    return localStorage.getItem('sp-sidebar') === 'collapsed';
  } catch {
    return false;
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
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/health'), refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const decisions = inbox.data ? inbox.data.counts.proposals + inbox.data.counts.questions + inbox.data.counts.agreements : 0;
  const current = ALL.find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));

  useEffect(() => setDrawer(false), [loc.pathname]);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('sp-sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* preference not persisted */
      }
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
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-line bg-sidebar text-sidebar-fg transition-[width] duration-200 md:flex', collapsed ? 'w-[60px]' : 'w-56')}>
        <SidebarContent me={me} collapsed={collapsed} decisions={decisions} />
        <div className="border-t border-sidebar-line p-2">
          <button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={cx('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-xs text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg', collapsed && 'justify-center px-0')}>
            {collapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4" /> : <PanelLeftClose aria-hidden className="h-4 w-4" />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {drawer && (
        <div className="animate-fade fixed inset-0 z-50 bg-overlay md:hidden" onClick={() => setDrawer(false)} role="presentation">
          <aside className="animate-enter flex h-full w-64 flex-col bg-sidebar text-sidebar-fg" onClick={(e) => e.stopPropagation()} aria-label="Navigation menu">
            <div className="flex justify-end p-2">
              <button aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover" onClick={() => setDrawer(false)}>
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent me={me} collapsed={false} decisions={decisions} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 pb-16 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
          <div className="flex h-12 items-center gap-2 px-3 sm:px-5">
            <button aria-label="Open menu" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised md:hidden" onClick={() => setDrawer(true)}>
              <Menu aria-hidden className="h-4 w-4" />
            </button>
            <nav aria-label="Location" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="hidden text-muted sm:inline">{current?.group ?? 'StockPilot'}</span>
              <span className="hidden text-muted sm:inline">/</span>
              <span className="truncate font-medium">{current?.label ?? 'StockPilot'}</span>
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <TeamMessage />
              <SystemStatus health={health.data} connected={connected} />
              <ThemeMenu />
              <Notifications />
              <UserMenu me={me} onLogout={logout} />
            </div>
          </div>
          {health.data?.clockOffsetMs ? (
            <div className="flex items-center gap-2 border-t border-violet-200 bg-violet-50 px-5 py-1 text-xs text-violet-800">
              <Clock aria-hidden className="h-3.5 w-3.5" />
              Simulated clock: {health.data.localDate} {health.data.localTime}
              <Link className="ml-auto underline" to="/settings#clock">
                Change in Settings
              </Link>
            </div>
          ) : null}
        </header>
        <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-5 lg:px-6">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card md:hidden" aria-label="Mobile">
        {ALL.filter((i) => MOBILE.includes(i.to)).map(({ to, label, icon: Ico }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'font-semibold text-accent' : 'text-muted')}>
            <Ico aria-hidden className="h-5 w-5" />
            {label}
            {to === '/inbox' && decisions > 0 && <span className="absolute right-[22%] top-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-white dark:text-black">{decisions}</span>}
          </NavLink>
        ))}
        <button className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted" onClick={() => setDrawer(true)} aria-label="More pages">
          <Menu aria-hidden className="h-5 w-5" />
          More
        </button>
      </nav>
    </div>
  );
}

function SidebarContent({ me, collapsed, decisions }: { me: Me; collapsed: boolean; decisions: number }) {
  const item = ({ to, label, icon: Ico }: NavItem) => {
    const link = (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          cx(
            'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
            collapsed && 'justify-center px-0',
            isActive ? 'bg-sidebar-active font-medium text-white before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r before:bg-accent' : 'text-sidebar-fg/85 hover:bg-sidebar-hover hover:text-white',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Ico aria-hidden className={cx('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-sidebar-muted')} />
            {!collapsed && <span className="truncate">{label}</span>}
            {to === '/inbox' && decisions > 0 && (collapsed ? <span aria-label={`${decisions} waiting`} className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" /> : <span className="ml-auto rounded bg-amber-500/20 px-1.5 text-[11px] font-semibold tabular-nums text-amber-400">{decisions}</span>)}
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
      <div className={cx('flex h-12 items-center gap-2.5 border-b border-sidebar-line px-3.5', collapsed && 'justify-center px-0')}>
        <LogoMark />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-semibold text-white">StockPilot AI</div>
            <div className="truncate text-[11px] text-sidebar-muted">{me.restaurant}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
        {GROUPS.map((g) => (
          <div key={g.label}>
            {!collapsed && <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-muted">{g.label}</div>}
            <div className={cx('space-y-px', collapsed && 'flex flex-col items-stretch')}>{g.items.map(item)}</div>
          </div>
        ))}
        <div className="border-t border-sidebar-line pt-3">{item(SETTINGS)}</div>
      </nav>
    </>
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
      <form onSubmit={submit} className="mr-1 hidden items-center gap-1.5 lg:flex">
        <input aria-label="Message the team" className={cx(inputCls, 'w-72 xl:w-80')} placeholder="Message the team — e.g. “Private party of 40 on Saturday”" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
        <Button type="submit" variant="primary" icon={Send} busy={send.isPending} aria-label="Send message to the team">
          Send
        </Button>
      </form>
      <span className="lg:hidden">
        <IconButton icon={MessageSquare} label="Message the team" onClick={() => setOpen(true)} />
      </span>
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
        <textarea aria-label="Message" className={cx(inputCls, 'h-24 py-2')} placeholder="e.g. Private party of 40 on Saturday, mostly burgers" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
      </Modal>
      {send.error && !open && <span className="sr-only" role="alert">{(send.error as Error).message}</span>}
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
