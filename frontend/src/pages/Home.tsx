import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, X } from 'lucide-react';
import { ThemeMenu } from '../components/Layout';
import { AgentAvatar } from '../components/AgentAvatar';
import { cx, Initials, LogoMark } from '../components/ui';
import { AuthDialog, type AuthMode } from './Login';

// Public homepage for signed-out visitors. "/login" and "/signup" render this same page with the auth dialog open, so
// redirects, sign-out and "?reset" keep working. Every figure in the preview is from the Harbor & Vine demo data (README walkthrough).
const WORKFLOW = ['Forecast', 'Optimise', 'Order', 'Supplier confirms', 'Receive', 'Match the invoice', 'Recover credits', 'Report savings'];

const FEATURES: [string, string][] = [
  ['Forecast ingredient demand', 'Backtested models per dish, adjusted for weather and holidays. The model with the lowest error is chosen for each dish.'],
  ['Optimise supplier orders', 'A MILP optimiser compares every supplier’s price, pack size and minimum order, and a verifier checks the plan before it is proposed.'],
  ['Track inventory risk', 'Days of cover, reorder points and expiry for every ingredient, so shortages and waste show up before service — not during it.'],
  ['Keep people in charge', 'An autonomy policy decides what needs approval. Nothing reaches a supplier until the Owner or Chef approves it.'],
  ['Supplier portal and follow-ups', 'Suppliers confirm, reduce or substitute lines by link. A missed confirmation triggers a reminder, then an escalation.'],
  ['Invoice matching and credits', 'Three-way match of order, delivery and invoice. Differences become a drafted dispute, and recovered credits count as savings.'],
];

const TEAM: [string, string, string, string[]][] = [
  ['pilot', 'Pilot', 'Purchasing lead', ['Runs the morning plan', 'Delegates to the team', 'Publishes the daily standup']],
  ['demand-planner', 'Demand Planner', 'Forecasting', ['Refreshes weather and holidays', 'Forecasts every dish', 'Records demand events']],
  ['buyer', 'Buyer', 'Ordering', ['Compares suppliers', 'Drafts purchase orders', 'Replans supplier shortfalls']],
  ['ap-clerk', 'AP Clerk', 'Accounts payable', ['Reads invoice photos', 'Runs the three-way match', 'Drafts and tracks disputes']],
];

const PRINCIPLES: [string, string][] = [
  ['Numbers in code, language in AI', 'Quantities, prices and savings come from tested engines. The AI writes the words, and every number it writes is checked against the facts.'],
  ['Works without an AI key', 'If the model is unavailable, every workflow finishes on a labelled rule-based pipeline with the same figures.'],
  ['Every action on the record', 'Agent actions pass through a policy engine and an audit trail, so you can always see why something happened.'],
];

// Same primary style as the dashboard's buttons (near-black in light mode, white in dark mode).
const brandBtn = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent text-sm font-medium text-on-accent shadow-card transition-colors hover:bg-accent-strong';
const outlineBtn = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line bg-card text-sm font-medium text-ink shadow-card transition-colors hover:bg-raised';

