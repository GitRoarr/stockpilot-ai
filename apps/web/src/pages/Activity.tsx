import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import { agentName, Badge, Button, Card, Collapse, cx, dt, Empty, ErrorCard, inputCls, Json, Q, Status, Table } from '../components/ui';

// Agent activity (FR-060), audit timeline (FR-099) and outbox (FR-090).
const TABS = ['runs', 'audit', 'outbox'] as const;

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'runs') as (typeof TABS)[number];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <div className="ml-auto flex gap-1 rounded-lg border border-line bg-card p-1 text-sm">
          {TABS.map((t) => (
            <button key={t} onClick={() => setParams({ tab: t })} className={cx('rounded-md px-3 py-1 capitalize', tab === t ? 'bg-blue-50 font-semibold text-accent' : 'text-slate-600')}>
              {t === 'runs' ? 'Agent runs' : t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'runs' && <Runs />}
      {tab === 'audit' && <Audit />}
      {tab === 'outbox' && <Outbox />}
    </div>
  );
}

function Runs() {
  const q = useQuery({ queryKey: ['runs'], queryFn: () => api<any[]>('/agent-runs'), refetchInterval: 15_000 });
  const [agent, setAgent] = useState('');
  return (
    <Card pad={false} title="Agent runs" actions={<select aria-label="Agent" className={cx(inputCls, 'w-40')} value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All agents</option>{['pilot', 'demand-planner', 'buyer', 'ap-clerk'].map((a) => <option key={a} value={a}>{agentName(a)}</option>)}</select>}>
      <Q q={q}>
        {(rows) => {
          const list = rows.filter((r) => !agent || r.agent_id === agent);
          if (!list.length) return <div className="p-4"><Empty>No runs yet.</Empty></div>;
          return (
            <Table head={['Started', 'Agent', 'Trigger', 'Goal', 'Mode', 'Steps', 'Status']}>
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs">
                    <Link className="text-accent" to={`/activity/runs/${r.id}`}>
                      {dt(r.started_at)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.parent_run_id && <span className="text-muted">↳ </span>}
                    {agentName(r.agent_id)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.trigger}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs" title={r.goal}>
                    {r.goal}
                  </td>
                  <td className="px-3 py-2">{r.mode === 'ai' ? <Badge tone="green">{r.model ?? 'AI'}</Badge> : <Badge tone="amber">rule-based ({r.fallback_reason})</Badge>}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.steps_used}/{r.tool_calls_used}
                  </td>
                  <td className="px-3 py-2">
                    <Status s={r.status} />
                  </td>
                </tr>
              ))}
            </Table>
          );
        }}
      </Q>
    </Card>
  );
}

