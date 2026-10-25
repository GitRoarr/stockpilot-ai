import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import { Badge, Button, cx, DemoBadge, dt, inputCls } from './ui';

export type Me = { user: { id: string; name: string; email: string; role: 'owner' | 'chef' | 'staff' }; restaurant: string; onboardingComplete: boolean; illustrativeData: boolean };

const NAV = [
  ['/', 'Today'],
  ['/team', 'Team'],
  ['/tasks', 'Tasks'],
  ['/inbox', 'Inbox'],
  ['/orders', 'Orders'],
  ['/receiving', 'Receiving'],
  ['/disputes', 'Disputes'],
  ['/forecast', 'Forecast'],
  ['/inventory', 'Inventory'],
  ['/savings', 'Savings'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings'],
] as const;

const MOBILE = new Set(['/', '/inbox', '/orders', '/receiving', '/team']);

function Dot({ label, status }: { label: string; status: string }) {
  const color = status === 'ok' || status === 'configured' ? 'bg-emerald-500' : status === 'stale' || status === 'not_checked' ? 'bg-amber-400' : status === 'no_key' || status === 'disabled' ? 'bg-slate-300' : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs" title={`${label}: ${status.replace(/_/g, ' ')}`}>
      <span className={cx('h-2 w-2 rounded-full', color)} />
      {label}
    </span>
  );
}

export function Layout({ me, connected, children }: { me: Me; connected: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/health'), refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<any[]>('/notifications') });
  const [bell, setBell] = useState(false);
  const [msg, setMsg] = useState('');
  const send = useMutation({
    mutationFn: (body: string) => post('/team/messages', { body }),
    onSuccess: () => {
      setMsg('');
      nav('/team?tab=chat');
    },
  });
  const logout = async () => {
    await post('/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  const decisions = inbox.data ? inbox.data.counts.proposals + inbox.data.counts.questions + inbox.data.counts.agreements : 0;
  const ai = health.data?.ai;

  useEffect(() => {
    const close = () => setBell(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    if (msg.trim()) send.mutate(msg.trim());
  };

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">SP</span>
          <div>
            <div className="text-[15px] font-semibold leading-tight">StockPilot AI</div>
            <div className="text-[11px] text-muted">{me.restaurant}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center rounded-lg px-3 py-2 text-sm', isActive ? 'bg-blue-50 font-semibold text-accent' : 'text-slate-700 hover:bg-slate-50')}>
              {label}
              {to === '/inbox' && decisions > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 text-xs text-amber-800">{decisions}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 px-4 py-4 text-[11px] text-muted">
          <div>San Francisco, CA · America/Los_Angeles · USD</div>
          <div>
            {me.user.name} · {me.user.role}
          </div>
          <button className="text-accent hover:underline" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-20 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2 md:hidden">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">SP</span>
              <span className="font-semibold">StockPilot</span>
            </div>
            {me.illustrativeData && <DemoBadge />}
            <div className="hidden flex-wrap items-center gap-1.5 lg:flex">
              <Dot label="Gemini" status={health.data?.integrations.gemini ?? 'not_checked'} />
              <Dot label="Weather" status={health.data?.integrations.weather ?? 'not_checked'} />
              <Dot label="Holidays" status={health.data?.integrations.holidays ?? 'not_checked'} />
              <Dot label="Email" status={health.data?.integrations.email ?? 'not_checked'} />
              {ai && (
                <span className="rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[11px]" title="Model calls today / daily budget (GEMINI_DAILY_BUDGET)">
                  AI {ai.used}/{ai.budget}
                </span>
              )}
              <span className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-slate-300')} title={connected ? 'Live updates connected' : 'Live updates disconnected'} />
            </div>
            <form onSubmit={onSend} className="order-last flex w-full items-center gap-2 sm:order-none sm:ml-auto sm:w-auto">
              <input aria-label="Message the team" className={cx(inputCls, 'sm:w-80')} placeholder="Message the team — e.g. “Private party of 40 on Saturday”" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
              <Button type="submit" variant="primary" busy={send.isPending}>
                Send
              </Button>
            </form>
            <div className="relative ml-auto sm:ml-0" onClick={(e) => e.stopPropagation()}>
              <button aria-label={`Notifications (${unread} unread)`} className="relative rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm" onClick={() => setBell(!bell)}>
                🔔{unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{unread}</span>}
              </button>
              {bell && (
                <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-line bg-card shadow-lg">
                  <div className="flex items-center border-b border-line px-3 py-2 text-sm font-semibold">
                    Notifications
                    <button
                      className="ml-auto text-xs font-normal text-accent"
                      onClick={async () => {
                        await post('/notifications/read');
                        qc.invalidateQueries({ queryKey: ['notifications'] });
                      }}
                    >
                      Mark all read
                    </button>
                  </div>
                  <ul className="max-h-96 divide-y divide-line overflow-auto">
                    {(notes.data ?? []).slice(0, 20).map((n) => (
                      <li key={n.id}>
                        <button
                          className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-slate-50', !n.read_at && 'bg-blue-50/40')}
                          onClick={() => {
                            setBell(false);
                            if (n.link) nav(n.link);
                          }}
                        >
                          <div className="font-medium">{n.title}</div>
                          {n.body && <div className="line-clamp-2 text-xs text-muted">{n.body}</div>}
                          <div className="text-[10px] text-muted">{dt(n.created_at)}</div>
                        </button>
                      </li>
                    ))}
                    {!notes.data?.length && <li className="px-3 py-6 text-center text-xs text-muted">No notifications yet</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {send.error && <div className="px-4 pb-2 text-xs text-red-700">{(send.error as Error).message}</div>}
          {health.data?.clockOffsetMs ? (
            <div className="bg-violet-50 px-4 py-1 text-xs text-violet-800">
              Demo clock: {health.data.localDate} {health.data.localTime} (time travel active) <Badge tone="violet">demo</Badge>
            </div>
          ) : null}
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card md:hidden" aria-label="Mobile">
        {NAV.filter(([to]) => MOBILE.has(to)).map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('relative py-3 text-center text-xs', isActive ? 'font-semibold text-accent' : 'text-slate-600')}>
            {label}
            {to === '/inbox' && decisions > 0 && <span className="absolute right-3 top-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{decisions}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
