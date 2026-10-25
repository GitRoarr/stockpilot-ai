import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../api/client';
import { Thread } from '../components/Thread';
import { agentName, Badge, Button, Card, dt, ErrorCard, Field, inputCls, Json, Modal, Q, Status } from '../components/ui';

// Shared task board (FR-113 – FR-115): humans and agents; assigning to an agent starts a run.
const COLS = ['todo', 'in_progress', 'waiting', 'blocked', 'done'] as const;

function assignee(t: any) {
  if (t.assignee_type === 'agent') return <Badge tone="blue">{agentName(t.assignee_id)}</Badge>;
  if (t.assignee_type === 'user') return <Badge>human</Badge>;
  return <Badge>unassigned</Badge>;
}

export function TasksPage() {
  const q = useQuery({ queryKey: ['tasks'], queryFn: () => api<any[]>('/tasks') });
  const [create, setCreate] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Button variant="primary" className="ml-auto" onClick={() => setCreate(true)}>
          New task
        </Button>
      </div>
      <Q q={q}>
        {(tasks) => (
          <div className="grid gap-3 md:grid-cols-5">
            {COLS.map((c) => {
              const items = tasks.filter((t) => t.status === c).slice(0, 40);
              return (
                <div key={c} className="rounded-xl border border-line bg-slate-50/60 p-2">
                  <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
                    {c.replace('_', ' ')} <span className="ml-auto">{tasks.filter((t) => t.status === c).length}</span>
                  </div>
                  <ul className="space-y-2">
                    {items.map((t) => (
                      <li key={t.id}>
                        <Link to={`/tasks/${t.id}`} className="block rounded-lg border border-line bg-card p-2 text-sm hover:border-accent">
                          <div className="line-clamp-2 font-medium">{t.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                            {assignee(t)}
                            {t.parent_id && <Badge tone="violet">delegated</Badge>}
                            <span className="ml-auto">{dt(t.updated_at)}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                    {!items.length && <li className="px-1 text-xs text-muted">—</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Q>
      {create && <NewTask onClose={() => setCreate(false)} />}
    </div>
  );
}

function NewTask({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
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
          <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title={t.title} actions={<Status s={t.status} />}>
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
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Result</div>
                  <p className="text-sm">{t.result.message ?? ''}</p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {t.status !== 'done' && <Button onClick={() => upd.mutate('done')}>Mark done</Button>}
                {t.status !== 'cancelled' && t.status !== 'done' && <Button variant="danger" onClick={() => upd.mutate('cancelled')}>Cancel</Button>}
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
                    <Status s={r.status} /> {r.mode === 'deterministic' && <Badge tone="amber">rule-based</Badge>}
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
      )}
    </Q>
  );
}
