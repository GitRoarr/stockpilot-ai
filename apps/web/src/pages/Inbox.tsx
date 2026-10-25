import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { agentName, Badge, Button, Card, dt, Empty, ErrorCard, Field, inputCls, Modal, num, Q, usd } from '../components/ui';

export function InboxPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api<any>('/inbox') });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Inbox</h1>
      <Q q={q}>
        {(d) => (
          <>
            {d.questions.length > 0 && (
              <Card title="Questions from the team" subtitle="The agent's run is paused until you answer">
                <ul className="space-y-3">
                  {d.questions.map((x: any) => (
                    <Question key={x.id} x={x} />
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Approvals" subtitle="Agents propose; the autonomy policy decides what needs you">
              {d.proposals.length ? (
                <ul className="space-y-3">
                  {d.proposals.map((p: any) => (
                    <Proposal key={p.id} p={p} me={me} />
                  ))}
                </ul>
              ) : (
                <Empty>Nothing waiting for approval.</Empty>
              )}
            </Card>
            {d.agreements.length > 0 && (
              <Card title="Working agreements proposed" subtitle="Rules the team will follow — Owner approval required">
                <ul className="space-y-3">
                  {d.agreements.map((a: any) => (
                    <Agreement key={a.id} a={a} me={me} />
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </Q>
    </div>
  );
}

function Question({ x }: { x: any }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (answer: string) => post(`/questions/${x.id}/answer`, { answer }), onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }) });
  return (
    <li className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <div className="text-xs text-muted">
        {x.agentName} asks · answer by {dt(x.deadline)} (then {x.actionId ? 'escalated' : 'escalated or default'})
      </div>
      <div className="mt-0.5 font-medium">{x.text}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {x.options.map((o: string) => (
          <Button key={o} variant={o === x.recommended ? 'primary' : 'secondary'} busy={m.isPending && m.variables === o} onClick={() => m.mutate(o)}>
            {o}
            {o === x.recommended && ' (recommended)'}
          </Button>
        ))}
        <Link className="self-center text-xs text-accent" to={`/activity/runs/${x.runId}`}>
          See the run →
        </Link>
      </div>
      {m.error && <ErrorCard error={m.error} />}
    </li>
  );
}

function Proposal({ p, me }: { p: any; me: Me }) {
  const qc = useQueryClient();
  const [reject, setReject] = useState(false);
  const approve = useMutation({ mutationFn: () => post(`/actions/${p.id}/approve`), onSuccess: () => qc.invalidateQueries() });
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="blue">{p.agentName ?? agentName(p.agentId)}</Badge>
        <span className="font-mono">{p.tool}</span>
        <span>· {dt(p.createdAt)}</span>
        <Badge tone="amber" title={p.decidedByRule}>
          {p.why}
        </Badge>
        {p.requiredRole && <Badge>needs {p.requiredRole}</Badge>}
      </div>
      <div className="mt-1 font-medium">{p.summary}</div>
      {p.args?.untrusted_substitute && (
        <div className="mt-1 text-xs text-amber-800">
          Supplier-provided text (untrusted): “{p.args.untrusted_substitute.description}” · {usd(p.args.untrusted_substitute.unitPrice)} vs {usd(p.args.originalPrice)} ({p.args.diffPct > 0 ? '+' : ''}
          {num(p.args.diffPct)}%){p.args.flagged && <Badge tone="red">above tolerance</Badge>}
        </div>
      )}
      {p.purchaseOrder && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link className="font-semibold text-accent" to={`/orders/${p.purchaseOrder.id}`}>
              {p.purchaseOrder.number}
            </Link>
            {p.purchaseOrder.supplier} · <span className="font-mono">{usd(p.purchaseOrder.total)}</span>
            {p.purchaseOrder.saving > 0 && (
              <Badge tone="green">
                saves {usd(p.purchaseOrder.saving)} vs {usd(p.purchaseOrder.baseline_total)} baseline
              </Badge>
            )}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.lines.map((l: any) => (
              <li key={l.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{l.ingredient}</span>
                <span className="font-mono">
                  {l.packs} × {l.packSize} {l.unit} @ {usd(l.unitPrice)} = {usd(l.lineTotal)}
                </span>
                {l.rationale && <span className="text-muted">— {l.rationale}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">To change quantities, open the PO (drafts only) — edits are recorded as corrections.</p>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!p.canDecide} busy={approve.isPending} onClick={() => approve.mutate()} title={!p.canDecide ? `Requires ${p.requiredRole ?? 'chef'}` : undefined}>
          Approve
        </Button>
        <Button variant="danger" disabled={me.user.role === 'staff'} onClick={() => setReject(true)}>
          Reject…
        </Button>
        {p.runId && (
          <Link className="self-center text-xs text-accent" to={`/activity/runs/${p.runId}`}>
            Why? See the run →
          </Link>
        )}
      </div>
      {approve.error && <ErrorCard error={approve.error} />}
      {reject && <RejectDialog p={p} onClose={() => setReject(false)} />}
    </li>
  );
}

function RejectDialog({ p, onClose }: { p: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [tag, setTag] = useState('');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const supplierId = suppliers.data?.find((s) => s.name === p.purchaseOrder?.supplier)?.id;
  const categories = [...new Set<string>((p.lines ?? []).map((l: any) => l.category))];
  const m = useMutation({
    mutationFn: () => post(`/actions/${p.id}/reject`, { reason: reason || (tag ? `Don't buy ${tag} from ${p.purchaseOrder?.supplier}` : 'Rejected'), tags: tag && supplierId ? { supplierId, category: tag } : undefined }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Reject proposal" footer={<Button variant="danger" busy={m.isPending} onClick={() => m.mutate()}>Reject</Button>}>
      <div className="space-y-3">
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
  const approve = useMutation({ mutationFn: () => post(`/agreements/${a.id}/approve`), onSuccess: () => qc.invalidateQueries() });
  const rej = useMutation({ mutationFn: () => post(`/agreements/${a.id}/reject`), onSuccess: () => qc.invalidateQueries() });
  const owner = me.user.role === 'owner';
  return (
    <li className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet">{a.type}</Badge>
        <span className="font-mono text-xs">{JSON.stringify(a.params)}</span>
        <span className="text-xs text-muted">proposed by {agentName(a.agentId)}</span>
      </div>
      <p className="mt-1">{a.rationale}</p>
      <p className="text-xs text-muted">Evidence: {a.evidence.map((e: any) => e.id).join(', ') || '—'}</p>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={!owner} busy={approve.isPending} onClick={() => approve.mutate()} title={owner ? undefined : 'Owner only'}>
          Approve rule
        </Button>
        <Button variant="danger" disabled={!owner} onClick={() => rej.mutate()}>
          Reject
        </Button>
      </div>
      {(approve.error || rej.error) && <ErrorCard error={approve.error ?? rej.error} />}
    </li>
  );
}
