import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { Bot, Check, Clock, Info, ListChecks, MessageSquare, Minus, Pause, Play, ShieldCheck, Sparkles, Timer, Users } from 'lucide-react';
import { ago, Badge, Button, Card, cx, dt, Empty, inputCls, Kpi, Modal, num, PageHeader, Q, RoleLink, SearchInput, Status, Table, Tabs, usd, type Tone } from '../components/ui';
import { AgentAvatar } from '../components/AgentAvatar';
import { toolLabel } from '../lib/agentTools';

// Team page (FR-112, FR-120): AI agents (profiles, permissions, status, tasks, runs, scorecards), the people on the
// team with their roles and workload, and team chat (FR-057).
const TABS = [
  ['agents', 'AI agents'],
  ['people', 'People'],
  ['chat', 'Team chat'],
] as const;
type TeamTab = (typeof TABS)[number][0];

export function TeamPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'agents') as TeamTab;
  const q = useQuery({ queryKey: ['agents'], queryFn: () => api<any[]>('/agents') });
  const team = useQuery({ queryKey: ['scorecard', 'team'], queryFn: () => api<any>('/agents/team/scorecard') });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Team" description="Four AI agents and the people who supervise them." actions={<Tabs label="Team view" value={tab} onChange={(t) => setParams({ tab: t })} options={TABS} />} />

      {tab === 'chat' && (
        <Card title="Team chat" icon={MessageSquare} subtitle="Talk to Pilot, or @mention an agent. Without a Gemini key the team answers with structured quick actions.">
          <Thread type="team" id="team" placeholder="e.g. Private party of 40 on Saturday, mostly burgers · @Buyer find a cheaper supplier for chicken thigh" />
        </Card>
      )}
      {tab === 'people' && <People me={me} />}
      {tab === 'agents' && (
        <>
          <h2 className="text-base font-semibold">Your AI purchasing team</h2>
          <Q q={team}>
            {(t) => (
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-card">
                <Kpi icon={ListChecks} label="Tasks done (7 d)" value={t.metrics.tasksCompleted} />
                <Kpi icon={Timer} label="Median resolution" value={t.metrics.medianResolutionMinutes === null ? '—' : `${num(t.metrics.medianResolutionMinutes)} min`} />
                <Kpi icon={Sparkles} label="Verified savings" value={usd(t.metrics.verifiedSavingsUsd)} />
                <Kpi icon={ShieldCheck} label="Policy violations" value={t.metrics.policyViolations} tone={t.metrics.policyViolations ? 'red' : 'green'} />
                <Kpi icon={Bot} label="Model calls / fallbacks" value={`${t.metrics.modelCalls} / ${t.metrics.fallbackRuns}`} sub="AI calls vs rule-based runs" />
                <Kpi icon={Clock} label="Hours saved (est.)" value={num(t.estimates.humanHoursReplaced)} sub={t.estimates.method} />
              </div>
            )}
          </Q>
          <Q q={q}>
            {(agents) => (
              <div className="grid gap-4 md:grid-cols-2">
                {agents.map((a) => (
                  <AgentCard key={a.id} a={a} owner={me.user.role === 'owner'} onOpen={() => setOpen(a.id)} />
                ))}
              </div>
            )}
          </Q>
        </>
      )}
      {open && <AgentDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const ROLE: Record<string, { label: string; tone: Tone; summary: string }> = {
  owner: { label: 'Owner', tone: 'green', summary: 'Administrator: settings, autonomy policy, standing rules, data reset — plus everything a Chef can do' },
  chef: { label: 'Chef', tone: 'blue', summary: 'Purchasing manager: approves orders and disputes within the approval limit, edits stock, suppliers and menu' },
  staff: { label: 'Staff', tone: 'gray', summary: 'Receiving: records deliveries, stock counts and waste, uploads invoices — no approvals' },
};

// Each row reflects a role check enforced by the API (requireRole / policy), not just the UI.
const PERMISSIONS: [string, boolean, boolean, boolean][] = [
  ['View dashboards, orders, forecast and savings', true, true, true],
  ['Receive deliveries, count stock, record waste', true, true, true],
  ['Upload and confirm invoices', true, true, true],
  ['Run the morning plan, message agents', true, true, false],
  ['Approve or reject agent proposals (orders, disputes)', true, true, false],
  ['Edit orders, suppliers, offers, ingredients and menu', true, true, false],
  ['Import CSV, add demand events, record credits', true, true, false],
  ['Approve orders above the Chef approval limit', true, false, false],
  ['Approve standing rules (working agreements)', true, false, false],
  ['Change settings and the autonomy policy', true, false, false],
  ['Reset workspace data', true, false, false],
];

function People({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['team-members'], queryFn: () => api<any[]>('/team/members') });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | 'owner' | 'chef' | 'staff'>('all');
  const [sort, setSort] = useState<'role' | 'name' | 'active' | 'workload'>('role');
  return (
    <div className="space-y-4">
      <Card title="People" icon={Users} pad={false} actions={<span className="text-xs text-muted">{q.data?.length ?? 0} members</span>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <SearchInput className="w-full sm:w-56" value={search} onChange={setSearch} placeholder="Search name or email…" label="Search people" />
          <select aria-label="Filter by role" className={cx(inputCls.replace('w-full ', ''), 'w-auto')} value={role} onChange={(e) => setRole(e.target.value as 'all')}>
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="chef">Chef</option>
            <option value="staff">Staff</option>
          </select>
          <select aria-label="Sort by" className={cx(inputCls.replace('w-full ', ''), 'w-auto')} value={sort} onChange={(e) => setSort(e.target.value as 'role')}>
            <option value="role">Sort: role</option>
            <option value="name">Sort: name</option>
            <option value="active">Sort: last active</option>
            <option value="workload">Sort: open tasks</option>
          </select>
        </div>
        <Q q={q}>
          {(rows) => {
            const list = rows
              .filter((u) => (role === 'all' || u.role === role) && (!search || `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())))
              .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'active' ? (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') : sort === 'workload' ? b.openTasks - a.openTasks : 0));
            if (!list.length) return <div className="p-4"><Empty icon={Users}>No one matches these filters.</Empty></div>;
            return (
              <Table head={['Member', 'Role', 'Open tasks', 'Done', 'Actions logged', 'Last active']} align={['left', 'left', 'right', 'right', 'right', 'left']}>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{u.name.charAt(0)}</span>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {u.name.replace(/\s*\(.*\)$/, '')} {u.id === me.user.id && <span className="text-xs font-normal text-muted">(you)</span>}
                          </div>
                          <div className="truncate text-xs text-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ROLE[u.role].tone} title={ROLE[u.role].summary}>
                        {ROLE[u.role].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{u.openTasks}</td>
                    <td className="px-3 py-2 text-right font-mono">{u.doneTasks}</td>
                    <td className="px-3 py-2 text-right font-mono">{u.actions}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {u.lastActiveAt ? (
                        <>
                          {ago(u.lastActiveAt)}
                          <span className="block">{u.lastAction?.replace(/[._]/g, ' ')}</span>
                        </>
                      ) : (
                        'Never signed in'
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            );
          }}
        </Q>
        <p className="flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-xs text-muted">
          <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Inviting, deactivating or changing the role of members is not available yet — the API has no member-management endpoints. Accounts are created with the workspace.
        </p>
      </Card>
      <Card title="Roles & permissions" icon={ShieldCheck} subtitle="Enforced by the server on every request" pad={false}>
        <Table head={['Permission', 'Owner', 'Chef', 'Staff']} align={['left', 'left', 'left', 'left']}>
          {PERMISSIONS.map(([label, ...allowed]) => (
            <tr key={label}>
              <td className="px-3 py-2">{label}</td>
              {allowed.map((ok, i) => (
                <td key={i} className="px-3 py-2">
                  {ok ? <Check aria-label="Allowed" className="h-4 w-4 text-emerald-700" /> : <Minus aria-label="Not allowed" className="h-4 w-4 text-muted" />}
                </td>
              ))}
            </tr>
          ))}
        </Table>
        <ul className="grid gap-2 border-t border-line p-4 text-xs text-muted sm:grid-cols-3">
          {Object.entries(ROLE).map(([k, r]) => (
            <li key={k}>
              <Badge tone={r.tone}>{r.label}</Badge> <span className="mt-1 block">{r.summary}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}


function AgentCard({ a, owner, onOpen }: { a: any; owner: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const toggle = useMutation({ mutationFn: () => post(`/agents/${a.id}/${a.status === 'paused' ? 'resume' : 'pause'}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }) });
  const approve = Object.entries(a.autonomy).filter(([, l]) => l === 'approve').map(([t]) => t);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <AgentAvatar id={a.id} size="md" />
          {a.displayName}
        </span>
      }
      subtitle={`manifest v${a.manifestVersion}`}
      actions={
        <>
          <Status s={a.status} />
          {owner && (
            <Button size="sm" icon={a.status === 'paused' ? Play : Pause} onClick={() => toggle.mutate()} busy={toggle.isPending}>
              {a.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-muted">{a.role}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        What it can do
        <span className="flex items-center gap-1 font-normal normal-case tracking-normal">
          <span className="h-2 w-2 rounded-full bg-slate-300" /> on its own
        </span>
        <span className="flex items-center gap-1 font-normal normal-case tracking-normal">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> needs your approval
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {a.tools.map((t: string) => (
          <Badge key={t} tone={approve.includes(t) ? 'amber' : 'gray'} title={`${t} — ${approve.includes(t) ? 'needs approval (autonomy policy)' : 'runs on its own'}`}>
            {toolLabel(t)}
          </Badge>
        ))}
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Current tasks</div>
          <ul className="mt-1 space-y-0.5">
            {a.currentTasks.map((t: any) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="hover:underline">
                  {t.title}
                </Link>{' '}
                <Status s={t.status} />
              </li>
            ))}
            {!a.currentTasks.length && <li className="text-muted">None</li>}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Last runs</div>
          <ul className="mt-1 space-y-0.5">
            {a.lastRuns.map((r: any) => (
              <li key={r.id} className="truncate">
                <RoleLink to={`/activity/runs/${r.id}`} className="hover:underline">
                  {dt(r.started_at)}
                </RoleLink>{' '}
                <Status s={r.status} /> {r.mode === 'deterministic' && <Badge>rules engine</Badge>}
              </li>
            ))}
            {!a.lastRuns.length && <li className="text-muted">None yet</li>}
          </ul>
        </div>
      </div>
      <Button variant="ghost" className="mt-3" onClick={onOpen}>
        Profile & scorecard →
      </Button>
    </Card>
  );
}

function AgentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['agent', id], queryFn: () => api<any>(`/agents/${id}`) });
  return (
    <Modal open onClose={onClose} title="Agent profile">
      <Q q={q}>
        {(a) => (
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-semibold">{a.manifest.displayName}</div>
              <div className="text-muted">{a.manifest.role}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Responsibilities</div>
              <ul className="list-disc pl-5">
                {a.manifest.responsibilities.map((r: string) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="text-xs text-muted">
              Triggers: {a.manifest.triggers.join(', ')} · escalates to {a.manifest.escalateTo} · budgets {a.manifest.budgets.maxSteps} steps / {a.manifest.budgets.maxToolCalls} tool calls / {a.manifest.budgets.maxSeconds} s
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Scorecard (7 days)</div>
              <table className="mt-1 w-full text-sm">
                <tbody className="divide-y divide-line">
                  {Object.entries(a.scorecard.metrics).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-1 text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</td>
                      <td className="py-1 text-right font-mono">{v === null ? '—' : typeof v === 'number' ? (k.endsWith('Usd') ? usd(v) : num(v, 3)) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted">
                Estimate (separate): {num(a.scorecard.estimates.humanHoursReplaced)} h — {a.scorecard.estimates.method}
              </p>
            </div>
            {a.agreements.length > 0 && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Working agreements</div>
                <ul>
                  {a.agreements.map((g: any) => (
                    <li key={g.id}>
                      {g.type} <Status s={g.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Q>
    </Modal>
  );
}
