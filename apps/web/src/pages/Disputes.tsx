import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleDollarSign, ExternalLink, FileText, Mail, Scale, Send } from 'lucide-react';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Thread } from '../components/Thread';
import { useToast } from '../components/toast';
import { Badge, Button, Card, ConfirmDialog, cx, dt, Empty, ErrorCard, Field, inputCls, Kpi, PageHeader, Q, Status, Table, Tabs, usd } from '../components/ui';

// Disputes and credit recovery (FR-086, FR-087).
const OPEN = new Set(['draft', 'sent', 'acknowledged']);
const FILTERS = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
] as const;
type Filter = (typeof FILTERS)[number][0];

export function DisputesPage() {
  const q = useQuery({ queryKey: ['disputes'], queryFn: () => api<any[]>('/disputes') });
  const [filter, setFilter] = useState<Filter>('open');
  const rows = q.data ?? [];
  const open = rows.filter((d) => OPEN.has(d.status));
  const credited = rows.reduce((s, d) => s + (d.amount_credited ?? 0), 0);
  const claimedResolved = rows.filter((d) => !OPEN.has(d.status)).reduce((s, d) => s + d.amount_claimed, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Disputes" description="Invoice differences the AP Clerk found, the credit requested from each supplier, and what was recovered." />
      {q.data && (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card sm:grid-cols-3 [&>*]:bg-card">
          <Kpi icon={Scale} label="Open disputes" value={open.length} sub={`${usd(open.reduce((s, d) => s + d.amount_claimed, 0))} claimed, not yet credited`} tone={open.length ? 'amber' : undefined} />
          <Kpi icon={CircleDollarSign} label="Credits recovered" value={usd(credited)} sub="Counted as verified savings" tone={credited > 0 ? 'green' : undefined} to="/savings" />
          <Kpi icon={Check} label="Recovery rate" value={claimedResolved > 0 ? `${Math.round((credited / claimedResolved) * 100)}%` : '—'} sub="Credited ÷ claimed on resolved disputes" />
        </div>
      )}
      <Tabs label="Dispute status" value={filter} onChange={setFilter} options={FILTERS} counts={q.data ? { open: open.length, resolved: rows.length - open.length, all: rows.length } : undefined} />
      <Card pad={false}>
        <Q q={q}>
          {(rows) => {
            const list = rows.filter((d) => (filter === 'all' ? true : filter === 'open' ? OPEN.has(d.status) : !OPEN.has(d.status)));
            return list.length ? (
              <Table head={['Dispute', 'Supplier', 'Invoice', 'Claimed', 'Credited', 'Status', 'Opened']} align={['left', 'left', 'left', 'right', 'right', 'left', 'left']}>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 font-mono">
                      <Link className="font-medium text-accent hover:underline" to={`/disputes/${d.id}`}>
                        {d.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{d.supplier}</td>
                    <td className="px-3 py-2 font-mono">{d.invoice_number}</td>
                    <td className="px-3 py-2 text-right font-mono">{usd(d.amount_claimed)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{d.amount_credited ? usd(d.amount_credited) : '—'}</td>
                    <td className="px-3 py-2">
                      <Status s={d.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{dt(d.created_at)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-4">
                <Empty icon={Scale}>{filter === 'open' ? 'No open disputes.' : 'No disputes here.'} The AP Clerk opens one when an invoice has variances above the minimum.</Empty>
              </div>
            );
          }}
        </Q>
      </Card>
    </div>
  );
}

const STEPS = [
  ['draft', 'Drafted'],
  ['sent', 'Sent to supplier'],
  ['acknowledged', 'Supplier replied'],
  ['credited', 'Credited'],
  ['closed', 'Closed'],
] as const;
const stepIndex = (s: string) => (s === 'partially_credited' || s === 'rejected' ? 3 : STEPS.findIndex(([k]) => k === s));

const NEXT: Record<string, string> = {
  draft: 'Review the facts and the email text, then approve and send the credit request to the supplier.',
  sent: 'Waiting for the supplier. They can accept or dispute through the portal link; if they send a credit note by other means, record it here.',
  acknowledged: 'The supplier replied. Record the credit note when it arrives, or follow up in the thread.',
  credited: 'Credit recorded and counted in verified savings. Close the dispute when the credit note is reconciled.',
  partially_credited: 'Part of the claim was credited. Follow up on the remainder in the thread, or close the dispute.',
  rejected: 'The supplier rejected the claim. Check the evidence with the team, then close or re-open the conversation.',
  closed: 'Resolved — no further action.',
};

export function DisputeDetailPage({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['dispute', id], queryFn: () => api<any>(`/disputes/${id}`) });
  const refresh = () => qc.invalidateQueries();
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const send = useMutation({ mutationFn: () => post(`/disputes/${id}/send`), onSuccess: () => (refresh(), setConfirmSend(false), toast('success', 'Credit request sent')) });
  const close = useMutation({ mutationFn: () => post(`/disputes/${id}/close`), onSuccess: () => (refresh(), setConfirmClose(false), toast('info', 'Dispute closed')) });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const credit = useMutation({ mutationFn: () => post(`/disputes/${id}/credit`, { amount: Number(amount), note: note || undefined }), onSuccess: () => (refresh(), toast('success', `Credit of ${usd(Number(amount))} recorded`, 'Added to verified savings.')) });
  const can = me.user.role !== 'staff';
  return (
    <Q q={q}>
      {(d) => {
        const link = d.emails.map((e: any) => e.text?.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)?.[0]).filter(Boolean).pop();
        const at = stepIndex(d.status);
        const amountError = amount !== '' && (Number(amount) <= 0 || Number(amount) > d.amount_claimed) ? `Enter an amount between $0.01 and ${usd(d.amount_claimed)}` : undefined;
        return (
          <div className="space-y-4">
            <PageHeader
              crumbs={[{ label: 'Disputes', to: '/disputes' }, { label: d.number }]}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{d.number}</span> <span className="font-normal text-muted">·</span> {d.supplier} <Status s={d.status} />
                </span>
              }
              description={`Opened ${dt(d.created_at)} · claimed ${usd(d.amount_claimed)}${d.amount_credited ? ` · credited ${usd(d.amount_credited)}` : ''}`}
              actions={
                <>
                  {['credited', 'partially_credited', 'rejected'].includes(d.status) && can && (
                    <Button icon={Check} onClick={() => setConfirmClose(true)}>
                      Close dispute
                    </Button>
                  )}
                  {d.status === 'draft' && can && (
                    <Button variant="primary" icon={Send} onClick={() => setConfirmSend(true)}>
                      Approve & send
                    </Button>
                  )}
                </>
              }
            />

            <ol aria-label="Dispute progress" className="flex flex-wrap gap-x-1 gap-y-2 rounded-lg border border-line bg-card px-4 py-3 shadow-card">
              {STEPS.map(([k, label], i) => (
                <li key={k} className="flex items-center gap-1.5 text-xs">
                  <span className={cx('grid h-5 w-5 place-items-center rounded-full border text-[10px] font-semibold', i < at || d.status === 'closed' ? 'border-accent bg-accent text-on-accent' : i === at ? 'border-accent text-accent' : 'border-line-strong text-muted')}>{i < at || d.status === 'closed' ? <Check aria-hidden className="h-3 w-3" /> : i + 1}</span>
                  <span className={cx(i === at ? 'font-medium text-ink' : 'text-muted')} aria-current={i === at ? 'step' : undefined}>
                    {i === 3 && d.status === 'rejected' ? 'Rejected' : i === 3 && d.status === 'partially_credited' ? 'Partly credited' : label}
                  </span>
                  {i < STEPS.length - 1 && <span aria-hidden className="mx-1.5 h-px w-6 bg-line-strong" />}
                </li>
              ))}
            </ol>

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <ArrowRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b>Next step.</b> {NEXT[d.status]}
              </span>
            </div>
            {(send.error || close.error) && <ErrorCard error={send.error ?? close.error} />}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <Card title="Discrepancies" icon={Scale} subtitle="Facts computed by code from the order, receipt and invoice" pad={false}>
                  <Table head={['Type', 'Detail', 'Amount']} align={['left', 'left', 'right']}>
                    {d.variances.map((v: any) => (
                      <tr key={v.id}>
                        <td className="px-3 py-2">
                          <Badge tone="red">{v.type.replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-3 py-2">{v.description}</td>
                        <td className="px-3 py-2 text-right font-mono">{usd(v.amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-raised">
                      <td className="px-3 py-2 font-semibold" colSpan={2}>
                        Total claimed
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{usd(d.amount_claimed)}</td>
                    </tr>
                  </Table>
                </Card>
                <Card title="Credit request email" icon={Mail} actions={<Badge tone={d.text_mode?.startsWith('gemini') ? 'green' : 'amber'} title={d.text_mode?.startsWith('gemini') ? 'Written by the AP Clerk with Gemini; amounts are inserted by code' : 'Template text (no model available)'}>{d.text_mode}</Badge>}>
                  <div className="rounded-md border border-line bg-raised p-3 text-sm">
                    <div className="font-medium">{d.email_subject}</div>
                    <p className="mt-1 whitespace-pre-wrap">{d.email_body}</p>
                  </div>
                  {d.supplier_reply && <p className="mt-2 text-sm text-amber-800">Supplier reply (untrusted): “{d.supplier_reply}”</p>}
                </Card>
                <Card title="Thread">
                  <Thread type="dispute" id={d.id} />
                </Card>
              </div>
              <div className="min-w-0 space-y-4">
                <Card title="Evidence" icon={FileText}>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Invoice</dt>
                      <dd>
                        <Link className="font-mono text-accent hover:underline" to={`/receiving/invoices/${d.invoice_id}`}>
                          {d.invoiceNumber}
                        </Link>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Invoice total</dt>
                      <dd className="font-mono">{usd(d.invoiceTotal)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Purchase order</dt>
                      <dd>
                        {d.poId ? (
                          <Link className="font-mono text-accent hover:underline" to={`/orders/${d.poId}`}>
                            {d.poNumber}
                          </Link>
                        ) : (
                          (d.poNumber ?? '—')
                        )}
                      </dd>
                    </div>
                  </dl>
                </Card>
                {link && (
                  <Card title="Supplier link">
                    <a className="flex items-start gap-1 break-all font-mono text-xs text-accent hover:underline" href={link.replace(/^https?:\/\/[^/]+/, '')} target="_blank" rel="noreferrer">
                      {link}
                      <ExternalLink aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                    </a>
                  </Card>
                )}
                {['sent', 'acknowledged'].includes(d.status) && can && (
                  <Card title="Record a credit note" icon={CircleDollarSign}>
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!amountError && amount) credit.mutate();
                      }}
                    >
                      <Field label="Amount credited (USD)" error={amountError}>
                        <input className={inputCls} type="number" step="0.01" min={0} max={d.amount_claimed} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(d.amount_claimed)} />
                      </Field>
                      <Field label="Credit note reference">
                        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. CN-2041" />
                      </Field>
                      <Button type="submit" variant="primary" disabled={!amount || Boolean(amountError)} busy={credit.isPending}>
                        Record credit
                      </Button>
                      {credit.error && <ErrorCard error={credit.error} />}
                    </form>
                  </Card>
                )}
                <Card title="Emails">
                  <ul className="space-y-1.5 text-xs">
                    {d.emails.map((e: any) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-1.5">
                        {e.to_email} <Status s={e.status} /> <span className="text-muted">{dt(e.created_at)}</span>
                      </li>
                    ))}
                    {!d.emails.length && <li className="text-muted">Not sent yet</li>}
                  </ul>
                </Card>
              </div>
            </div>
            <ConfirmDialog
              open={confirmSend}
              title={`Send the credit request to ${d.supplier}?`}
              body={`The supplier receives the email above asking for a credit of ${usd(d.amount_claimed)}, with a link to accept or dispute it.`}
              confirmLabel="Send request"
              busy={send.isPending}
              onConfirm={() => send.mutate()}
              onClose={() => setConfirmSend(false)}
            />
            <ConfirmDialog open={confirmClose} title={`Close ${d.number}?`} body="The dispute is marked resolved. Recorded credits stay in verified savings." confirmLabel="Close dispute" busy={close.isPending} onConfirm={() => close.mutate()} onClose={() => setConfirmClose(false)} />
          </div>
        );
      }}
    </Q>
  );
}
