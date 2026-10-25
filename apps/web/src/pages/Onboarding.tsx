import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api/client';
import type { Me } from '../components/Layout';
import { Badge, Button, Card, cx, ErrorCard, Field, inputCls, Q, usd } from '../components/ui';

// Hire your team (FR-111): template card + 5-step wizard → deploy → Team page with onboarding tasks.
const STEPS = ['Restaurant & location', 'Suppliers & offers', 'Schedule & hours', 'Autonomy & limits', 'Channels'];
const PRESETS = {
  cautious: 'Agents draft everything; disputes and follow-ups also need approval.',
  balanced: 'Agents draft orders and disputes and send follow-ups; you approve anything sent to a supplier.',
  hands_off: 'Also auto-sends routine orders to trusted suppliers within your limit and ±20% of the usual order.',
} as const;

export function OnboardingPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ['templates'], queryFn: () => api<any[]>('/templates') });
  const [step, setStep] = useState(-1);
  const [f, setF] = useState({ name: 'Harbor & Vine Bistro', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles', morningRunTime: '06:00', from: '06:00', to: '22:00', preset: 'balanced' as keyof typeof PRESETS, chefApprovalLimit: 1500, autoSendMaxTotal: 500, briefingEmail: true });
  const deploy = useMutation({
    mutationFn: () =>
      post('/templates/restaurant-purchasing-team/deploy', {
        restaurant: { name: f.name, latitude: f.latitude, longitude: f.longitude, timezone: f.timezone, country: 'US', subdivision: 'US-CA' },
        schedule: { morningRunTime: f.morningRunTime, workingHours: { from: f.from, to: f.to } },
        autonomy: { preset: f.preset, chefApprovalLimit: f.chefApprovalLimit, autoSendMaxTotal: f.autoSendMaxTotal },
        channels: { briefingEmail: f.briefingEmail },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      window.location.href = '/team';
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: typeof f[k] === 'number' ? Number(e.target.value) : e.target.value });

  if (me.user.role !== 'owner')
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <Card title="The team has not been hired yet">Ask the Owner to deploy the purchasing team from the template.</Card>
      </main>
    );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent">Hire your team</span>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Instead of hiring a purchasing manager, deploy one.</h1>
      <p className="mt-1 text-sm text-muted">Pick a pre-built team, give it a job description, and it starts working today.</p>

      {step < 0 && (
        <Q q={tpl}>
          {(ts) => (
            <div className="mt-6 grid gap-4">
              {ts.map((t) => (
                <Card key={t.id} title={t.name} subtitle={`v${t.version} · ${t.agents.length} agents`} actions={<Button variant="primary" onClick={() => setStep(0)}>Hire this team</Button>}>
                  <p className="text-sm">{t.description}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {t.agents.map((a: any) => (
                      <div key={a.id} className="rounded-lg border border-line p-3">
                        <div className="font-semibold">{a.displayName}</div>
                        <div className="text-xs text-muted">{a.role}</div>
                        <div className="mt-1 text-[11px] text-muted">{a.tools} tools</div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Q>
      )}

      {step >= 0 && (
        <div className="mt-6">
          <ol className="mb-4 flex flex-wrap gap-2 text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className={cx('rounded-full border px-3 py-1', i === step ? 'border-accent bg-blue-50 text-accent' : i < step ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line text-muted')}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>
          <Card>
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Restaurant name">
                  <input className={inputCls} value={f.name} onChange={set('name')} />
                </Field>
                <Field label="Timezone">
                  <input className={inputCls} value={f.timezone} onChange={set('timezone')} />
                </Field>
                <Field label="Latitude" hint="San Francisco Bay Area default">
                  <input className={inputCls} type="number" step="0.0001" value={f.latitude} onChange={set('latitude')} />
                </Field>
                <Field label="Longitude">
                  <input className={inputCls} type="number" step="0.0001" value={f.longitude} onChange={set('longitude')} />
                </Field>
                <p className="text-xs text-muted sm:col-span-2">Holidays: United States + California (US-CA). Currency: USD.</p>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-2 text-sm">
                <p>
                  Suppliers and offers are preloaded (5 suppliers, ≈55 offers; ≥12 ingredients with two suppliers). You can add more later, or import inventory and sales from CSV in Inventory.
                </p>
                <p className="text-xs text-muted">You can edit suppliers, minimums, fees and offers later under Inventory.</p>
              </div>
            )}
            {step === 2 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Morning run" hint="Pilot runs the purchasing workflow daily">
                  <input className={inputCls} type="time" value={f.morningRunTime} onChange={set('morningRunTime')} />
                </Field>
                <Field label="Working from">
                  <input className={inputCls} type="time" value={f.from} onChange={set('from')} />
                </Field>
                <Field label="Working until">
                  <input className={inputCls} type="time" value={f.to} onChange={set('to')} />
                </Field>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
                    <button key={p} onClick={() => setF({ ...f, preset: p })} className={cx('rounded-lg border p-3 text-left text-sm', f.preset === p ? 'border-accent bg-blue-50' : 'border-line hover:bg-slate-50')}>
                      <div className="font-semibold capitalize">{p.replace('_', '-')}</div>
                      <div className="text-xs text-muted">{PRESETS[p]}</div>
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Chef approval limit (USD)" hint="Above this, the Owner approves">
                    <input className={inputCls} type="number" min={0} value={f.chefApprovalLimit} onChange={set('chefApprovalLimit')} />
                  </Field>
                  <Field label="Auto-send limit (Hands-off only)">
                    <input className={inputCls} type="number" min={0} value={f.autoSendMaxTotal} onChange={set('autoSendMaxTotal')} disabled={f.preset !== 'hands_off'} />
                  </Field>
                </div>
                <p className="text-xs text-muted">Working agreements always need Owner approval. Nothing is sent to a supplier without approval unless you choose Hands-off.</p>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={f.briefingEmail} onChange={(e) => setF({ ...f, briefingEmail: e.target.checked })} /> Morning standup email to Owner and Chef (Brevo)
                </label>
                <p className="flex items-center gap-2 text-xs text-muted">
                  Phone approvals via Telegram <Badge>P1</Badge>
                </p>
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                  Summary: {f.name} · morning run {f.morningRunTime} · {f.preset.replace('_', '-')} autonomy · Chef limit {usd(f.chefApprovalLimit)}
                </div>
              </div>
            )}
            {deploy.error && (
              <div className="mt-3">
                <ErrorCard error={deploy.error} />
              </div>
            )}
            <div className="mt-5 flex justify-between">
              <Button onClick={() => setStep(step - 1)}>Back</Button>
              {step < STEPS.length - 1 ? (
                <Button variant="primary" onClick={() => setStep(step + 1)}>
                  Next
                </Button>
              ) : (
                <Button variant="primary" busy={deploy.isPending} onClick={() => deploy.mutate()}>
                  Deploy the team
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
