import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post, put } from '../api/client';
import type { Me } from '../components/Layout';
import { agentName, Badge, Button, Card, dt, ErrorCard, Field, inputCls, Q, Status, usd } from '../components/ui';

// Settings (FR-101), autonomy policy (FR-065 – FR-069), agreements (FR-119), integrations (FR-100), demo controls.
const ACTIONS: [string, string][] = [
  ['draft_purchase_orders', 'Draft purchase orders'],
  ['send_purchase_order', 'Send PO to supplier'],
  ['send_supplier_followup', 'Supplier follow-up reminder'],
  ['propose_po_change', 'Change a draft PO line'],
  ['accept_substitution', 'Accept a substitution'],
  ['add_demand_event', 'Add a demand event'],
  ['open_dispute', 'Open a dispute (draft)'],
  ['send_dispute_email', 'Send dispute email'],
  ['record_credit', 'Record a credit (auto if supplier accepted in portal)'],
  ['publish_briefing', 'Publish standup'],
  ['propose_working_agreement', 'Working agreements (always Owner)'],
];

export function SettingsPage({ me }: { me: Me }) {
  const owner = me.user.role === 'owner';
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {!owner && <p className="text-sm text-muted">Only the Owner can change settings and the autonomy policy.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Policy owner={owner} />
        <General owner={owner} />
        <Agreements owner={owner} />
        <Integrations />
        {owner && <Demo />}
      </div>
    </div>
  );
}