export function RunDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['run', id], queryFn: () => api<any>(`/agent-runs/${id}`), refetchInterval: (query) => (['queued', 'running', 'waiting_for_children'].includes((query.state.data as any)?.status) ? 2000 : false) });
  const qc = useQueryClient();
  const cancel = useMutation({ mutationFn: () => post(`/agent-runs/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }) });
  return (
    <Q q={q}>
      {(r) => (
        <div className="space-y-4">
          <Card
            title={`${agentName(r.agentId)} · ${r.trigger}`}
            subtitle={`${dt(r.startedAt)}${r.endedAt ? ` → ${dt(r.endedAt)}` : ''}`}
            actions={
              <>
                {r.mode === 'ai' ? <Badge tone="green">AI · {r.model}</Badge> : <Badge tone="amber">rule-based ({r.fallbackReason})</Badge>}
                {r.externalText && <Badge tone="red" title="Triggered by text from outside the restaurant: reduced authority (FR-059)">external text</Badge>}
                <Status s={r.status} />
                {['queued', 'running', 'waiting_for_children', 'waiting_for_human'].includes(r.status) && (
                  <Button variant="danger" onClick={() => cancel.mutate()}>
                    Cancel
                  </Button>
                )}
              </>
            }
          >
            <p className="text-sm">{r.goal}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              <span>
                steps {r.stepsUsed} · tool calls {r.toolCallsUsed} · authority {r.authorityRole}
              </span>
              {r.taskId && (
                <Link className="text-accent" to={`/tasks/${r.taskId}`}>
                  Task →
                </Link>
              )}
              {r.parentRunId && (
                <Link className="text-accent" to={`/activity/runs/${r.parentRunId}`}>
                  Parent run →
                </Link>
              )}
            </div>
            {r.finalMessage && <div className="mt-3 rounded-lg bg-blue-50/60 p-3 text-sm">{r.finalMessage}</div>}
            {cancel.error && <ErrorCard error={cancel.error} />}
          </Card>
          {r.children.length > 0 && (
            <Card title="Delegated runs">
              <ul className="space-y-1 text-sm">
                {r.children.map((c: any) => (
                  <li key={c.id}>
                    <Link className="text-accent" to={`/activity/runs/${c.id}`}>
                      {agentName(c.agent_id)}
                    </Link>{' '}
                    — {c.goal} <Status s={c.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Trace" subtitle="Every model step and tool call, checkpointed">
            <ol className="space-y-2">
              {r.steps.map((s: any, i: number) => (
                <li key={i} className={cx('rounded-lg border p-2 text-sm', s.kind === 'model' ? 'border-blue-100' : 'border-line bg-slate-50/60')}>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="font-mono">#{s.stepNo}</span>
                    <Badge tone={s.kind === 'model' ? 'blue' : 'gray'}>{s.kind === 'model' ? (s.model?.mode === 'deterministic' ? 'playbook step' : 'model') : 'tool results'}</Badge>
                    {s.latencyMs !== null && <span>{s.latencyMs} ms</span>}
                    {s.tokensIn && (
                      <span>
                        {s.tokensIn}/{s.tokensOut} tokens
                      </span>
                    )}
                  </div>
                  {s.kind === 'model' && (
                    <>
                      {s.model?.text && <p className="mt-1">{s.model.text}</p>}
                      {(s.calls ?? []).map((c: any) => (
                        <div key={c.id} className="mt-1 font-mono text-xs">
                          → {c.name}({JSON.stringify(c.args)})
                        </div>
                      ))}
                    </>
                  )}
                  {s.kind === 'tools' &&
                    (s.results ?? []).map((res: any) => (
                      <div key={res.callId} className="mt-1">
                        <Collapse label={`${res.name} ${res.result?.error ? `— ${res.result.error}` : res.result?.status === 'pending_approval' ? '— proposal (needs approval)' : '— ok'}`}>
                          <Json value={res.result} />
                        </Collapse>
                      </div>
                    ))}
                </li>
              ))}
              {!r.steps.length && <li className="text-sm text-muted">Waiting to start…</li>}
            </ol>
          </Card>
          {r.actions.length > 0 && (
            <Card title="Actions and policy decisions" pad={false}>
              <Table head={['Tool', 'Summary', 'Decision', 'Rule', 'Status']}>
                {r.actions.map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-mono text-xs">{a.tool}</td>
                    <td className="px-3 py-2 text-xs">{a.summary}</td>
                    <td className="px-3 py-2 text-xs">{a.policy_decision.replace('_', ' ')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.decided_by_rule}</td>
                    <td className="px-3 py-2">
                      <Status s={a.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </Q>
  );
}

function Audit() {
  const [actor, setActor] = useState('');
  const q = useQuery({ queryKey: ['audit', actor], queryFn: () => api<any[]>(`/audit-events?limit=300${actor ? `&actor=${actor}` : ''}`) });
  return (
    <Card pad={false} title="Audit timeline" actions={<select aria-label="Actor" className={cx(inputCls, 'w-36')} value={actor} onChange={(e) => setActor(e.target.value)}><option value="">All actors</option>{['user', 'agent', 'system', 'supplier'].map((a) => <option key={a}>{a}</option>)}</select>}>
      <Q q={q}>
        {(rows) => (
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Details']}>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs">{dt(e.at)}</td>
                <td className="px-3 py-1.5 text-xs">
                  <Badge tone={e.actor_type === 'agent' ? 'blue' : e.actor_type === 'supplier' ? 'amber' : e.actor_type === 'user' ? 'green' : 'gray'}>{e.actor_type}</Badge> {e.actor_type === 'agent' ? agentName(e.actor_id) : ''}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-1.5 text-xs">{e.entity_type}</td>
                <td className="max-w-md truncate px-3 py-1.5 text-[11px] text-muted" title={JSON.stringify(e.meta ?? e.after)}>
                  {JSON.stringify(e.meta ?? e.after ?? '')}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </Card>
  );
}

function Outbox() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['emails'], queryFn: () => api<any[]>('/emails') });
  const resend = useMutation({ mutationFn: (id: string) => post(`/emails/${id}/resend`), onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card pad={false} title="Email outbox" subtitle="Brevo transactional email · not_configured = no BREVO_API_KEY (workflow continues)">
      <Q q={q}>
        {(rows) =>
          rows.length ? (
            <Table head={['When', 'Kind', 'To', 'Subject', 'Status', '']}>
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{dt(e.created_at)}</td>
                    <td className="px-3 py-2 text-xs">{e.kind}</td>
                    <td className="px-3 py-2 text-xs">{e.to_email}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs">{e.subject}</td>
                    <td className="px-3 py-2">
                      <Status s={e.status} /> {e.error && <span className="text-[11px] text-red-700">{e.error}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {open === e.id ? 'Hide' : 'View'}
                      </Button>
                      {['failed', 'not_configured'].includes(e.status) && (
                        <Button variant="ghost" onClick={() => resend.mutate(e.id)}>
                          Resend
                        </Button>
                      )}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-3 py-2">
                        <pre className="whitespace-pre-wrap text-xs">{e.text}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <Empty>No emails yet.</Empty>
            </div>
          )
        }
      </Q>
    </Card>
  );
}
