import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bot, ChartLine, ChefHat, Eye, EyeOff, Loader2, LogIn, PackageCheck, Receipt, ShoppingCart, UserRound } from 'lucide-react';
import { api, post } from '../api/client';
import { ThemeMenu } from '../components/Layout';
import { Button, cx, Field, inputCls, LogoMark } from '../components/ui';

// One-click sample accounts, shown only when the server runs in demo mode (/api/health → demoMode).
const DEMO_PASSWORD = 'harborvine2026';
const ROLES = [
  { role: 'Owner', email: 'sara@harborvine.com', icon: UserRound, can: 'Settings, policy and every approval' },
  { role: 'Chef', email: 'daniel@harborvine.com', icon: ChefHat, can: 'Plans and approves orders, disputes' },
  { role: 'Staff', email: 'leo@harborvine.com', icon: PackageCheck, can: 'Receives deliveries and invoices' },
] as const;

const AGENTS = [
  [Bot, 'Pilot', 'Runs the morning plan and coordinates the team'],
  [ChartLine, 'Demand Planner', 'Forecasts dishes from sales, weather and holidays'],
  [ShoppingCart, 'Buyer', 'Optimises orders across supplier prices and minimums'],
  [Receipt, 'AP Clerk', 'Matches invoices and recovers supplier credits'],
] as const;

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn(email, password, 'form');
  };
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="brand-bg flex flex-col justify-between gap-10 px-6 py-8 text-white/80 sm:px-12 lg:py-12">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-12 w-12 rounded-lg" />
          <span className="text-base font-semibold text-white">StockPilot AI</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold leading-tight text-white sm:text-3xl">Restaurant purchasing, run by an AI team you supervise.</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/65">Four agents forecast demand, plan orders across suppliers, chase confirmations and reconcile invoices. Numbers come from tested engines; nothing reaches a supplier until you approve it.</p>
          <ul className="mt-8 hidden space-y-3 sm:block">
            {AGENTS.map(([Ico, name, role]) => (
              <li key={name} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                  <Ico aria-hidden className="h-4 w-4 text-accent" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">{name}</span>
                  <span className="block text-xs text-white/65">{role}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-xs text-white/65 sm:block">Harbor &amp; Vine Bistro · San Francisco Bay Area · USD</p>
      </section>

      <section className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute right-3 top-3">
          <ThemeMenu />
        </div>
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Welcome back to Harbor &amp; Vine Bistro.</p>
          {reset && (
            <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Data reset complete. Sign in again to continue.
            </p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email">
              <input className={cx(inputCls, 'h-9')} type="email" autoComplete="username" placeholder="you@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <div className="text-sm">
              <label htmlFor="password" className="mb-1 block text-xs font-medium">
                Password
              </label>
              <span className="relative block">
                <input id="password" className={cx(inputCls, 'h-9 pr-9')} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink" onClick={() => setShow(!show)}>
                  {show ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
                </button>
              </span>
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" icon={LogIn} busy={busy === 'form'} disabled={busy !== null && busy !== 'form'} className="h-9 w-full">
              Sign in
            </Button>
          </form>
          {health.data?.demoMode && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="text-xs font-medium">Try the demo</div>
              <p className="text-xs text-muted">Sign in instantly with a sample account.</p>
              <div className="mt-2.5 space-y-2">
                {ROLES.map(({ role, email: e, icon: Ico, can }) => (
                  <button
                    key={e}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => signIn(e, DEMO_PASSWORD, e)}
                    className="group flex w-full items-center gap-3 rounded-md border border-line-strong bg-card px-3 py-2 text-left shadow-card transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                      {busy === e ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Ico aria-hidden className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Continue as {role}</span>
                      <span className="block truncate text-xs text-muted">{can}</span>
                    </span>
                    <ArrowRight aria-hidden className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
