import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleHelp, ClipboardCheck, ExternalLink, FileSignature, History, PackageCheck, ShieldCheck, X } from 'lucide-react';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { useToast } from '../components/toast';
import { agentName, ago, Badge, Button, ConfirmDialog, cx, dt, Empty, ErrorCard, Field, inputCls, Modal, num, PageHeader, Q, SearchInput, Status, Tabs, usd } from '../components/ui';
import { AgentAvatar } from './Today';

// Inbox (FR-068, FR-117): everything that needs a human, plus what was decided and what suppliers said.
const TABS = [
  ['pending', 'Needs you'],
  ['approvals', 'Approvals'],
  ['questions', 'Questions'],
  ['rules', 'Rules'],
  ['suppliers', 'Supplier updates'],
  ['completed', 'Completed'],
] as const;
type Tab = (typeof TABS)[number][0];
// Actions that contact a supplier get an explicit confirmation step.
const SENDS = new Set(['send_purchase_order', 'send_dispute_email', 'send_supplier_followup']);

const matches = (q: string, ...fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

export function InboxPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  const [tab, setTab] = useState<Tab>('pending');
  const [search, setSearch] = useState('');
  const d = q.data;
  const counts = d && {
    pending: d.counts.proposals + d.counts.questions + d.counts.agreements,
    approvals: d.counts.proposals,
    questions: d.counts.questions,
    rules: d.counts.agreements,
    suppliers: d.supplierUpdates.length,
    completed: d.completed.length,
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Inbox" description="Decisions your AI team needs from you, and what has already been decided." />
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
          if (tab === 'suppliers') return <SupplierUpdates rows={d.supplierUpdates.filter((u: any) => matches(search, u.supplier, u.number))} />;
          if (tab === 'completed') return <Completed rows={d.completed.filter((c: any) => matches(search, c.summary, c.agentName, c.tool, c.approverName))} />;
          const none = (show('questions') ? questions.length : 0) + (show('approvals') ? proposals.length : 0) + (show('rules') ? agreements.length : 0) === 0;
          return (
            <div className="space-y-3">
              {none && (
                <Empty icon={ClipboardCheck} title={search ? 'No matches' : 'You are all caught up'}>
                  {search ? 'Nothing pending matches your search.' : 'Nothing is waiting for a decision. New approvals appear here when an agent proposes an order, a dispute or a rule.'}
                </Empty>
              )}
              {show('questions') && questions.length > 0 && (
                <Group title="Questions from the team" hint="The agent's run is paused until you answer" icon={CircleHelp}>
                  {questions.map((x: any) => (
                    <Question key={x.id} x={x} />
                  ))}
                </Group>
              )}
              {show('approvals') && proposals.length > 0 && (
                <Group title="Approvals" hint="Agents propose; the autonomy policy decides what needs you" icon={ShieldCheck}>
                  {proposals.map((p: any) => (
                    <Proposal key={p.id} p={p} me={me} />
                  ))}
                </Group>
              )}
              {show('rules') && agreements.length > 0 && (
                <Group title="Working agreements proposed" hint="Standing rules the team will follow — Owner approval required" icon={FileSignature}>
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

function Group({ title, hint, icon: Ico, children }: { title: string; hint: string; icon: typeof ShieldCheck; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card shadow-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Ico aria-hidden className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted">{hint}</span>
      </header>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

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
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <AgentAvatar id={x.agentId} />
        <span className="font-medium text-ink">{x.agentName}</span> asks
        <Badge tone="red">High · blocks a run</Badge>
        <span className="ml-auto">answer by {dt(x.deadline)}</span>
      </div>
      <div className="mt-1.5 text-sm font-medium">{x.text}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {x.options.map((o: string) => (
          <Button key={o} size="sm" variant={o === x.recommended ? 'primary' : 'secondary'} busy={m.isPending && m.variables === o} onClick={() => m.mutate(o)}>
            {o}
            {o === x.recommended && ' (recommended)'}
          </Button>
        ))}
        <span className="text-xs text-muted">If unanswered it is {x.actionId ? 'escalated' : 'escalated or the default is used'}.</span>
        <Link className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline" to={`/activity/runs/${x.runId}`}>
          See the run <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
      {m.error && <div className="mt-2"><ErrorCard error={m.error} /></div>}
    </li>
  );
}

function Proposal({ p, me }: { p: any; me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reject, setReject] = useState(false);
  const [confirm, setConfirm] = useState(false);
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
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <AgentAvatar id={p.agentId} />
        <span className="font-medium text-ink">{p.agentName ?? agentName(p.agentId)}</span>
        <span className="font-mono">{p.tool}</span>
        {high && <Badge tone="red">High</Badge>}
        <Badge tone="amber" title={p.decidedByRule}>
          {p.why}
        </Badge>
        {p.requiredRole && <Badge>needs {p.requiredRole}</Badge>}
        <span className="ml-auto" title={dt(p.createdAt)}>
          {ago(p.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 text-sm font-medium">{p.summary}</div>
      {p.args?.untrusted_substitute && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-amber-800">
          Supplier-provided text (untrusted): “{p.args.untrusted_substitute.description}” · {usd(p.args.untrusted_substitute.unitPrice)} vs {usd(p.args.originalPrice)} ({p.args.diffPct > 0 ? '+' : ''}
          {num(p.args.diffPct)}%){p.args.flagged && <Badge tone="red">above tolerance</Badge>}
        </div>
      )}
      {p.purchaseOrder && (
        <div className="mt-2.5 overflow-hidden rounded-md border border-line">
          <div className="flex flex-wrap items-center gap-2 bg-raised px-3 py-2 text-sm">
            <Link className="font-semibold text-accent hover:underline" to={`/orders/${p.purchaseOrder.id}`}>
              {p.purchaseOrder.number}
            </Link>
            <span>{p.purchaseOrder.supplier}</span>
            <span className="font-mono font-medium">{usd(p.purchaseOrder.total)}</span>
            {p.purchaseOrder.saving > 0 && (
              <Badge tone="green">
                saves {usd(p.purchaseOrder.saving)} vs {usd(p.purchaseOrder.baseline_total)} baseline
              </Badge>
            )}
          </div>
          <ul className="divide-y divide-line text-xs">
            {p.lines.map((l: any) => (
              <li key={l.id} className="grid gap-x-3 px-3 py-1.5 sm:grid-cols-[minmax(8rem,1fr)_auto]">
                <span>
                  <span className="font-medium">{l.ingredient}</span>
                  {l.rationale && <span className="text-muted"> — {l.rationale}</span>}
                </span>
                <span className="font-mono text-muted sm:text-right">
                  {l.packs} × {l.packSize} {l.unit} @ {usd(l.unitPrice)} = <span className="text-ink">{usd(l.lineTotal)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">To change quantities, open the order (drafts only) — edits are recorded as corrections.</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={Check} disabled={!p.canDecide} busy={approve.isPending} onClick={() => (sends ? setConfirm(true) : approve.mutate())} title={!p.canDecide ? `Requires ${p.requiredRole ?? 'chef'}` : undefined}>
          Approve
        </Button>
        <Button variant="secondary" size="sm" icon={X} disabled={me.user.role === 'staff'} onClick={() => setReject(true)}>
          Reject…
        </Button>
        {!p.canDecide && <span className="text-xs text-muted">Requires {p.requiredRole ?? 'chef'}</span>}
        {p.runId && (
          <Link className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline" to={`/activity/runs/${p.runId}`}>
            Why? See the run <ArrowRight aria-hidden className="h-3 w-3" />
          </Link>
        )}
      </div>
      {approve.error && <div className="mt-2"><ErrorCard error={approve.error} /></div>}
      {reject && <RejectDialog p={p} onClose={() => setReject(false)} />}
      <ConfirmDialog
        open={confirm}
        title={p.tool === 'send_purchase_order' ? 'Approve and send this order?' : 'Approve and contact the supplier?'}
        body={
          <>
            <p className="text-ink">{p.summary}</p>
            <p className="mt-2">
              {p.purchaseOrder ? `${p.purchaseOrder.supplier} will receive ${p.purchaseOrder.number} for ${usd(p.purchaseOrder.total)}.` : 'The supplier will be contacted.'} Without email configured, a portal link is generated for you to share instead.
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
    <li className="p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <AgentAvatar id={a.agentId} />
        <span className="font-medium text-ink">{agentName(a.agentId)}</span> proposes
        <Badge tone="violet">{a.type.replace(/_/g, ' ')}</Badge>
        <span className="font-mono">{JSON.stringify(a.params)}</span>
      </div>
      <p className="mt-1.5">{a.rationale}</p>
      <p className="text-xs text-muted">Evidence: {a.evidence.map((e: any) => e.id).join(', ') || '—'}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={Check} disabled={!owner} busy={approve.isPending} onClick={() => approve.mutate()} title={owner ? undefined : 'Owner only'}>
          Approve rule
        </Button>
        <Button variant="secondary" size="sm" icon={X} disabled={!owner} busy={rej.isPending} onClick={() => rej.mutate()}>
          Reject
        </Button>
        {!owner && <span className="text-xs text-muted">Only the Owner can approve standing rules.</span>}
      </div>
      {(approve.error || rej.error) && <div className="mt-2"><ErrorCard error={approve.error ?? rej.error} /></div>}
    </li>
  );
}

function SupplierUpdates({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty icon={PackageCheck}>No supplier responses yet. They appear when a supplier confirms, reduces or substitutes lines in the portal.</Empty>;
  return (
    <section className="rounded-lg border border-line bg-card shadow-card">
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
    <section className="overflow-hidden rounded-lg border border-line bg-card shadow-card">
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
