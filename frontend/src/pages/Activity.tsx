import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Flag, Loader2, XCircle } from 'lucide-react';
import { api, post } from '../api/client';
import { AgentAvatar } from '../components/AgentAvatar';
import { auditDetail, auditLabel, decisionLabel, describeCall, describeResult, emailKindLabel, entityLabel, ruleLabel, toolLabel, triggerLabel } from '../lib/agentTools';
import { agentName, Badge, Button, Card, Collapse, cx, dt, Empty, ErrorCard, fallbackText, inputCls, Json, ModeBadge, PageHeader, Q, Status, Table, Tabs } from '../components/ui';

// Agent activity (FR-060), audit timeline (FR-099) and outbox (FR-090).
const TABS = ['runs', 'audit', 'outbox'] as const;

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'runs') as (typeof TABS)[number];
  return (
    <div className="space-y-4">
      <PageHeader title="Activity" description="Every agent run step by step, the audit trail of business actions, and outgoing email." actions={<Tabs label="Activity view" value={tab} onChange={(t) => setParams({ tab: t })} options={[['runs', 'Agent runs'], ['audit', 'Audit'], ['outbox', 'Outbox']] as const} />} />
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
            <Table head={['Started', 'Agent', 'Started by', 'Goal', 'Mode', 'Steps / actions', 'Status']}>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs">
                    <Link className="text-accent" to={`/activity/runs/${r.id}`}>
                      {dt(r.started_at)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.parent_run_id && <span className="text-muted">↳ </span>}
                    {agentName(r.agent_id)}
                  </td>
                  <td className="px-3 py-2 text-xs" title={r.trigger}>{triggerLabel(r.trigger)}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs" title={r.goal}>
                    {r.goal}
                  </td>
                  <td className="px-3 py-2">{r.mode === 'ai' ? <Badge tone="green" title={r.model ?? undefined}>AI-written</Badge> : <Badge tone="gray" title={`Rules engine: ${fallbackText(r.fallback_reason)}`}>rules engine</Badge>}</td>
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
  const [view, setView] = useState<'summary' | 'technical'>(() => {
    try {
      return localStorage.getItem('sp-run-view') === 'technical' ? 'technical' : 'summary';
    } catch {
      return 'summary';
    }
  });
  const pickView = (v: 'summary' | 'technical') => {
    setView(v);
    try {
      localStorage.setItem('sp-run-view', v);
    } catch {
      /* preference not persisted */
    }
  };
  return (
    <Q q={q}>
      {(r) => (
        <div className="space-y-4">
          <Card
            title={`${agentName(r.agentId)} · ${triggerLabel(r.trigger)}`}
            subtitle={`${dt(r.startedAt)}${r.endedAt ? ` → ${dt(r.endedAt)}` : ''}`}
            actions={
              <>
                {r.mode === 'ai' ? <Badge tone="green" title={r.model ?? undefined}>AI-written</Badge> : <ModeBadge mode="rule_based" reason={r.fallbackReason} />}
                {r.externalText && <Badge tone="red" title="Triggered by text from outside the restaurant: reduced authority (FR-059)">outside text</Badge>}
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
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>
                {r.stepsUsed} {r.stepsUsed === 1 ? 'step' : 'steps'} · {r.toolCallsUsed} {r.toolCallsUsed === 1 ? 'action' : 'actions'} · {r.authorityRole === 'system' ? 'acting on its own (scheduled)' : `acting with ${ROLE[r.authorityRole] ?? r.authorityRole} permissions`}
              </span>
              {r.taskId && (
                <Link className="font-medium text-ink hover:underline" to={`/tasks/${r.taskId}`}>
                  Task →
                </Link>
              )}
              {r.parentRunId && (
                <Link className="font-medium text-ink hover:underline" to={`/activity/runs/${r.parentRunId}`}>
                  Parent run →
                </Link>
              )}
            </div>
            {r.finalMessage && (
              <div className="mt-3 flex gap-2 rounded-lg bg-raised p-3 text-sm">
                <Flag aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                {r.finalMessage}
              </div>
            )}
            {r.mode !== 'ai' && r.fallbackReason && r.fallbackReason !== 'no_api_key' && <p className="mt-2 text-xs text-muted">The rules engine ran this because {fallbackText(r.fallbackReason)}. The figures are the same; only the wording is simpler.</p>}
            {cancel.error && <ErrorCard error={cancel.error} />}
          </Card>
          {r.children.length > 0 && (
            <Card title="Delegated to teammates">
              <ul className="space-y-2.5 text-sm">
                {r.children.map((c: any) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <AgentAvatar id={c.agent_id} />
                    <span className="min-w-0 flex-1">
                      <Link className="font-medium hover:underline" to={`/activity/runs/${c.id}`}>
                        {agentName(c.agent_id)}
                      </Link>
                      <span className="text-muted"> — {c.goal}</span>
                    </span>
                    <Status s={c.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="What happened" subtitle={view === 'summary' ? 'Each step the agent took and its result' : 'Raw model steps and tool calls, as checkpointed'} actions={<Tabs label="Trace view" value={view} onChange={pickView} options={VIEWS} />}>
            {view === 'summary' ? <TraceSummary steps={r.steps} /> : <TraceTechnical steps={r.steps} />}
          </Card>
          {r.actions.length > 0 && (
            <Card title="Actions and approvals" subtitle="Everything that changes data or contacts a supplier passes the autonomy policy" pad={false}>
              <Table head={['Action', 'What', 'Decision', 'Why', 'Status']}>
                {r.actions.map((a: any) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-medium" title={a.tool}>
                      {toolLabel(a.tool)}
                    </td>
                    <td className="px-3 py-2 text-xs">{a.summary}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {decisionLabel(a.policy_decision)}
                      {a.policy_decision === 'requires_approval' && a.required_role ? ` (${ROLE[a.required_role] ?? a.required_role})` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted" title={a.decided_by_rule}>
                      {ruleLabel(a.decided_by_rule)}
                    </td>
                    <td className="px-3 py-2">
                      <Status s={a.status === 'proposed' ? 'pending_approval' : a.status} />
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

const ROLE: Record<string, string> = { owner: 'Owner', chef: 'Chef', staff: 'Staff' };
const VIEWS = [
  ['summary', 'Summary'],
  ['technical', 'Technical details'],
] as const;

type Step = { stepNo: number; kind: 'model' | 'tools'; model: any; calls: any[] | null; results: any[] | null; latencyMs: number | null; tokensIn: number | null; tokensOut: number | null };

/** Plain-language timeline: each step's decision paired with the results of the calls it made. */
function TraceSummary({ steps }: { steps: Step[] }) {
  if (!steps.length) return <p className="text-sm text-muted">Waiting to start…</p>;
  const nos = [...new Set(steps.map((s) => s.stepNo))];
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
      {nos.map((no) => {
        const decision = steps.find((s) => s.stepNo === no && s.kind === 'model');
        const tools = steps.find((s) => s.stepNo === no && s.kind === 'tools');
        const calls = decision?.calls ?? [];
        const results = tools?.results ?? [];
        const final = !calls.length && decision?.model?.text;
        return (
          <li key={no} className="relative flex gap-3">
            <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card text-[11px] font-semibold text-muted ring-1 ring-line">{no}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              {final ? (
                <p className="text-sm font-medium">{decision.model.text}</p>
              ) : (
                <ul className="space-y-2">
                  {calls.map((c: any) => {
                    const res = results.find((x: any) => x.callId === c.id) ?? results.find((x: any) => x.name === c.name);
                    const out = res ? describeResult(c.name, res.result) : null;
                    const Ico = !out ? Loader2 : out.tone === 'error' ? XCircle : out.tone === 'wait' ? Clock : CheckCircle2;
                    return (
                      <li key={c.id ?? c.name}>
                        <div className="text-sm font-medium">{describeCall(c.name, c.args)}</div>
                        <div className={cx('mt-0.5 flex gap-1.5 text-[13px]', !out ? 'text-muted' : out.tone === 'error' ? 'text-red-700' : out.tone === 'wait' ? 'text-amber-800' : 'text-muted')}>
                          <Ico aria-hidden className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', !out && 'animate-spin', out?.tone === 'ok' && 'text-emerald-600')} />
                          <span>{out ? out.text : 'In progress…'}</span>
                        </div>
                      </li>
                    );
                  })}
                  {decision?.model?.text && <li className="text-[13px] text-muted">{decision.model.text}</li>}
                </ul>
              )}
              {tools?.latencyMs ? <div className="mt-1 text-[11px] text-muted">{tools.latencyMs} ms</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The original raw trace: model output, tool calls with arguments, and full tool results as JSON. */
function TraceTechnical({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
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
      {!steps.length && <li className="text-sm text-muted">Waiting to start…</li>}
    </ol>
  );
}

function Audit() {
  const [actor, setActor] = useState('');
  const q = useQuery({ queryKey: ['audit', actor], queryFn: () => api<any[]>(`/audit-events?limit=300${actor ? `&actor=${actor}` : ''}`) });
  return (
    <Card pad={false} title="Audit timeline" actions={<select aria-label="Actor" className={cx(inputCls, 'w-36')} value={actor} onChange={(e) => setActor(e.target.value)}><option value="">All actors</option>{['user', 'agent', 'system', 'supplier'].map((a) => <option key={a}>{a}</option>)}</select>}>
      <Q q={q}>
        {(rows) => (
          <Table head={['When', 'Who', 'What happened', 'Record', 'Details']}>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs">{dt(e.at)}</td>
                <td className="px-3 py-1.5 text-xs">
                  <Badge tone={e.actor_type === 'agent' ? 'blue' : e.actor_type === 'supplier' ? 'amber' : e.actor_type === 'user' ? 'green' : 'gray'}>{e.actor_type === 'user' ? 'person' : e.actor_type}</Badge> {e.actor_type === 'agent' ? agentName(e.actor_id) : ''}
                </td>
                <td className="px-3 py-1.5 text-xs font-medium" title={e.action}>
                  {auditLabel(e.action)}
                </td>
                <td className="px-3 py-1.5 text-xs">{entityLabel(e.entity_type)}</td>
                <td className="max-w-md truncate px-3 py-1.5 text-xs text-muted" title={JSON.stringify(e.meta ?? e.after ?? '')}>
                  {auditDetail(e.meta ?? e.after)}
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
    <Card pad={false} title="Email outbox" subtitle="Emails to suppliers and the team. “Not configured” means no email key is set — the workflow continues with portal links.">
      <Q q={q}>
        {(rows) =>
          rows.length ? (
            <Table head={['When', 'Type', 'To', 'Subject', 'Status', '']}>
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{dt(e.created_at)}</td>
                    <td className="px-3 py-2 text-xs" title={e.kind}>
                      {emailKindLabel(e.kind)}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.to_email}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs">{e.subject}</td>
                    <td className="px-3 py-2">
                      <Status s={e.status} /> {e.error && <span className="text-[11px] text-red-700">{e.error}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className="inline-flex gap-4">
                      <Button variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {open === e.id ? 'Hide' : 'View'}
                      </Button>
                      {['failed', 'not_configured'].includes(e.status) && (
                        <Button variant="ghost" onClick={() => resend.mutate(e.id)}>
                          Resend
                        </Button>
                      )}
                      </span>
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
