import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { Badge, Button, Card, cx, dt, Modal, num, Q, Status, usd } from '../components/ui';

// Team page (FR-112, FR-120): profiles, permissions, status, tasks, runs, scorecards; team chat (FR-057).
export function TeamPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'agents';
  const q = useQuery({ queryKey: ['agents'], queryFn: () => api<any[]>('/agents') });
  const team = useQuery({ queryKey: ['scorecard', 'team'], queryFn: () => api<any>('/agents/team/scorecard') });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Your AI purchasing team</h1>
        <div className="ml-auto flex gap-1 rounded-lg border border-line bg-card p-1 text-sm">
          {['agents', 'chat'].map((t) => (
            <button key={t} className={cx('rounded-md px-3 py-1', tab === t ? 'bg-blue-50 font-semibold text-accent' : 'text-slate-600')} onClick={() => setParams({ tab: t })}>
              {t === 'agents' ? 'Agents' : 'Team chat'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat' ? (
        <Card title="Team chat" subtitle="Talk to Pilot, or @mention an agent. Without a Gemini key the team answers with structured quick actions.">
          <Thread type="team" id="team" placeholder="e.g. Private party of 40 on Saturday, mostly burgers · @Buyer find a cheaper supplier for chicken thigh" />
        </Card>
      ) : (
        <>
          <Q q={team}>
            {(t) => (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <Metric label="Tasks done (7 d)" v={t.metrics.tasksCompleted} />
                <Metric label="Median resolution" v={t.metrics.medianResolutionMinutes === null ? '—' : `${num(t.metrics.medianResolutionMinutes)} min`} />
                <Metric label="Verified savings" v={usd(t.metrics.verifiedSavingsUsd)} />
                <Metric label="Policy violations" v={t.metrics.policyViolations} tone={t.metrics.policyViolations ? 'text-red-700' : 'text-emerald-700'} />
                <Metric label="Model calls / fallbacks" v={`${t.metrics.modelCalls} / ${t.metrics.fallbackRuns}`} />
                <Metric label="Human hours replaced (est.)" v={num(t.estimates.humanHoursReplaced)} title={t.estimates.method} />
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

function Metric({ label, v, tone, title }: { label: string; v: React.ReactNode; tone?: string; title?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2" title={title}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={cx('font-mono text-lg', tone)}>{v}</div>
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
          <span className={cx('grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white', { pilot: 'bg-indigo-600', 'demand-planner': 'bg-teal-600', buyer: 'bg-blue-600', 'ap-clerk': 'bg-rose-600' }[a.id as string] ?? 'bg-slate-600')}>
            {a.displayName
              .split(' ')
              .map((w: string) => w[0])
              .join('')}
          </span>
          {a.displayName}
        </span>
      }
      subtitle={`manifest v${a.manifestVersion}`}
      actions={
        <>
          <Status s={a.status} />
          {owner && (
            <Button onClick={() => toggle.mutate()} busy={toggle.isPending}>
              {a.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm">{a.role}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {a.tools.map((t: string) => (
          <Badge key={t} tone={approve.includes(t) ? 'amber' : 'gray'} title={approve.includes(t) ? 'Needs approval (autonomy policy)' : 'Runs on its own'}>
            {t}
          </Badge>
        ))}
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Current tasks</div>
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
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Last runs</div>
          <ul className="mt-1 space-y-0.5">
            {a.lastRuns.map((r: any) => (
              <li key={r.id} className="truncate">
                <Link to={`/activity/runs/${r.id}`} className="hover:underline">
                  {dt(r.started_at)}
                </Link>{' '}
                <Status s={r.status} /> {r.mode === 'deterministic' && <Badge tone="amber">rule-based</Badge>}
              </li>
            ))}
            {!a.lastRuns.length && <li className="text-muted">None yet</li>}
          </ul>
        </div>
      </div>
      <Button variant="ghost" className="mt-2" onClick={onOpen}>
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Responsibilities</div>
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Scorecard (7 days)</div>
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
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Working agreements</div>
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
