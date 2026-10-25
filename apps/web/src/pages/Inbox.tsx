import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bell, Check, CheckCheck, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, ClipboardCheck, Clock, ExternalLink, FileSignature, History, Lock, PackageCheck, PiggyBank, ShieldCheck, ShoppingCart, TrendingDown, X, type LucideIcon } from 'lucide-react';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { agentName, ago, Badge, Button, ConfirmDialog, cx, dt, Empty, ErrorCard, Field, Initials, inputCls, Modal, num, PageHeader, Q, SearchInput, Status, Tabs, usd } from '../components/ui';
import { AgentAvatar } from '../components/AgentAvatar';

// Inbox (FR-068, FR-117): everything that needs a human, plus what was decided and what suppliers said.
const TABS = [
  ['pending', 'Needs you'],
  ['approvals', 'Approvals'],
  ['questions', 'Questions'],
  ['rules', 'Rules'],
  ['suppliers', 'Supplier updates'],
  ['notifications', 'Notifications'],
  ['completed', 'Completed'],
] as const;
type Tab = (typeof TABS)[number][0];
// Actions that contact a supplier get an explicit confirmation step.
const SENDS = new Set(['send_purchase_order', 'send_dispute_email', 'send_supplier_followup']);

const matches = (q: string, ...fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

const TOOL_LABEL: Record<string, string> = {
  send_purchase_order: 'Send purchase order',
  send_dispute_email: 'Send dispute email',
  send_supplier_followup: 'Follow up with supplier',
};
const toolLabel = (t: string) => TOOL_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');

export function InboxPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<any[]>('/notifications') });
  const [tab, setTab] = useState<Tab>('pending');
  const [search, setSearch] = useState('');
  const [expandAll, setExpandAll] = useState(false);
  const d = q.data;
  const counts = d && {
    pending: d.counts.proposals + d.counts.questions + d.counts.agreements,
    approvals: d.counts.proposals,
    questions: d.counts.questions,
    rules: d.counts.agreements,
    suppliers: d.supplierUpdates.length,
    notifications: (notes.data ?? []).filter((n) => !n.read_at).length,
    completed: d.completed.length,
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Inbox" description="Decisions your AI team needs from you, supplier updates and notifications, and what has already been decided." />
      {d && <Summary d={d} />}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label="Inbox category" value={tab} onChange={setTab} options={TABS} counts={counts ?? undefined} />
        <SearchInput className="ml-auto w-full sm:w-64" value={search} onChange={setSearch} placeholder="Search supplier, order, agent…" label="Search the inbox" />
      </div>
      <Q q={q}>
        {(d) => {
          const questions = d.questions.filter((x: any) => matches(search, x.text, x.agentName));
          const proposals = d.proposals.filter((p: any) => matches(search, p.summary, p.agentName, p.tool, p.purchaseOrder?.supplier, p.purchaseOrder?.number));
          const agreements = d.agreements.filter((a: any) => matches(search, a.rationale, a.type, agentName(a.agentId)));
          const show = (t: Tab) => tab === t || (tab === 'pending' && ['approvals', 'questions', 'rules'].includes(t));
          if (tab === 'notifications') return <Notifications rows={(notes.data ?? []).filter((n) => matches(search, n.title, n.body))} />;
          if (tab === 'suppliers') return <SupplierUpdates rows={d.supplierUpdates.filter((u: any) => matches(search, u.supplier, u.number))} />;
          if (tab === 'completed') return <Completed rows={d.completed.filter((c: any) => matches(search, c.summary, c.agentName, c.tool, c.approverName))} />;
          const none = (show('questions') ? questions.length : 0) + (show('approvals') ? proposals.length : 0) + (show('rules') ? agreements.length : 0) === 0;
          const withLines = proposals.some((p: any) => p.lines?.length);
          return (
            <div className="space-y-6">
              {none && (
                <Empty icon={ClipboardCheck} title={search ? 'No matches' : 'You are all caught up'}>
                  {search ? 'Nothing pending matches your search.' : 'Nothing is waiting for a decision. New approvals appear here when an agent proposes an order, a dispute or a rule.'}
                </Empty>
              )}
              {show('questions') && questions.length > 0 && (
                <Group title="Questions from the team" hint="The agent's run is paused until you answer" icon={CircleHelp} count={questions.length}>
                  {questions.map((x: any) => (
                    <Question key={x.id} x={x} />
                  ))}
                </Group>
              )}
              {show('approvals') && proposals.length > 0 && (
                <Group
                  title="Approvals"
                  hint="Agents propose; the autonomy policy decides what needs you"
                  icon={ShieldCheck}
                  count={proposals.length}
                  actions={
                    withLines && (
                      <Button size="sm" variant="subtle" icon={expandAll ? ChevronsDownUp : ChevronsUpDown} onClick={() => setExpandAll(!expandAll)}>
                        {expandAll ? 'Collapse all' : 'Expand all'}
                      </Button>
                    )
                  }
                >
                  {proposals.map((p: any) => (
                    <Proposal key={p.id} p={p} me={me} expandAll={expandAll} />
                  ))}
                </Group>
              )}
              {show('rules') && agreements.length > 0 && (
                <Group title="Working agreements proposed" hint="Standing rules the team will follow — Owner approval required" icon={FileSignature} count={agreements.length}>
                  {agreements.map((a: any) => (
                    <Agreement key={a.id} a={a} me={me} />
                  ))}
                </Group>
              )}
            </div>
          );
        }}
      </Q>
    </div>
  );
}

