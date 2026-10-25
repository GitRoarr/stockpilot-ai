import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, post } from '../api/client';
import { Button, cx, Field, inputCls, LogoMark, Modal } from '../components/ui';

// One-click sample accounts, shown only when the server runs in demo mode (/api/health → demoMode).
const DEMO_PASSWORD = 'harborvine2026';
const ROLES = [
  { role: 'Owner', email: 'sara@harborvine.com', can: 'Settings, policy and every approval' },
  { role: 'Chef', email: 'daniel@harborvine.com', can: 'Plans and approves orders, disputes' },
  { role: 'Staff', email: 'leo@harborvine.com', can: 'Receives deliveries and invoices' },
] as const;

/** Email/password sign-in plus demo-mode sample accounts; shown in the homepage sign-in dialog. */
export function SignInForm() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reset = new URLSearchParams(window.location.search).has('reset');
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ demoMode: boolean }>('/health'), retry: false });
  const signIn = async (who: string, pw: string, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await post('/auth/login', { email: who, password: pw });
      await qc.invalidateQueries();
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };
  // Show the sample account in the fields before signing in, so a browser-saved login can't be mistaken for it.
  const signInAs = (who: string) => {
    setEmail(who);
    setPassword(DEMO_PASSWORD);
    signIn(who, DEMO_PASSWORD, who);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn(email, password, 'form');
  };
  return (
    <div>
      {reset && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Data reset complete. Sign in again to continue.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className={cx(inputCls, field)} type="email" autoComplete="username" placeholder="you@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div className="text-sm">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <span className="relative block">
            <input id="password" className={cx(inputCls, field, 'pr-11!')} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink" onClick={() => setShow(!show)}>
              {show ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </button>
          </span>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy === 'form'} disabled={busy !== null && busy !== 'form'} className="h-11 w-full text-[15px]">
          Sign in
        </Button>
      </form>
      {health.data?.demoMode && (
        <div className="mt-5">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          {!demo ? (
            <Button className="mt-5 h-11 w-full text-[15px]" disabled={busy !== null} onClick={() => setDemo(true)}>
              Use demo data
            </Button>
          ) : (
            <div className="animate-enter mt-5">
              <div className="flex items-center">
                <div>
                  <div className="text-sm font-semibold">Choose a demo role</div>
                  <p className="text-xs text-muted">Sign in instantly with a sample account.</p>
                </div>
                <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-ink" disabled={busy !== null} onClick={() => setDemo(false)}>
                  <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                  Back
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {ROLES.map(({ role, email: e, can }) => (
                  <button
                    key={e}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => signInAs(e)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left shadow-card transition-colors hover:border-line-strong hover:bg-raised disabled:opacity-60"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-ink ring-1 ring-line">
                      {busy === e ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : role.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Continue as {role}</span>
                      <span className="block truncate text-xs text-muted">{can}</span>
                    </span>
                    <ArrowRight aria-hidden className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Taller inputs on the auth forms; colours and focus ring are the dashboard's.
const field = 'h-11! px-3.5! text-[15px]!';

/** Self-service sign-up (demo mode): creates a Staff account and signs it in (POST /auth/register). */
export function SignUpForm({ demoMode }: { demoMode: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/register', { name, email, password });
      await qc.invalidateQueries();
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  if (!demoMode) return <p className="rounded-lg border border-line bg-raised px-3 py-2.5 text-sm text-muted">New accounts are created by the restaurant Owner. Ask them for an invitation.</p>;
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Field label="Full name">
        <input className={cx(inputCls, field)} autoComplete="name" placeholder="Maya Chen" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
      </Field>
      <Field label="Work email">
        <input className={cx(inputCls, field)} type="email" autoComplete="email" placeholder="you@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <div className="text-sm">
        <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">
          Create password
        </label>
        <span className="relative block">
          <input id="new-password" className={cx(inputCls, field, 'pr-11!')} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink" onClick={() => setShow(!show)}>
            {show ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </button>
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" busy={busy} className="h-11 w-full text-[15px]">
        Create account
      </Button>
      <p className="text-xs leading-relaxed text-muted">New accounts join Harbor &amp; Vine Bistro as Staff: receiving deliveries, stock counts and invoices. The Owner and Chef approve orders.</p>
    </form>
  );
}

export type AuthMode = 'signin' | 'signup';

/**
 * Sign-in / create-account dialog. On wide screens a teal panel slides over whichever form is inactive; on phones
 * one form shows at a time with a link to switch. The inactive form is inert.
 */
export function AuthDialog({ mode, onMode, onClose }: { mode: AuthMode | null; onMode: (m: AuthMode) => void; onClose: () => void }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ demoMode: boolean }>('/health'), retry: false });
  const demoMode = Boolean(health.data?.demoMode);
  // The active side follows the route ("/login" or "/signup"); it is kept while the dialog closes so it doesn't flip.
  const [shown, setShown] = useState<AuthMode>(mode ?? 'signin');
  const [prev, setPrev] = useState(mode);
  if (mode !== prev) {
    setPrev(mode);
    if (mode) setShown(mode);
  }
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!prev) return;
    // Move focus into the form that just became active.
    const t = setTimeout(() => box.current?.querySelector<HTMLElement>(`[data-panel="${shown}"] input`)?.focus(), 60);
    return () => clearTimeout(t);
  }, [shown, prev]);
  const signin = shown === 'signin';
  return (
    <Modal open={mode !== null} onClose={onClose} title={signin ? 'Sign in to StockPilot AI' : 'Create a StockPilot AI account'} size="xl" center bare closeClassName={signin ? 'md:text-white/80 md:hover:bg-white/10 md:hover:text-white' : undefined}>
      <div ref={box} className="relative md:h-[640px]">
        <Panel id="signin" active={signin} side="left">
          <PanelHead title="Sign in" text="Welcome back to Harbor & Vine Bistro." />
          <SignInForm />
          <Switch text="New to StockPilot AI?" action="Create an account" onClick={() => onMode('signup')} />
        </Panel>
        <Panel id="signup" active={!signin} side="right">
          <PanelHead title="Create account" text="Join your restaurant’s purchasing team." />
          <SignUpForm demoMode={demoMode} />
          <Switch text="Already have an account?" action="Sign in" onClick={() => onMode('signin')} />
        </Panel>

        <div className={cx('brand-panel absolute inset-y-0 left-1/2 z-10 hidden w-1/2 overflow-hidden text-white transition-transform duration-500 ease-in-out md:block', !signin && '-translate-x-full')}>
          <div aria-hidden className="brand-grid absolute inset-0 opacity-50" />
          <div className="relative flex h-full flex-col p-10">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-9 w-9" />
              <span className="text-[15px] font-semibold">StockPilot AI</span>
            </div>
            <div className="relative mt-auto mb-auto">
              <Overlay show={signin} title="New to StockPilot AI?" text="Create an account to work alongside the AI purchasing team: receive deliveries, count stock and capture invoices." action="Create account" onClick={() => onMode('signup')} />
              <Overlay show={!signin} title="Welcome back" text="Sign in with your restaurant account, or explore with a demo role: Owner, Chef or Staff." action="Sign in" onClick={() => onMode('signin')} />
            </div>
            <p className="text-xs text-white/55">Nothing reaches a supplier until a person approves it.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Panel({ id, active, side, children }: { id: AuthMode; active: boolean; side: 'left' | 'right'; children: ReactNode }) {
  return (
    <section
      data-panel={id}
      inert={!active}
      aria-hidden={!active}
      className={cx(
        'flex-col overflow-y-auto px-6 py-8 transition-opacity duration-300 sm:px-10 md:absolute md:inset-y-0 md:flex md:w-1/2',
        side === 'left' ? 'md:left-0' : 'md:right-0',
        active ? 'flex opacity-100' : 'hidden opacity-0',
      )}
    >
      <div className="my-auto w-full">{children}</div>
    </section>
  );
}

function PanelHead({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{text}</p>
    </div>
  );
}

function Switch({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <p className="mt-6 text-center text-sm text-muted md:hidden">
      {text}{' '}
      <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-400" onClick={onClick}>
        {action}
      </button>
    </p>
  );
}

function Overlay({ show, title, text, action, onClick }: { show: boolean; title: string; text: string; action: string; onClick: () => void }) {
  return (
    <div inert={!show} aria-hidden={!show} className={cx('transition-all duration-500', show ? 'relative opacity-100' : 'pointer-events-none absolute inset-0 translate-y-2 opacity-0')}>
      <h3 className="text-3xl font-bold leading-tight tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-white/75">{text}</p>
      <button type="button" onClick={onClick} className="mt-7 inline-flex h-11 items-center rounded-lg border border-white/30 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10">
        {action}
      </button>
    </div>
  );
}
