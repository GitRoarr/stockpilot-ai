import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { Badge, Button, Card, dt, Empty, ErrorCard, Field, inputCls, Q, Status, Table, usd } from '../components/ui';

// Disputes and credit recovery (FR-086, FR-087).
export function DisputesPage() {
  const q = useQuery({ queryKey: ['disputes'], queryFn: () => api<any[]>('/disputes') });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Disputes</h1>
      <Card pad={false}>
        <Q q={q}>
          {(rows) =>
            rows.length ? (
              <Table head={['Dispute', 'Supplier', 'Invoice', 'Claimed', 'Credited', 'Status', 'Opened']}>
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">
                      <Link className="text-accent" to={`/disputes/${d.id}`}>
                        {d.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{d.supplier}</td>
                    <td className="px-3 py-2 font-mono">{d.invoice_number}</td>
                    <td className="px-3 py-2 font-mono">{usd(d.amount_claimed)}</td>
                    <td className="px-3 py-2 font-mono text-emerald-700">{d.amount_credited ? usd(d.amount_credited) : '—'}</td>
                    <td className="px-3 py-2">
                      <Status s={d.status} />
                    </td>
                    <td className="px-3 py-2 text-xs">{dt(d.created_at)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-4">
                <Empty>No disputes. AP Clerk opens one when an invoice has variances above the minimum.</Empty>
              </div>
            )
          }
        </Q>
      </Card>
    </div>
  );
}

export function DisputeDetailPage({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dispute', id], queryFn: () => api<any>(`/disputes/${id}`) });
  const refresh = () => qc.invalidateQueries();
  const send = useMutation({ mutationFn: () => post(`/disputes/${id}/send`), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => post(`/disputes/${id}/close`), onSuccess: refresh });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const credit = useMutation({ mutationFn: () => post(`/disputes/${id}/credit`, { amount: Number(amount), note: note || undefined }), onSuccess: refresh });
  const can = me.user.role !== 'staff';
  return (
    <Q q={q}>
      {(d) => {
        const link = d.emails.map((e: any) => e.text?.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)?.[0]).filter(Boolean).pop();
        return (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title={`${d.number} · ${d.supplier}`} subtitle={`Invoice ${d.invoiceNumber} · ${d.poNumber}`} actions={<Status s={d.status} />}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Facts (computed by code)</div>
                <Table head={['Type', 'Detail', 'Amount']}>
                  {d.variances.map((v: any) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2">
                        <Badge tone="red">{v.type.replace('_', ' ')}</Badge>
                      </td>
                      <td className="px-3 py-2">{v.description}</td>
                      <td className="px-3 py-2 text-right font-mono">{usd(v.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={2}>
                      Total claimed
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{usd(d.amount_claimed)}</td>
                  </tr>
                </Table>
                <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Email text <Badge tone={d.text_mode?.startsWith('gemini') ? 'green' : 'amber'}>{d.text_mode}</Badge>
                </div>
                <div className="mt-1 rounded-lg border border-line bg-slate-50 p-3 text-sm">
                  <div className="font-medium">{d.email_subject}</div>
                  <p className="mt-1 whitespace-pre-wrap">{d.email_body}</p>
                </div>
                {d.supplier_reply && <p className="mt-2 text-sm text-amber-800">Supplier reply (untrusted): “{d.supplier_reply}”</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {d.status === 'draft' && can && (
                    <Button variant="primary" busy={send.isPending} onClick={() => send.mutate()}>
                      Approve & send
                    </Button>
                  )}
                  {['credited', 'partially_credited', 'rejected'].includes(d.status) && can && <Button onClick={() => close.mutate()}>Close</Button>}
                </div>
                {(send.error || close.error) && <ErrorCard error={send.error ?? close.error} />}
              </Card>
              <Card title="Thread">
                <Thread type="dispute" id={d.id} />
              </Card>
            </div>
            <div className="space-y-4">
              {link && (
                <Card title="Supplier link">
                  <a className="break-all font-mono text-xs text-accent" href={link.replace(/^https?:\/\/[^/]+/, '')} target="_blank" rel="noreferrer">
                    {link}
                  </a>
                </Card>
              )}
              {['sent', 'acknowledged'].includes(d.status) && can && (
                <Card title="Record a credit note">
                  <div className="space-y-2">
                    <Field label="Amount credited (USD)">
                      <input className={inputCls} type="number" step="0.01" min={0} max={d.amount_claimed} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(d.amount_claimed)} />
                    </Field>
                    <Field label="Credit note reference">
                      <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <Button variant="primary" disabled={!amount} busy={credit.isPending} onClick={() => credit.mutate()}>
                      Record credit
                    </Button>
                    {credit.error && <ErrorCard error={credit.error} />}
                  </div>
                </Card>
              )}
              <Card title="Emails">
                <ul className="space-y-1 text-xs">
                  {d.emails.map((e: any) => (
                    <li key={e.id}>
                      {e.to_email} <Status s={e.status} />
                    </li>
                  ))}
                  {!d.emails.length && <li className="text-muted">Not sent yet</li>}
                </ul>
              </Card>
            </div>
          </div>
        );
      }}
    </Q>
  );
}
