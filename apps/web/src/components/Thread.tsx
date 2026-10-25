import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import { Badge, Button, Collapse, cx, dt, inputCls, Json, Q } from './ui';

// Threads on every object with @mentions (FR-115, FR-116). Agent messages cite evidence.
export function Thread({ type, id, placeholder = 'Write a message — @Buyer, @Pilot, @Demand Planner, @AP Clerk' }: { type: string; id: string; placeholder?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['thread', type, id], queryFn: () => api<any>(`/threads/${type}/${id}`) });
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => post(`/threads/${type}/${id}/messages`, { body }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['thread', type, id] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) send.mutate();
  };
  return (
    <div className="space-y-3">
      <Q q={q}>
        {(t) => (
          <ul className="space-y-2">
            {t.messages.map((m: any) => (
              <li key={m.id} className={cx('rounded-lg border px-3 py-2 text-sm', m.authorType === 'agent' ? 'border-blue-100 bg-blue-50/50' : m.authorType === 'supplier' ? 'border-amber-100 bg-amber-50/50' : m.authorType === 'system' ? 'border-line bg-slate-50' : 'border-line bg-card')}>
                <div className="mb-0.5 flex items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{m.authorName}</span>
                  <Badge tone={m.authorType === 'agent' ? 'blue' : m.authorType === 'supplier' ? 'amber' : 'gray'}>{m.authorType}</Badge>
                  <span className="ml-auto">{dt(m.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
                {m.evidence?.length > 0 && (
                  <div className="mt-1">
                    <Collapse label={`Evidence (${m.evidence.length})`}>
                      {m.evidence.map((e: any, i: number) => (
                        <div key={i} className="mt-1">
                          <div className="text-xs font-medium">{e.label}</div>
                          <Json value={e.data} />
                        </div>
                      ))}
                    </Collapse>
                  </div>
                )}
              </li>
            ))}
            {!t.messages.length && <li className="text-sm text-muted">No messages yet.</li>}
            {t.questions
              .filter((x: any) => x.status === 'open')
              .map((x: any) => (
                <li key={x.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  Waiting for an answer: {x.text}{' '}
                  <Link className="text-accent underline" to="/inbox">
                    Answer in the Inbox
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Q>
      <form onSubmit={submit} className="flex gap-2">
        <input aria-label="Message" className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} maxLength={2000} />
        <Button type="submit" variant="primary" busy={send.isPending}>
          Post
        </Button>
      </form>
      {send.error && <div className="text-xs text-red-700">{(send.error as Error).message}</div>}
    </div>
  );
}