/** Totals across everything waiting for a decision (unfiltered, straight from the inbox API). */
function Summary({ d }: { d: any }) {
  const orders = d.proposals.filter((p: any) => p.purchaseOrder);
  const value = orders.reduce((s: number, p: any) => s + (p.purchaseOrder.total ?? 0), 0);
  const saving = orders.reduce((s: number, p: any) => s + (p.purchaseOrder.saving ?? 0), 0);
  const oldest = d.proposals.reduce((o: string | null, p: any) => (!o || p.createdAt < o ? p.createdAt : o), null);
  const items: [string, string, LucideIcon, string, string?][] = [
    ['Awaiting approval', String(d.counts.proposals), ShieldCheck, 'bg-amber-50 text-amber-700', oldest ? `Oldest ${ago(oldest)}` : 'Nothing waiting'],
    ['Order value', usd(value), ShoppingCart, 'bg-blue-50 text-blue-700', `${orders.length} purchase order${orders.length === 1 ? '' : 's'}`],
    ['Savings on approval', usd(saving), PiggyBank, 'bg-emerald-50 text-emerald-700', 'vs preferred-supplier prices'],
    ['Open questions', String(d.counts.questions), CircleHelp, 'bg-violet-50 text-violet-700', d.counts.questions ? 'A run is paused' : 'No runs blocked'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {items.map(([label, value, Ico, chip, sub]) => (
        <div key={label} className="flex items-start gap-3 rounded-2xl border border-line bg-card p-3.5 shadow-card sm:p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-muted">{label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums tracking-tight sm:text-2xl">{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
          </div>
          <span className={cx('hidden h-10 w-10 shrink-0 place-items-center rounded-lg sm:grid', chip)}>
            <Ico aria-hidden className="h-5 w-5" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Group({ title, hint, icon: Ico, count, actions, children }: { title: string; hint: string; icon: LucideIcon; count: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Ico aria-hidden className="h-4 w-4 text-muted" />
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-raised px-1.5 text-[11px] font-semibold tabular-nums text-muted ring-1 ring-line">{count}</span>
        <span className="text-[13px] text-muted">{hint}</span>
        {actions && <span className="ml-auto">{actions}</span>}
      </header>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

const cardCls = 'overflow-hidden rounded-2xl border border-line bg-card shadow-card';

function Question({ x }: { x: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (answer: string) => post(`/questions/${x.id}/answer`, { answer }),
    onSuccess: (_r, answer) => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      toast('success', `Answered “${answer}”`, `${x.agentName} resumes its run.`);
    },
  });
  return (
    <li className={cardCls}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <AgentAvatar id={x.agentId} size="md" />
          <span className="font-semibold text-ink">{x.agentName}</span> asks
          <Badge tone="red">High · blocks a run</Badge>
          <span className="ml-auto flex items-center gap-1 text-xs">
            <Clock aria-hidden className="h-3.5 w-3.5" />
            Answer by {dt(x.deadline)}
          </span>
        </div>
        <div className="mt-3 text-[15px] font-semibold leading-snug">{x.text}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {x.options.map((o: string) => (
            <Button key={o} variant={o === x.recommended ? 'primary' : 'secondary'} busy={m.isPending && m.variables === o} onClick={() => m.mutate(o)}>
              {o}
              {o === x.recommended && ' (recommended)'}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">If unanswered it is {x.actionId ? 'escalated' : 'escalated or the default is used'}.</p>
        {m.error && (
          <div className="mt-2">
            <ErrorCard error={m.error} />
          </div>
        )}
      </div>
      <footer className="flex items-center border-t border-line bg-raised/50 px-4 py-2.5 sm:px-5">
        <Link className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium hover:underline" to={`/activity/runs/${x.runId}`}>
          See the run <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </footer>
    </li>
  );
}

function Proposal({ p, me, expandAll }: { p: any; me: Me; expandAll: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reject, setReject] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(expandAll);
  useEffect(() => setOpen(expandAll), [expandAll]);
  const linesId = useId();
  const sends = SENDS.has(p.tool);
  const approve = useMutation({
    mutationFn: () => post(`/actions/${p.id}/approve`),
    onSuccess: () => {
      setConfirm(false);
      qc.invalidateQueries();
      toast('success', 'Approved', p.summary);
    },
    onError: (e) => {
      setConfirm(false);
      toast('error', 'Approval failed', (e as Error).message);
    },
  });
  const high = p.decidedByRule === 'approval_limit' || p.decidedByRule === 'external_text' || p.args?.flagged;
  const po = p.purchaseOrder;
  const lines: any[] = p.lines ?? [];
  const savingPct = po && po.saving > 0 && po.baseline_total > 0 ? (po.saving / po.baseline_total) * 100 : null;
  const preview = lines.slice(0, 3).map((l) => l.ingredient).join(', ') + (lines.length > 3 ? ` +${lines.length - 3} more` : '');
  return (
    <li className={cx(cardCls, high && 'border-l-4 border-l-red-500')}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="flex min-w-[15rem] flex-1 items-start gap-3">
            {po ? <Initials name={po.supplier} /> : <AgentAvatar id={p.agentId} size="md" />}
            <div className="min-w-0">
              {po ? (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link className="font-mono text-[13px] font-semibold hover:underline" to={`/orders/${po.id}`}>
                    {po.number}
                  </Link>
                  <span className="text-base font-semibold">{po.supplier}</span>
                </div>
              ) : (
                <div className="text-[15px] font-semibold leading-snug">{p.summary}</div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
                Proposed by <span className="font-medium text-ink">{p.agentName ?? agentName(p.agentId)}</span>
                <span aria-hidden>·</span>
                <span title={dt(p.createdAt)}>{ago(p.createdAt)}</span>
                {p.requiredRole && (
                  <>
                    <span aria-hidden>·</span> needs {p.requiredRole}
                  </>
                )}
              </div>
            </div>
          </div>
          {po && (
            <div className="pl-[52px] sm:pl-0 sm:text-right">
              <div className="text-2xl font-bold tabular-nums tracking-tight">{usd(po.total)}</div>
              {po.saving > 0 ? (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700">
                  <TrendingDown aria-hidden className="h-3.5 w-3.5" />
                  saves {usd(po.saving)}
                  {savingPct !== null && <span className="text-muted">({num(savingPct)}% vs {usd(po.baseline_total)})</span>}
                </div>
              ) : (
                <div className="mt-0.5 text-[13px] text-muted">Preferred-supplier price</div>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="gray" title={p.tool}>
            {toolLabel(p.tool)}
          </Badge>
          {high && <Badge tone="red">High priority</Badge>}
          <Badge tone="amber" title={p.decidedByRule}>
            {p.why}
          </Badge>
          {lines.length > 0 && <Badge tone="gray">{lines.length} {lines.length === 1 ? 'item' : 'items'}</Badge>}
        </div>

        {p.args?.untrusted_substitute && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
            Supplier-provided text (untrusted): “{p.args.untrusted_substitute.description}” · {usd(p.args.untrusted_substitute.unitPrice)} vs {usd(p.args.originalPrice)} ({p.args.diffPct > 0 ? '+' : ''}
            {num(p.args.diffPct)}%){p.args.flagged && <Badge tone="red">above tolerance</Badge>}
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-4 rounded-xl border border-line">
            <button type="button" aria-expanded={open} aria-controls={linesId} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] hover:bg-raised/60">
              <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-90')} />
              <span className="font-medium">{open ? 'Hide' : 'Show'} line items</span>
              {!open && <span className="min-w-0 flex-1 truncate text-muted">{preview}</span>}
            </button>
            {open && (
              <div id={linesId} className="overflow-x-auto border-t border-line">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="w-full px-3.5 py-2 font-medium">Item</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Quantity</th>
                      <th scope="col" className="hidden whitespace-nowrap px-3 py-2 text-right font-medium sm:table-cell">Unit price</th>
                      <th scope="col" className="whitespace-nowrap px-3.5 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line border-t border-line">
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td className="max-w-0 px-3.5 py-2">
                          <div className="font-medium">
                            {l.ingredient}
                            {l.edited && <span className="ml-1.5 text-[11px] font-normal text-muted">(edited)</span>}
                          </div>
                          {l.rationale && (
                            <div className="truncate text-xs text-muted" title={l.rationale}>
                              {l.rationale}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {num(l.packs * l.packSize)} {l.unit}
                          <div className="text-xs text-muted">
                            {l.packs} × {num(l.packSize)} {l.unit}
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted sm:table-cell">
                          {usd(l.unitPrice)}/{l.unit}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2 text-right font-medium tabular-nums">{usd(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {po && (
                    <tfoot>
                      <tr className="border-t border-line bg-raised/50">
                        <td colSpan={3} className="px-3.5 py-2 text-right text-xs font-medium text-muted max-sm:hidden">
                          Order total
                        </td>
                        <td colSpan={2} className="px-3.5 py-2 text-right text-xs font-medium text-muted sm:hidden">
                          Order total
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2 text-right font-semibold tabular-nums">{usd(po.total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                <p className="border-t border-line px-3.5 py-2 text-xs text-muted">To change quantities, open the order (drafts only) — edits are recorded as corrections.</p>
              </div>
            )}
          </div>
        )}
        {approve.error && (
          <div className="mt-3">
            <ErrorCard error={approve.error} />
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-raised/50 px-4 py-3 sm:px-5">
        <Button variant="primary" icon={Check} disabled={!p.canDecide} busy={approve.isPending} onClick={() => (sends ? setConfirm(true) : approve.mutate())} title={!p.canDecide ? `Requires ${p.requiredRole ?? 'chef'}` : undefined}>
          {sends ? 'Approve & send' : 'Approve'}
        </Button>
        <Button variant="secondary" icon={X} disabled={me.user.role === 'staff'} onClick={() => setReject(true)}>
          Reject…
        </Button>
        {!p.canDecide && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Lock aria-hidden className="h-3.5 w-3.5" />
            Requires {p.requiredRole ?? 'chef'}
          </span>
        )}
        {p.runId && (
          <Link className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium hover:underline" to={`/activity/runs/${p.runId}`}>
            Why? See the run <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        )}
      </footer>
      {reject && <RejectDialog p={p} onClose={() => setReject(false)} />}
      <ConfirmDialog
        open={confirm}
        title={p.tool === 'send_purchase_order' ? 'Approve and send this order?' : 'Approve and contact the supplier?'}
        body={
          <>
            <p className="text-ink">{p.summary}</p>
            <p className="mt-2">
              {po ? `${po.supplier} will receive ${po.number} for ${usd(po.total)}.` : 'The supplier will be contacted.'} Without email configured, a portal link is generated for you to share instead.
            </p>
          </>
        }
        confirmLabel="Approve & send"
        busy={approve.isPending}
        onConfirm={() => approve.mutate()}
        onClose={() => setConfirm(false)}
      />
    </li>
  );
}

function RejectDialog({ p, onClose }: { p: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tag, setTag] = useState('');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const supplierId = suppliers.data?.find((s) => s.name === p.purchaseOrder?.supplier)?.id;
  const categories = [...new Set<string>((p.lines ?? []).map((l: any) => l.category))];
  const m = useMutation({
    mutationFn: () => post(`/actions/${p.id}/reject`, { reason: reason || (tag ? `Don't buy ${tag} from ${p.purchaseOrder?.supplier}` : 'Rejected'), tags: tag && supplierId ? { supplierId, category: tag } : undefined }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast('info', 'Proposal rejected', 'The agent records your reason as a correction.');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Reject proposal"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" busy={m.isPending} onClick={() => m.mutate()}>
            Reject
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">{p.summary}</p>
        {categories.length > 0 && supplierId && (
          <Field label="Structured reason (helps the team learn)" hint="Two similar corrections in 30 days → Buyer proposes a working agreement">
            <select className={inputCls} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  Don't buy {c} from {p.purchaseOrder.supplier}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Reason">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. quantities too high for the weekend" />
        </Field>
        {m.error && <ErrorCard error={m.error} />}
      </div>
    </Modal>
  );
}

function Agreement({ a, me }: { a: any; me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const approve = useMutation({ mutationFn: () => post(`/agreements/${a.id}/approve`), onSuccess: () => (qc.invalidateQueries(), toast('success', 'Rule approved', 'The team follows it from now on.')) });
  const rej = useMutation({ mutationFn: () => post(`/agreements/${a.id}/reject`), onSuccess: () => (qc.invalidateQueries(), toast('info', 'Rule rejected')) });
  const owner = me.user.role === 'owner';
  return (
    <li className={cx(cardCls, 'text-sm')}>
      <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <AgentAvatar id={a.agentId} size="md" />
        <span className="font-semibold text-ink">{agentName(a.agentId)}</span> proposes
        <Badge tone="violet">{a.type.replace(/_/g, ' ')}</Badge>
        <span className="font-mono text-xs">{JSON.stringify(a.params)}</span>
      </div>
      <p className="mt-3 text-[15px] leading-snug">{a.rationale}</p>
      <p className="mt-1 text-xs text-muted">Evidence: {a.evidence.map((e: any) => e.id).join(', ') || '—'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised/50 px-4 py-3 sm:px-5">
        <Button variant="primary" icon={Check} disabled={!owner} busy={approve.isPending} onClick={() => approve.mutate()} title={owner ? undefined : 'Owner only'}>
          Approve rule
        </Button>
        <Button variant="secondary" icon={X} disabled={!owner} busy={rej.isPending} onClick={() => rej.mutate()}>
          Reject
        </Button>
        {!owner && <span className="text-xs text-muted">Only the Owner can approve standing rules.</span>}
      </div>
      {(approve.error || rej.error) && <div className="px-4 pb-3 sm:px-5"><ErrorCard error={approve.error ?? rej.error} /></div>}
    </li>
  );
}

function SupplierUpdates({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty icon={PackageCheck}>No supplier responses yet. They appear when a supplier confirms, reduces or substitutes lines in the portal.</Empty>;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <ul className="divide-y divide-line">
        {rows.map((u) => {
          const issues = u.reduced + u.unavailable + u.substituted;
          return (
            <li key={u.id}>
              <Link to={`/orders/${u.poId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-raised">
                <span className="font-medium">{u.number}</span>
                <span>{u.supplier}</span>
                <Badge tone={issues ? 'amber' : 'green'} dot>
                  {issues ? 'changes' : 'fully confirmed'}
                </Badge>
                <span className="text-xs text-muted">
                  {[u.confirmed && `${u.confirmed} confirmed`, u.reduced && `${u.reduced} reduced`, u.unavailable && `${u.unavailable} unavailable`, u.substituted && `${u.substituted} substitute`].filter(Boolean).join(' · ')}
                  {u.eta && ` · ETA ${u.eta}`} · response v{u.version}
                </span>
                <span className="ml-auto text-xs text-muted" title={dt(u.receivedAt)}>
                  {ago(u.receivedAt)}
                </span>
                {u.untrustedNote && <span className="w-full text-xs text-amber-800">Supplier note (untrusted): “{u.untrustedNote}”</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Completed({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty icon={History}>Nothing decided yet.</Empty>;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <ul className="divide-y divide-line">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <AgentAvatar id={c.agentId} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.summary}</span>
              <span className="block text-xs text-muted">
                {c.agentName} · <span className="font-mono">{c.tool}</span>
                {c.approverName ? ` · decided by ${c.approverName}` : c.policyDecision === 'auto' ? ' · ran automatically (policy)' : ''}
                {c.rejectReason && ` · “${c.rejectReason}”`}
              </span>
            </span>
            <Status s={c.status} />
            <span className={cx('whitespace-nowrap text-xs text-muted')} title={dt(c.decidedAt ?? c.createdAt)}>
              {ago(c.decidedAt ?? c.createdAt)}
            </span>
            {c.runId && (
              <Link aria-label="Open the run" className="text-muted hover:text-ink" to={`/activity/runs/${c.runId}`}>
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notifications({ rows }: { rows: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const readAll = useMutation({ mutationFn: () => post('/notifications/read'), onSuccess: () => (qc.invalidateQueries({ queryKey: ['notifications'] }), toast('success', 'All notifications marked as read')) });
  const unread = rows.filter((n) => !n.read_at).length;
  if (!rows.length) return <Empty icon={Bell}>No notifications yet. Run results, failed emails and escalations appear here.</Empty>;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm">
        <Bell aria-hidden className="h-4 w-4 text-muted" />
        <span className="font-semibold">Notifications</span>
        <span className="text-xs text-muted">Information only — no decision needed</span>
        <Button className="ml-auto" size="sm" variant="subtle" icon={CheckCheck} disabled={!unread} busy={readAll.isPending} onClick={() => readAll.mutate()}>
          Mark all read
        </Button>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((n) => {
          const body = (
            <>
              <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} />
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm', !n.read_at && 'font-semibold')}>
                  {n.title}
                  {!n.read_at && <span className="sr-only"> (unread)</span>}
                </span>
                {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-muted" title={dt(n.created_at)}>
                {ago(n.created_at)}
              </span>
            </>
          );
          return (
            <li key={n.id}>
              {n.link ? (
                <Link to={n.link} className="flex items-start gap-3 px-4 py-2.5 hover:bg-raised">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