export function HomePage({ auth = null }: { auth?: AuthMode | null }) {
  const nav = useNavigate();
  // One dialog: "Sign in" opens its sign-in side, "Get started" its create-account side.
  const signIn = () => nav('/login');
  const getStarted = () => nav('/signup');

  return (
    <div className="brand-canvas min-h-screen text-ink">
      {/* While the sign-in dialog is open the page behind it is inert: not focusable and hidden from assistive tech. */}
      <div inert={auth !== null}>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">StockPilot AI</span>
          </Link>
          <nav aria-label="Homepage" className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a className="hover:text-ink" href="#platform">
              Platform
            </a>
            <a className="hover:text-ink" href="#team">
              AI team
            </a>
            <a className="hover:text-ink" href="#trust">
              Trust
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeMenu />
            <button type="button" onClick={signIn} className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium hover:bg-raised sm:inline-flex">
              Sign in
            </button>
            <button type="button" onClick={getStarted} className={cx(brandBtn, 'h-9 px-3.5')}>
              Get started
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="brand-grid absolute inset-0" />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 lg:pt-24">
            <span className="inline-flex items-center rounded-full border border-brand-600/25 bg-brand-50 px-3.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-400">An AI purchasing team for restaurants</span>
            <h1 className="mx-auto mt-6 max-w-5xl text-4xl font-bold leading-[1.06] tracking-tight sm:text-6xl lg:text-7xl">
              Purchasing that plans itself.
              <span className="block bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 bg-clip-text pb-1 text-transparent dark:from-brand-400 dark:via-brand-500 dark:to-brand-600">Decisions that stay yours.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Four AI agents forecast ingredient demand, compare suppliers, draft orders and reconcile invoices every morning. You approve what matters — nothing reaches a supplier without you.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={getStarted} className={cx(brandBtn, 'h-12 px-6 text-[15px]')}>
                Get started <ArrowRight aria-hidden className="h-4 w-4" />
              </button>
              <button type="button" onClick={signIn} className={cx(outlineBtn, 'h-12 px-6 text-[15px]')}>
                Sign in
              </button>
            </div>
            <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted">
              {['Human approval on every supplier order', 'Numbers from tested engines', 'Runs even without an AI key'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check aria-hidden className="h-4 w-4 text-brand-600" />
                  {t}
                </li>
              ))}
            </ul>
            <DashboardPreview />
          </div>
        </section>

        <section aria-label="Workflow" className="border-y border-line/70 bg-card/60">
          <ol className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2 px-4 py-5 text-[13px] sm:px-6">
            {WORKFLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-full border border-line bg-card px-3 py-1 font-medium shadow-card">{s}</span>
                {i < WORKFLOW.length - 1 && <ArrowRight aria-hidden className="h-3.5 w-3.5 text-brand-600" />}
              </li>
            ))}
          </ol>
        </section>

        <section id="platform" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionHead eyebrow="Platform" title="The whole purchasing loop, in one place" text="From tomorrow’s forecast to the credit on last week’s invoice — each step is handled by an engine or an agent, and each decision is yours." />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, text], i) => (
              <div key={title} className="group relative overflow-hidden rounded-2xl border border-line bg-card p-6 shadow-card transition-colors hover:border-brand-600/40">
                <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-700 to-brand-500 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="font-mono text-xs font-medium text-brand-700 dark:text-brand-400">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="team" className="scroll-mt-20 border-y border-line/70 bg-card/60">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead eyebrow="The AI team" title="Four agents, one purchasing role" text="Each agent has its own responsibilities, tools and permissions. They hand work to each other on a shared task board and ask you when a decision is yours." />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TEAM.map(([id, name, role, does]) => (
                <div key={id} className="rounded-2xl border border-line bg-card p-5 shadow-card">
                  <div className="flex items-center gap-3">
                    <AgentAvatar id={id} size="md" />
                    <div>
                      <div className="text-sm font-semibold">{name}</div>
                      <div className="text-xs text-muted">{role}</div>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-muted">
                    {does.map((d) => (
                      <li key={d} className="flex gap-2">
                        <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
              Work alongside them: message the team, <span className="font-medium text-ink">@mention</span> an agent, answer their questions and approve their proposals from one Inbox.
            </p>
          </div>
        </section>

        <section id="trust" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionHead eyebrow="Trust" title="AI that you can audit" text="Built so that a restaurant can trust it with money: the AI explains, the engines calculate, and people approve." />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-line bg-card p-6 shadow-card">
                <span aria-hidden className="block h-1 w-10 rounded-full bg-gradient-to-r from-brand-700 to-brand-500" />
                <h3 className="mt-5 text-base font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="brand-panel relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-pop sm:px-12 sm:py-20">
            <div aria-hidden className="brand-grid absolute inset-0 opacity-60" />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">See a morning of purchasing, end to end.</h2>
              <p className="mx-auto mt-4 max-w-xl text-white/75">Run the morning plan, approve an order, follow the supplier’s reply and match the invoice — with Harbor &amp; Vine Bistro’s demo data.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={getStarted} className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 text-[15px] font-medium text-brand-900 shadow-card transition-colors hover:bg-brand-50">
                  Get started <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
                <button type="button" onClick={signIn} className="inline-flex h-12 items-center rounded-lg border border-white/25 px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/10">
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <LogoMark className="h-6 w-6" />
          <span className="font-medium text-ink">StockPilot AI</span>
          <span>Illustrative demo data · Harbor &amp; Vine Bistro · San Francisco Bay Area · USD</span>
        </div>
      </footer>
      </div>

      <AuthDialog mode={auth} onMode={(m) => nav(m === 'signup' ? '/signup' : '/login', { replace: true })} onClose={() => nav('/')} />
    </div>
  );
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">{eyebrow}</div>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-muted">{text}</p>
    </div>
  );
}

const RISK: [string, string][] = [
  ['Chicken thigh, boneless', '0.4 d'],
  ['Romaine hearts', '0.5 d'],
  ['Beef patty 6 oz', '0.8 d'],
  ['Fresh basil', '0 d'],
];
const SIDEBAR = ['Today', 'Inbox', 'Orders', 'Receiving', 'Disputes', 'Forecast', 'Inventory', 'Savings'];

/** A wide, static composition of the real Today and Inbox screens, filled with the demo's documented figures. */
function DashboardPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-5xl pb-20 text-left lg:mt-20 lg:pb-28">
      <div aria-hidden className="absolute -inset-x-10 top-10 -z-10 h-3/4 rounded-[3rem] bg-gradient-to-b from-brand-500/25 via-brand-600/10 to-transparent blur-3xl" />
      <figure className="overflow-hidden rounded-2xl border border-line bg-card shadow-pop" aria-label="StockPilot AI dashboard with illustrative demo data">
        <div className="flex items-center gap-2 border-b border-line bg-raised/60 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="ml-2 text-xs font-medium text-muted">StockPilot AI · Harbor &amp; Vine Bistro</span>
        </div>
        <div className="flex">
          <aside className="hidden w-44 shrink-0 border-r border-line bg-sidebar p-3 md:block" aria-hidden>
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Operations</div>
            {SIDEBAR.map((s) => (
              <div key={s} className={cx('flex items-center rounded-lg px-2 py-1.5 text-xs', s === 'Today' ? 'bg-sidebar-active font-semibold text-ink' : 'text-muted')}>
                {s}
                {s === 'Inbox' && <span className="ml-auto rounded-full bg-ink px-1.5 text-[10px] font-semibold text-paper">5</span>}
              </div>
            ))}
          </aside>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="text-lg font-bold tracking-tight">Good morning, Sara</div>
            <div className="text-xs text-muted">Morning plan completed · 5 decisions waiting</div>
            <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Mini label="Plan saving" value="$18.48" sub="2.5% below preferred" tone="text-emerald-700" />
              <Mini label="Awaiting approval" value="$1,378.44" sub="5 purchase orders" />
              <Mini label="Critical stock" value="5" sub="under 1 day of cover" tone="text-red-700" />
              <Mini label="At risk of expiry" value="$125.62" sub="4 ingredients" tone="text-amber-700" />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
              <div className="min-w-0 rounded-xl border border-line">
                <div className="flex items-start gap-3 p-3.5">
                  <Initials name="Golden Gate Foodservice" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs font-semibold">PO-1001</span>
                      <span className="truncate text-sm font-semibold">Golden Gate Foodservice</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">Proposed by Buyer · needs chef</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold tabular-nums">$366.92</div>
                    <div className="text-xs font-medium text-emerald-700">saves $18.48</div>
                  </div>
                </div>
                <table className="w-full border-t border-line text-xs">
                  <tbody className="divide-y divide-line">
                    {[
                      ['Beef patty 6 oz', '96 each', '$145.92'],
                      ['Chicken thigh, boneless', '40 lb', '$130.00'],
                      ['Fries 3/8" frozen', '60 lb', '$66.00'],
                    ].map(([item, qty, total]) => (
                      <tr key={item}>
                        <td className="px-3.5 py-2 font-medium">{item}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted">{qty}</td>
                        <td className="px-3.5 py-2 text-right font-medium tabular-nums">{total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised/50 px-3.5 py-2.5">
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-paper">
                    <Check aria-hidden className="h-3.5 w-3.5" /> Approve &amp; send
                  </span>
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-medium">
                    <X aria-hidden className="h-3.5 w-3.5" /> Reject…
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium">
                    Why? See the run <ArrowRight aria-hidden className="h-3 w-3" />
                  </span>
                </div>
              </div>
              <div className="min-w-0 space-y-4">
                <div className="rounded-xl border border-line p-3.5">
                  <div className="text-sm font-semibold">Inventory at risk</div>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {RISK.map(([n, d]) => (
                      <li key={n} className="flex items-center justify-between gap-3">
                        <span className="truncate">{n}</span>
                        <span className="rounded bg-red-600 px-1.5 py-px text-[10px] font-semibold text-white">{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-line p-3.5">
                  <div className="text-sm font-semibold">Three-way match</div>
                  <div className="mt-1 text-xs text-muted">INV-GG-20817 · Golden Gate Foodservice</div>
                  <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-muted">Differences $9.60 + $32.50</span>
                    <span className="font-semibold text-emerald-700">Credit $42.10</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <figcaption className="border-t border-line px-4 py-2 text-[11px] text-muted">Illustrative demo data · Harbor &amp; Vine Bistro</figcaption>
      </figure>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line px-3 py-2.5">
      <div className="truncate text-[11px] font-medium text-muted">{label}</div>
      <div className={cx('mt-0.5 text-lg font-bold tabular-nums tracking-tight', tone)}>{value}</div>
      <div className="truncate text-[11px] text-muted">{sub}</div>
    </div>
  );
}
