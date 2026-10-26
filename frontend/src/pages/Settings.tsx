import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authRedirect, patch, post, put } from '../api/client';
import type { Me } from '../components/Layout';
import { Building2, Clock, Loader2, FastForward, FileSignature, Monitor, Moon, Plug, RotateCcw, ShieldCheck, Sun, TimerReset, UserRound } from 'lucide-react';
import { useTheme, type ThemePref } from '../lib/theme';
import { useToast } from '../components/toast';
import { agentName, Badge, Button, Card, ConfirmDialog, cx, dt, ErrorCard, Field, inputCls, PageHeader, Q, Status } from '../components/ui';

// Settings (FR-101), autonomy policy (FR-065 – FR-069), agreements (FR-119), integrations (FR-100), clock and data reset.
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

// Who sees each section: Owner manages the workspace; Chef sees the policy read-only and the data clock; Staff only their profile.
const SECTIONS = [
  ['profile', 'Profile & appearance', UserRound],
  ['workspace', 'Workspace', Building2],
  ['policy', 'Autonomy policy', ShieldCheck],
  ['agreements', 'Working agreements', FileSignature],
  ['integrations', 'Integrations', Plug],
  ['clock', 'Data & clock', Clock],
] as const;

const VISIBLE: Record<Me['user']['role'], string[]> = {
  owner: ['profile', 'workspace', 'policy', 'agreements', 'integrations', 'clock'],
  chef: ['profile', 'policy', 'integrations', 'clock'],
  staff: ['profile'],
};