function Policy({ owner }: { owner: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['policy'], queryFn: () => api<any>('/policy') });
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(1500);
  const [auto, setAuto] = useState({ enabled: false, maxTotal: 500, maxDeviationPct: 20 });
  useEffect(() => {
    if (!q.data) return;
    setLevels(Object.fromEntries(q.data.levels.map((l: any) => [l.action, l.level])));
    setLimit(q.data.chefApprovalLimit);
    setAuto(q.data.autoSend);
  }, [q.data]);
  const save = useMutation({ mutationFn: () => put('/policy', { levels, chefApprovalLimit: limit, autoSend: auto }), onSuccess: () => qc.invalidateQueries({ queryKey: ['policy'] }) });
  return (
    <Card title="Autonomy policy" subtitle="Applies to runs started after a change" actions={owner && <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>Save policy</Button>}>
      <Q q={q}>
        {() => (
          <>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {ACTIONS.map(([a, label]) => (
                  <tr key={a}>
                    <td className="py-1.5 pr-2">{label}</td>
                    <td className="py-1.5">
                      <div className="flex justify-end gap-1">
                        {(['auto', 'approve', 'never'] as const).map((lvl) => (
                          <button
                            key={lvl}
                            disabled={!owner || (a === 'propose_working_agreement' && lvl === 'auto')}
                            onClick={() => setLevels({ ...levels, [a]: lvl })}
                            className={`rounded-md border px-2 py-0.5 text-xs disabled:opacity-40 ${levels[a] === lvl ? (lvl === 'auto' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : lvl === 'approve' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-800') : 'border-line'}`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Chef approval limit (USD)" hint="Above this the Owner approves">
                <input className={inputCls} type="number" min={0} value={limit} disabled={!owner} onChange={(e) => setLimit(Number(e.target.value))} />
              </Field>
              <div className="rounded-lg border border-line p-2 text-sm">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={auto.enabled} disabled={!owner} onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })} /> Auto-send rule (FR-066)
                </label>
                <p className="mt-1 text-xs text-muted">Trusted supplier, total ≤ limit, within ±{auto.maxDeviationPct}% of its 4-week average, no verifier flag, never for runs triggered by external text.</p>
                <input aria-label="Auto-send limit" className={`${inputCls} mt-1`} type="number" min={0} value={auto.maxTotal} disabled={!owner || !auto.enabled} onChange={(e) => setAuto({ ...auto, maxTotal: Number(e.target.value) })} />
              </div>
            </div>
            {save.error && <ErrorCard error={save.error} />}
            {save.isSuccess && <p className="mt-2 text-xs text-emerald-700">Saved.</p>}
          </>
        )}
      </Q>
    </Card>
  );
}

function General({ owner }: { owner: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<any>('/settings') });
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      put('/settings', {
        restaurantName: s.restaurantName,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        timezone: s.timezone,
        subdivision: s.subdivision,
        morningRunTime: s.morningRunTime,
        expiryWindowDays: Number(s.expiryWindowDays),
        defaultServiceLevel: Number(s.defaultServiceLevel),
        priceTolerancePct: Number(s.priceTolerancePct),
        priceToleranceAbs: Number(s.priceToleranceAbs),
        substitutionTolerancePct: Number(s.substitutionTolerancePct),
        disputeMinimum: Number(s.disputeMinimum),
        confirmationHours: Number(s.confirmationHours),
        weatherEnabled: s.weatherEnabled,
        holidaysEnabled: s.holidaysEnabled,
        briefingEmail: s.briefingEmail,
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const f = (k: string, label: string, type = 'text', step?: string) => (
    <Field label={label}>
      <input className={inputCls} type={type} step={step} disabled={!owner} value={s?.[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card title="Restaurant & rules" actions={owner && <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      {s && (
        <div className="grid grid-cols-2 gap-3">
          {f('restaurantName', 'Restaurant')}
          {f('timezone', 'Timezone')}
          {f('latitude', 'Latitude', 'number', '0.0001')}
          {f('longitude', 'Longitude', 'number', '0.0001')}
          {f('subdivision', 'Holiday subdivision')}
          {f('morningRunTime', 'Morning run', 'time')}
          {f('expiryWindowDays', 'Expiry window (days)', 'number')}
          {f('confirmationHours', 'Supplier confirmation (hours)', 'number')}
          {f('priceTolerancePct', 'Price tolerance (fraction, 0.02 = 2%)', 'number', '0.005')}
          {f('priceToleranceAbs', 'Price tolerance ($/unit)', 'number', '0.01')}
          {f('substitutionTolerancePct', 'Substitution tolerance (fraction)', 'number', '0.01')}
          {f('disputeMinimum', 'Dispute minimum (USD)', 'number', '0.5')}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!owner} checked={s.weatherEnabled} onChange={(e) => setS({ ...s, weatherEnabled: e.target.checked })} /> Weather (Open-Meteo)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!owner} checked={s.holidaysEnabled} onChange={(e) => setS({ ...s, holidaysEnabled: e.target.checked })} /> Holidays (Nager.Date)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!owner} checked={s.briefingEmail} onChange={(e) => setS({ ...s, briefingEmail: e.target.checked })} /> Morning standup email
          </label>
        </div>
      )}
      {save.error && <ErrorCard error={save.error} />}
    </Card>
  );
}

function Agreements({ owner }: { owner: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agreements'], queryFn: () => api<any[]>('/agreements') });
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: string }) => post(`/agreements/${id}/${a}`), onSuccess: () => qc.invalidateQueries() });
  return (
    <Card title="Working agreements" subtitle="Structured rules applied by the engines and policy, not by prompt alone">
      <div id="agreements" />
      <Q q={q}>
        {(rows) =>
          rows.length ? (
            <ul className="space-y-2 text-sm">
              {rows.map((a) => (
                <li key={a.id} className="rounded-lg border border-line p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="violet">{a.type}</Badge>
                    <span className="font-mono text-xs">{JSON.stringify(a.params)}</span>
                    <Status s={a.status} />
                  </div>
                  <p className="mt-1 text-xs">{a.rationale}</p>
                  <p className="text-[11px] text-muted">
                    Origin: {agentName(a.agentId)} · {dt(a.createdAt)} · evidence {a.evidence.length}
                  </p>
                  {owner && (
                    <div className="mt-1 flex gap-2">
                      {a.status === 'proposed' && (
                        <>
                          <Button onClick={() => act.mutate({ id: a.id, a: 'approve' })}>Approve</Button>
                          <Button variant="danger" onClick={() => act.mutate({ id: a.id, a: 'reject' })}>
                            Reject
                          </Button>
                        </>
                      )}
                      {a.status === 'active' && (
                        <Button variant="danger" onClick={() => act.mutate({ id: a.id, a: 'revoke' })}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None yet. When you correct the same thing twice, the responsible agent proposes a rule here.</p>
          )
        }
      </Q>
      {act.error && <ErrorCard error={act.error} />}
    </Card>
  );
}

function Integrations() {
  const q = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/health') });
  const [res, setRes] = useState<Record<string, string>>({});
  const test = useMutation({ mutationFn: (n: string) => post<any>(`/integrations/${n}/test`), onSuccess: (r) => setRes((x) => ({ ...x, [r.name]: typeof r.result === 'string' ? r.result : `${r.result?.status ?? ''} ${r.result?.message ?? ''}` })) });
  return (
    <Card title="Integrations" subtitle="Free services only; billing disabled">
      <Q q={q}>
        {(h) => (
          <ul className="space-y-2 text-sm">
            {[
              ['gemini', 'Google Gemini (agents, extraction)', h.integrations.gemini],
              ['weather', 'Open-Meteo (forecast + history)', h.integrations.weather],
              ['holidays', 'Nager.Date (US + US-CA)', h.integrations.holidays],
              ['email', 'Brevo (email)', h.integrations.email],
            ].map(([k, label, s]) => (
              <li key={k} className="flex flex-wrap items-center gap-2">
                <span className="w-64">{label}</span>
                <Status s={s} />
                <Button variant="ghost" busy={test.isPending && test.variables === k} onClick={() => test.mutate(k)}>
                  Test connection
                </Button>
                {res[k] && <span className="text-xs text-muted">{res[k]}</span>}
              </li>
            ))}
            <li className="text-xs text-muted">
              AI calls today {h.ai.used}/{h.ai.budget} · max {h.ai.maxRpm}/min. Without a key every workflow runs as a labelled rule-based pipeline.
            </li>
          </ul>
        )}
      </Q>
    </Card>
  );
}

function Demo() {
  const qc = useQueryClient();
  const reset = useMutation({ mutationFn: () => post<any>('/admin/reset-demo', {}), onSuccess: () => qc.invalidateQueries() });
  const clock = useMutation({ mutationFn: (b: unknown) => post<any>('/admin/clock', b), onSuccess: () => qc.invalidateQueries() });
  return (
    <Card title="Demo controls" subtitle="DEMO_MODE only">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="danger"
            busy={reset.isPending}
            onClick={() => {
              if (confirm('Reset all data to the illustrative demo? This deletes orders, runs and invoices.')) reset.mutate();
            }}
          >
            Reset demo data
          </Button>
          {reset.data && (
            <span className="text-xs text-muted">
              Loaded. Demo plan {usd(reset.data.demoPlan?.total)} vs baseline {usd(reset.data.demoPlan?.baseline)}.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>Time travel:</span>
          <Button onClick={() => clock.mutate({ advanceMinutes: 60 })}>+1 h</Button>
          <Button onClick={() => clock.mutate({ advanceMinutes: 5 * 60 })}>+5 h</Button>
          <Button onClick={() => clock.mutate({ advanceMinutes: 24 * 60 })}>+1 day</Button>
          <Button variant="ghost" onClick={() => clock.mutate({ reset: true })}>
            Reset clock
          </Button>
          {clock.data && <span className="text-xs text-muted">Now {clock.data.localTime} · {clock.data.jobsRun} due job(s) ran</span>}
        </div>
        <p className="text-xs text-muted">Time travel moves the app clock forward so confirmation deadlines and the 06:00 run fire immediately.</p>
        {(reset.error || clock.error) && <ErrorCard error={reset.error ?? clock.error} />}
      </div>
    </Card>
  );
}
