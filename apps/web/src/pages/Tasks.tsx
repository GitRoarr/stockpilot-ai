import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../api/client';
import { Thread } from '../components/Thread';
import { CalendarDays, ListChecks, Plus, User } from 'lucide-react';
import { AgentAvatar } from '../components/AgentAvatar';
import { useToast } from '../components/toast';
import { agentName, Badge, Button, Card, cx, dt, Empty, ErrorCard, Field, inputCls, Json, Modal, PageHeader, Q, SearchInput, Status, Table, Tabs } from '../components/ui';

// Shared task board (FR-113 – FR-115): humans and agents; assigning to an agent starts a run.
const COLS = ['todo', 'in_progress', 'waiting', 'blocked', 'done'] as const;
const COL_LABEL: Record<(typeof COLS)[number], string> = { todo: 'To do', in_progress: 'In progress', waiting: 'Waiting', blocked: 'Blocked', done: 'Done' };
const LINKED: Record<string, string> = { purchase_order: 'order', invoice: 'invoice', dispute: 'dispute' };

function TaskCard({ t }: { t: any }) {
  return (
    <Link to={`/tasks/${t.id}`} className="block rounded-xl border border-line bg-card p-3.5 shadow-card transition-colors hover:border-line-strong">
      {(t.parent_id || LINKED[t.linked_type]) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {t.parent_id && <Badge tone="violet">delegated</Badge>}
          {LINKED[t.linked_type] && <Badge tone="blue">{LINKED[t.linked_type]}</Badge>}
        </div>
      )}
      <div className="line-clamp-2 text-sm font-semibold leading-snug">{t.title}</div>
      {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          <CalendarDays aria-hidden className="h-3.5 w-3.5" />
          {t.due_at ? `Due ${dt(t.due_at)}` : dt(t.updated_at)}
        </span>
        <span className="ml-auto" title={t.assignee_type === 'agent' ? agentName(t.assignee_id) : t.assignee_type === 'user' ? 'Person' : 'Unassigned'}>
          {t.assignee_type === 'agent' ? (
            <AgentAvatar id={t.assignee_id} />
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-raised text-muted ring-1 ring-line">
              <User aria-hidden className="h-3.5 w-3.5" />
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

function assignee(t: any) {
  if (t.assignee_type === 'agent') return <Badge tone="blue">{agentName(t.assignee_id)}</Badge>;
  if (t.assignee_type === 'user') return <Badge>person</Badge>;
  return <Badge>unassigned</Badge>;
}

const VIEWS = [
  ['board', 'Board'],
  ['list', 'List'],
] as const;
const WHO = [
  ['all', 'Everyone'],
  ['agents', 'AI agents'],
  ['humans', 'People'],
  ['pilot', 'Pilot'],
  ['demand-planner', 'Demand Planner'],
  ['buyer', 'Buyer'],
  ['ap-clerk', 'AP Clerk'],
] as const;

export function TasksPage() {
  const q = useQuery({ queryKey: ['tasks'], queryFn: () => api<any[]>('/tasks') });
  const [create, setCreate] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [who, setWho] = useState<(typeof WHO)[number][0]>('all');
  const [search, setSearch] = useState('');
  const [showDone, setShowDone] = useState(true);
  const keep = (t: any) =>
    (who === 'all' || (who === 'agents' ? t.assignee_type === 'agent' : who === 'humans' ? t.assignee_type !== 'agent' : t.assignee_id === who)) &&
    (!search || t.title.toLowerCase().includes(search.toLowerCase())) &&
    (showDone || t.status !== 'done');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        description="Shared work between people and agents. Assigning a task to an agent starts a run."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>
            New task
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label="View" value={view} onChange={setView} options={VIEWS} />
        <select aria-label="Assignee" className={cx(inputCls.replace('w-full ', ''), 'w-auto')} value={who} onChange={(e) => setWho(e.target.value as 'all')}>
          {WHO.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" className="accent-[var(--foreground)]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
        </label>
        <SearchInput className="ml-auto w-full sm:w-56" value={search} onChange={setSearch} placeholder="Search tasks…" label="Search tasks" />
      </div>
      <Q q={q}>
        {(all) => {
          const tasks = all.filter(keep);
          if (!all.length)
            return (
              <Empty icon={ListChecks} title="No tasks yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>New task</Button>}>
                Tasks appear when the morning plan runs, when agents delegate work, or when you create one.
              </Empty>
            );
          if (view === 'list')
            return (
              <Card pad={false}>
                {tasks.length ? (
                  <Table head={['Task', 'Assignee', 'Status', 'Due', 'Updated']}>
                    {tasks.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2">
                          <Link className="font-medium hover:underline" to={`/tasks/${t.id}`}>
                            {t.title}
                          </Link>
                          {t.parent_id && (
                            <span className="ml-1.5">
                              <Badge tone="violet">delegated</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{assignee(t)}</td>
                        <td className="px-3 py-2">
                          <Status s={t.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{t.due_at ? dt(t.due_at) : <span className="text-muted">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{dt(t.updated_at)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="p-4 text-sm text-muted">No tasks match these filters.</p>
                )}
              </Card>
            );
          return (
            <div className="-mx-1 grid auto-cols-[minmax(272px,1fr)] grid-flow-col items-start gap-4 overflow-x-auto px-1 pb-2">
              {COLS.filter((c) => showDone || c !== 'done').map((c) => {
                const col = tasks.filter((t) => t.status === c);
                return (
                  <section key={c} aria-label={c.replace('_', ' ')} className="flex min-w-0 flex-col rounded-2xl bg-raised p-3">
                    <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold">
                      {COL_LABEL[c]}
                      <span className="ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-card px-1.5 text-xs font-semibold tabular-nums text-muted ring-1 ring-line">{col.length}</span>
                    </h2>
                    <ul className="space-y-2.5">
                      {col.slice(0, 40).map((t) => (
                        <li key={t.id}>
                          <TaskCard t={t} />
                        </li>
                      ))}
                      {!col.length && <li className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">No tasks</li>}
                    </ul>
                  </section>
                );
              })}
            </div>
          );
        }}
      </Q>
      {create && <NewTask onClose={() => setCreate(false)} />}
    </div>
  );
}

function NewTask({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [who, setWho] = useState('agent:buyer');
  const m = useMutation({
    mutationFn: () => {
      const [type, id] = who.split(':');
      return post('/tasks', { title, description: description || undefined, assigneeType: type, assigneeId: id || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast('success', 'Task created', who.startsWith('agent:') ? `${agentName(who.split(':')[1])} starts working on it.` : undefined);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open onClose={onClose} title="New task">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required />
        </Field>
        <Field label="Details">
          <textarea className={cx(inputCls, "h-auto py-2")} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Assign to" hint="Assigning to an agent starts a run with your role as the authority ceiling">
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="agent:pilot">Pilot</option>
            <option value="agent:demand-planner">Demand Planner</option>
            <option value="agent:buyer">Buyer</option>
            <option value="agent:ap-clerk">AP Clerk</option>
            <option value="none:">Unassigned (human)</option>
          </select>
        </Field>
        {m.error && <ErrorCard error={m.error} />}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={m.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['task', id], queryFn: () => api<any>(`/tasks/${id}`) });
  const upd = useMutation({ mutationFn: (status: string) => patch(`/tasks/${id}`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }) });
  return (
    <Q q={q}>
      {(t) => (
        <div className="space-y-4">
        <PageHeader crumbs={[{ label: 'Tasks', to: '/tasks' }, { label: t.title }]} title={t.title} description={`Created ${dt(t.created_at)} · updated ${dt(t.updated_at)}${t.due_at ? ` · due ${dt(t.due_at)}` : ''}`} actions={<Status s={t.status} />} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <Card title="Details">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {assignee(t)} {t.parent_id && <Link className="text-accent" to={`/tasks/${t.parent_id}`}>Parent task</Link>}
                {t.linked_type === 'purchase_order' && <Link className="text-accent" to={`/orders/${t.linked_id}`}>Linked PO</Link>}
                {t.linked_type === 'invoice' && <Link className="text-accent" to={`/receiving/invoices/${t.linked_id}`}>Linked invoice</Link>}
                {t.linked_type === 'dispute' && <Link className="text-accent" to={`/disputes/${t.linked_id}`}>Linked dispute</Link>}
                <span className="ml-auto text-xs text-muted">created {dt(t.created_at)}</span>
              </div>
              {t.description && <p className="mt-2 text-sm">{t.description}</p>}
              {t.result && (
                <div className="mt-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Result</div>
                  <p className="text-sm">{t.result.message ?? ''}</p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {t.status !== 'done' && (
                  <Button variant="primary" busy={upd.isPending && upd.variables === 'done'} onClick={() => upd.mutate('done')}>
                    Mark done
                  </Button>
                )}
                {t.status !== 'cancelled' && t.status !== 'done' && (
                  <Button variant="danger" busy={upd.isPending && upd.variables === 'cancelled'} onClick={() => upd.mutate('cancelled')}>
                    Cancel task
                  </Button>
                )}
              </div>
            </Card>
            <Card title="Thread">
              <Thread type="task" id={t.id} />
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Delegated sub-tasks">
              <ul className="space-y-1 text-sm">
                {t.children.map((c: any) => (
                  <li key={c.id}>
                    <Link className="hover:underline" to={`/tasks/${c.id}`}>
                      {c.title}
                    </Link>{' '}
                    <Badge tone="blue">{agentName(c.assignee_id)}</Badge> <Status s={c.status} />
                  </li>
                ))}
                {!t.children.length && <li className="text-muted">None</li>}
              </ul>
            </Card>
            <Card title="Agent runs">
              <ul className="space-y-1 text-sm">
                {t.runs.map((r: any) => (
                  <li key={r.id}>
                    <Link className="hover:underline" to={`/activity/runs/${r.id}`}>
                      {agentName(r.agent_id)} · {dt(r.started_at)}
                    </Link>{' '}
                    <Status s={r.status} /> {r.mode === 'deterministic' && <Badge>rules engine</Badge>}
                  </li>
                ))}
                {!t.runs.length && <li className="text-muted">None</li>}
              </ul>
            </Card>
            {t.result && (
              <Card title="Raw result">
                <Json value={t.result} />
              </Card>
            )}
          </div>
        </div>
        </div>
      )}
    </Q>
  );
}