export function SettingsPage({ me }: { me: Me }) {
  const owner = me.user.role === 'owner';
  const visible = VISIBLE[me.user.role];
  const has = (id: string) => visible.includes(id);
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description={owner ? 'Workspace, autonomy policy, integrations and your preferences.' : me.user.role === 'chef' ? 'Your preferences, the autonomy policy (set by the Owner) and integrations.' : 'Your profile and appearance.'} />
      <div className={cx('grid gap-6', visible.length > 1 && 'lg:grid-cols-[13rem_1fr]')}>
        <nav aria-label="Settings sections" className={cx('hidden', visible.length > 1 && 'lg:block')}>
          <ul className="sticky top-16 space-y-px text-sm">
            {SECTIONS.filter(([id]) => has(id)).map(([id, label, Ico]) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-muted hover:bg-raised hover:text-ink">
                  <Ico aria-hidden className="h-4 w-4" /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4 [&>section]:scroll-mt-16">
          <section id="profile">
            <Profile me={me} />
          </section>
          {has('workspace') && (
            <section id="workspace">
              <General owner={owner} />
            </section>
          )}
          {has('policy') && (
            <section id="policy">
              <Policy owner={owner} />
            </section>
          )}
          {has('agreements') && (
            <section id="agreements">
              <Agreements owner={owner} />
            </section>
          )}
          {has('integrations') && (
            <section id="integrations">
              <Integrations />
            </section>
          )}
          {has('clock') && (
            <section id="clock">
              <DataAndClock me={me} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const ROLE_LABEL = { owner: 'Owner', chef: 'Chef', staff: 'Staff' } as const;

const THEME_OPTIONS: [ThemePref, string, typeof Sun][] = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Monitor],
];

function Profile({ me }: { me: Me }) {
  const { pref, theme, setPref } = useTheme();
  return (
    <Card title="Profile & appearance" icon={UserRound}>
      <div className="grid gap-4 sm:grid-cols-2">
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{me.user.name.charAt(0)}</span>
            <div>
              <dt className="sr-only">Name</dt>
              <dd className="font-medium">{me.user.name}</dd>
              <dt className="sr-only">Email</dt>
              <dd className="text-xs text-muted">{me.user.email}</dd>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <dt className="text-muted">Role</dt>
            <dd>
              <Badge tone="green">{ROLE_LABEL[me.user.role]}</Badge>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Restaurant</dt>
            <dd>{me.restaurant}</dd>
          </div>
        </dl>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium">Theme</legend>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(([v, label, Ico]) => (
              <button
                key={v}
                role="radio"
                aria-checked={pref === v}
                onClick={() => setPref(v)}
                className={cx('flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs transition-colors', pref === v ? 'border-accent bg-accent-soft font-medium text-ink' : 'border-line-strong text-muted hover:bg-raised hover:text-ink')}
              >
                <Ico aria-hidden className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{pref === 'system' ? `Following your device (currently ${theme}).` : 'Saved in this browser.'}</p>
        </fieldset>
      </div>
      {me.user.role !== 'staff' && <BriefingEmail me={me} />}
    </Card>
  );
}

/** FR-093: the morning standup email goes to Chefs and Owners who opted in. */
function BriefingEmail({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const on = me.preferences?.briefingEmail ?? true;
  const m = useMutation({
    mutationFn: (v: boolean) => patch('/me/preferences', { briefingEmail: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      toast('success', v ? 'You will get the morning standup by email' : 'Morning standup emails turned off');
    },
    onError: (e) => toast('error', 'Could not save', (e as Error).message),
  });
  return (
    <label className="mt-5 flex items-start gap-3 border-t border-line pt-4 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--foreground)]" checked={on} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} />
      <span>
        <span className="block font-medium">Email me the morning standup</span>
        <span className="block text-xs text-muted">Sent to {me.user.email} once a day after the morning plan{me.illustrativeData ? '; in demo mode every email goes to the demo inbox' : ''}.</span>
      </span>
    </label>
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
    <Card title="Autonomy policy" icon={ShieldCheck} subtitle="Applies to runs started after a change" actions={owner && <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>Save policy</Button>}>
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
    <Card title="Workspace" icon={Building2} subtitle="Restaurant, location and morning schedule" actions={owner && <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
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
    <Card title="Working agreements" icon={FileSignature} subtitle="Structured rules applied by the engines and policy, not by prompt alone">
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
    <Card title="Integrations" icon={Plug} subtitle="Free services only; billing disabled">
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

function DataAndClock({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.user.role === 'owner';
  const canClock = me.user.role !== 'staff';
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/health') });
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = useMutation({
    mutationFn: () => {
      authRedirect.paused = true;
      return post<any>('/admin/reset-demo', {});
    },
    // The reset recreates the database, which also ends every session: go to sign-in deliberately.
    onSuccess: () => {
      setConfirmReset(false);
      qc.clear();
      window.location.href = '/login?reset=1';
    },
    onError: (e) => {
      authRedirect.paused = false;
      setConfirmReset(false);
      toast('error', 'Reset failed', (e as Error).message);
    },
  });
  const clock = useMutation({
    mutationFn: (b: unknown) => post<any>('/admin/clock', b),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast('info', `Clock now ${r.localDate ?? ''} ${r.localTime}`, `${r.jobsRun} scheduled job(s) ran.`);
    },
    onError: (e) => toast('error', 'Clock change failed', (e as Error).message),
  });
  if (!canClock)
    return (
      <Card title="Data & clock" icon={Clock}>
        <p className="text-sm text-muted">Only the Owner and Chef can move the clock; only the Owner can reset data.</p>
      </Card>
    );
  const shifted = Boolean(health.data?.clockOffsetMs);
  return (
    <Card title="Data & clock" icon={Clock} subtitle="For trying out time-based workflows">
      <div className="space-y-5 text-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Simulated clock</span>
            {shifted ? <Badge tone="violet">shifted</Badge> : <Badge>real time</Badge>}
            {health.data && (
              <span className="text-xs text-muted">
                {health.data.localDate} {health.data.localTime} (America/Los_Angeles)
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">Moving the clock forward runs anything that became due — supplier confirmation deadlines, reminders and the 06:00 morning plan — so you can watch follow-ups and escalations without waiting.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={FastForward} busy={clock.isPending && (clock.variables as any)?.advanceMinutes === 60} onClick={() => clock.mutate({ advanceMinutes: 60 })}>
              +1 h
            </Button>
            <Button size="sm" icon={FastForward} busy={clock.isPending && (clock.variables as any)?.advanceMinutes === 300} onClick={() => clock.mutate({ advanceMinutes: 5 * 60 })}>
              +5 h
            </Button>
            <Button size="sm" icon={FastForward} busy={clock.isPending && (clock.variables as any)?.advanceMinutes === 1440} onClick={() => clock.mutate({ advanceMinutes: 24 * 60 })}>
              +1 day
            </Button>
            <Button size="sm" variant="subtle" icon={TimerReset} disabled={!shifted} onClick={() => clock.mutate({ reset: true })}>
              Back to real time
            </Button>
          </div>
        </div>
        {owner && (
          <div className="rounded-md border border-red-200 p-3">
            <div className="font-medium text-red-700">Reset workspace data</div>
            <p className="mt-0.5 text-xs text-muted">Deletes all orders, runs, invoices, disputes and data you entered, then reloads the starting restaurant data. Everyone is signed out; user accounts and passwords stay the same.</p>
            <Button className="mt-2" size="sm" variant="danger" icon={RotateCcw} busy={reset.isPending} onClick={() => setConfirmReset(true)}>
              Reset workspace data…
            </Button>
          </div>
        )}
        {(reset.error || clock.error) && <ErrorCard error={reset.error ?? clock.error} />}
      </div>
      {reset.isPending && (
        <div role="status" aria-live="polite" className="animate-fade fixed inset-0 z-[70] grid place-items-center bg-overlay">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-card px-5 py-4 text-sm shadow-pop">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-accent" />
            Reloading the starting restaurant data — this can take up to a minute…
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        title="Reset all workspace data?"
        body="All orders, agent runs, invoices, disputes, savings and any data you entered will be deleted and the starting restaurant data reloaded. Everyone is signed out. This cannot be undone."
        confirmLabel="Delete and reset"
        tone="danger"
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
        onClose={() => setConfirmReset(false)}
      />
    </Card>
  );
}
