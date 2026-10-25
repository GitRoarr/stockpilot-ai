# StockPilot AI — Your AI Purchasing Team for Restaurants

Hire a team of four collaborating AI agents instead of a purchasing manager. **Pilot** runs the day and delegates, **Demand Planner** forecasts what the kitchen needs, **Buyer** orders it at the lowest total landed cost across suppliers and keeps suppliers on schedule, and **AP Clerk** checks every invoice against the order and the delivery and recovers credits. Humans work alongside the team on a shared task board and in threads, answer the agents' questions, approve what the owner's autonomy policy reserves for people, and see each agent's scorecard.

> Built for the Brain³ AI Automation Assignment (Full Stack AI Web Developer). The SRS and Solution Design v3.0 were approved on 2026-10-24; this code implements them.

> **Sample data:** all restaurant inventory, sales, supplier, invoice and price figures belong to a fictional San Francisco Bay Area bistro ("Harbor & Vine Bistro"), in USD. They are **not verified market data**, and forecast accuracy on this synthetic data demonstrates the pipeline, not real-world accuracy. The UI shows an "Illustrative demo data" badge while demo data is loaded.

## What it does

`forecast → plan → optimise → order → confirm with the supplier → receive → reconcile the invoice → recover credits → report savings`

| Area | Implemented |
|---|---|
| Agent team | 4 agents from versioned JSON manifests on one runtime; 24 typed tools (Zod → Gemini function declarations), ≤ 10 per agent; fork–join delegation (depth ≤ 2); `ask_human` with durable, checkpointed runs that resume exactly once after a restart; budgets (8 steps / 12 tool calls / 90 s); live run traces |
| Safety | Policy engine (manifest → never → approval-rule agreements → external-text rule → human authority → approval limits → bounded auto-send → level), decisions stored with their rule; prompt-injection boundary (`untrusted_*` fields, reduced authority); idempotent actions; numbers only from engines; numeric grounding check on AI text |
| Engines | Forecast M1–M4 with rolling-origin backtest (WAPE), prediction intervals, service-level safety stock, reorder needs with traces, FIFO expiry risk; **MILP optimiser (HiGHS/WASM)** with independent verifier, greedy fallback and a minimum-respecting baseline; invoice line matcher; three-way match; variance calculator |
| Workflow | Morning run (scheduled 06:00, idempotent per day, catch-up at start-up) · PO state machine, edits, Chef/Owner approval limits · supplier portal (signed single-document links, confirm/short/substitute/ETA) → automatic shortage replanning · one reminder then escalation on missed confirmation · receiving into stock batches · invoice photo extraction (Gemini vision) + arithmetic/plausibility checks + manual entry · disputes with portal accept/reject · savings ledger (verified vs estimated, never summed) |
| Collaboration | Hire-from-template onboarding wizard, Team page with scorecards, task board, threads on every object with @mentions, Inbox (proposals with "why", questions, agreement approvals), working agreements learned from repeated corrections and applied by the engines |
| Platform | Session auth (scrypt, HTTP-only cookie, CSRF header, login rate limit), RBAC (Owner / Chef / Staff), durable SQLite job queue, transactional email outbox, SSE live updates, audit log, demo reset and demo-clock time travel |

## Requirements

- **Node.js ≥ 22.13** (Node 24 LTS recommended; `node:sqlite` is used, no native build step)
- Google Chrome only for the browser E2E tests (`npm run e2e`)
- No paid service, cloud account or credit card. Gemini and Brevo keys are optional.

## Quick start

```bash
cp .env.example .env
# set SESSION_SECRET (required), e.g.:
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env

npm install
npm run seed          # loads the illustrative demo and prints the logins (add `-- --offline` to skip weather/holiday APIs)
npm run dev           # API http://127.0.0.1:8787 + web http://localhost:5173
```

Open http://localhost:5173 and sign in (password `harborvine2026`):

| Role | Email | Can |
|---|---|---|
| Owner | `sara@harborvine.example` | everything, autonomy policy, limits, agreements |
| Chef | `daniel@harborvine.example` | plan, approve up to $1,500, disputes |
| Staff | `leo@harborvine.example` | receive deliveries, counts, waste, invoice photos; no approvals |

**Production-style run (one port):** `npm run build && npm start` serves the API, the built web app and the supplier portal on http://127.0.0.1:8787 (set `APP_BASE_URL=http://localhost:8787` so portal links point there).

## Environment configuration

All variables are listed in [`.env.example`](.env.example). Secrets live only in `.env` (git-ignored) and are never sent to the browser or logged.

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | **yes** | ≥ 32 random characters; the API refuses to start without it |
| `DATABASE_PATH` | no | SQLite file (default `./data/stockpilot.db`) |
| `GEMINI_API_KEY` | no | Enables AI agents, AI standup text, invoice vision extraction. Empty → labelled rule-based mode |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | no | `gemini-3.8-flash` → `gemini-3.5-flash-lite` on 404/403/429 → deterministic fallback |
| `GEMINI_API_STYLE` | no | `interactions` (default, `store: false`) or `generate_content` |
| `GEMINI_MAX_RPM`, `GEMINI_DAILY_BUDGET` | no | Client-side rate limit and daily call budget |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | no | Sends PO, reminder, dispute and standup emails from a Brevo-verified sender. Empty → outbox status `not_configured`, workflow continues with portal links. `EMAIL_FROM` / `EMAIL_FROM_NAME` are still accepted as older names |
| `SUPPLIER_EMAIL_OVERRIDE` | no | Demo inbox: in `DEMO_MODE` every email to a seeded `*.example` address goes here (default: the sender address) |
| `APP_BASE_URL` | no | Base of supplier portal links (`http://localhost:5173` in dev) |
| `DEMO_MODE` | no | Enables reset workspace data and the simulated clock (Settings → Data & clock) |
| `SCHEDULER_ENABLED`, `WORKER_ENABLED` | no | Turn off the automatic morning run / the job worker |

## Deploying to Render (free web service)

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start` |
| Health check path | `/api/health` |
| Environment | `NODE_VERSION=24`, `HOST=0.0.0.0`, `NODE_ENV=production`, `SESSION_SECRET` (32+ random characters), `APP_BASE_URL=https://<service>.onrender.com`, `DEMO_MODE=true`, plus the Gemini and Brevo variables above |

Render sets `PORT`. On the first start the empty database is seeded automatically (`SEED_IF_EMPTY`). The free plan's disk is temporary: data resets to the starting restaurant when the service restarts or redeploys, and the service sleeps after about 15 minutes idle (the first request then takes a little while).

## API setup (all free, billing disabled)

| Service | Key | Setup |
|---|---|---|
| **Open-Meteo** (forecast + historical weather) | none | Works out of the box. Non-commercial use; attribution "Weather data by Open-Meteo.com" (CC BY 4.0) is shown in the UI |
| **Nager.Date** (US + `US-CA` holidays) | none | Works out of the box (v4 endpoint, v3 fallback) |
| **Google Gemini** | `GEMINI_API_KEY` | Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) on the Free Tier (no billing). Free-tier content may be used by Google to improve its products — only illustrative demo data and the restaurant's own supplier invoices are sent; no customer personal data |
| **Brevo** | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Create a free account, verify a sender address (`BREVO_SENDER_EMAIL`), create an API key (SMTP & API → API keys; transactional-email permission is enough). Set `SUPPLIER_EMAIL_OVERRIDE` to an inbox you control for the demo |

Check them with `npm run smoke` (live: Open-Meteo forecast + archive, Nager.Date; Gemini `models.get` for both models + one generation and the Brevo key when set — otherwise reported as *skipped*) or in the app under **Settings → Integrations → Test connection**.

## Database

- SQLite via Node's built-in `node:sqlite`; schema in [`apps/api/src/db/schema.sql`](apps/api/src/db/schema.sql) (applied automatically on start).
- `npm run seed` **resets** the database and loads the demo: 5 suppliers, 36 ingredients, 55 offers (19 ingredients with ≥ 2 suppliers), 14 menu items with recipes, 180 days of sales (weekday seasonality, slow trend, noise, planted −10 % rain effect), weather history from the Open-Meteo archive (synthetic and labelled `synthetic_demo` when offline), holidays, stock arranged for critical / near-expiry / shelf-capped items, 3 users, the team template deployed, and a sample invoice (`data/sample-invoice/INV-GG-20817.png`).
- The seed self-checks that the demo morning plan reproduces the approved worked example (Golden Gate order **$366.92** vs **$385.40** preferred-supplier baseline, **saving $18.48**, verified MILP) and prints the result.
- In the app: **Settings → Data & clock → Reset workspace data** (Owner, `DEMO_MODE` only).
- New optional columns are added automatically on start; for other schema changes re-run `npm run seed`.

### Entering your own data

Everything entered in **Inventory** (ingredients, stock counts and expiry, reorder levels, daily sales, suppliers, offers, dishes and recipes) is saved in SQLite and used by the next forecast, reorder plan and morning run.

**CSV import/export** (Owner or Chef):

| File | Columns | Where |
|---|---|---|
| Sales (FR-009) | `date,menuItem,qty` — completed days, dish names as on the menu | Inventory → Sales → *Import sales CSV* |
| Inventory | `name,unit,category,onHand,expiresAt,reorderLevel,shelfLifeDays,perishable` — `name` required; empty cells leave values unchanged; new ingredients need `unit` and `category` | Inventory → Ingredients → *Import CSV* / *Export CSV* |

Each import is checked first (**Preview**: accepted rows and rejected rows with the reason, nothing saved), then **Import** writes the accepted rows in one transaction, is audit-logged and refreshes the forecast or stock. Limits: 2,000 rows, 1 MB. Templates with real names from your data: *Download a template* in the import dialog. Exported cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets don't run them as formulas.

## Demo walkthrough (no keys needed)

1. **Today → Run morning plan.** Pilot delegates to Demand Planner and Buyer; watch the live trace. Without a key the run is labelled *rule-based (no_api_key)* and produces the same orders.
2. **Inbox:** the Golden Gate PO — $366.92, saves $18.48. Open it: *Why this supplier?* compares with the preferred-supplier baseline. Approve.
3. Without Brevo the PO is sent via a **manual portal link** (shown on the PO). Open it in a private window, set *Chicken thigh → Confirm lower qty → 30*, send.
4. **Inbox:** Buyer replanned the 8 lb shortfall — Bay Meat Supply 1 × 10 lb $34.00 + $15.00 small-order fee = **$49.00**, waiting for approval.
5. As Staff: **Receiving → Receive** (pre-filled 30 lb), then capture the invoice with `data/sample-invoice/INV-GG-20817.png`. Without a key its recorded extraction is used (labelled). Confirm → three-way match: **price over $9.60 + short-shipped $32.50**.
6. **Disputes:** AP Clerk drafted **$42.10**. Approve & send, accept it in the dispute portal link → credited; **Savings** shows $42.10 recovered (verified) next to the optimiser saving.
7. **Team chat:** "Private party of 40 on Saturday, mostly burgers" → demand-event proposal → approve → Forecast increases. "@Buyer find a cheaper supplier for chicken thigh" in an ingredient thread → reply cites the optimiser.
8. **Settings → Data & clock → +5 h** moves the clock past a confirmation deadline → one reminder, then escalation.

## Interface

- **Themes:** Light, Dark and System (header theme menu or **Settings → Profile & appearance**). The choice is saved per browser and applied before first paint by an inline script in `apps/web/index.html`, so there is no flash of the wrong theme. All colours are CSS variables in `apps/web/src/index.css` (`--background`, `--surface`, `--primary`, `--sidebar-background`, …) that `.dark` redefines; components never hard-code light or dark colours, charts included.
- **Icons:** [Lucide](https://lucide.dev/icons/) via `lucide-react`; icon-only buttons have accessible labels and tooltips.
- **Shared components** live in `apps/web/src/components/ui.tsx` (buttons, inputs, tables, tabs, badges, dialogs and confirmations, empty/loading/error states, formatters) and `toast.tsx` (notifications).
- **Read-only data behind the newer views:** `GET /api/dashboard` also returns the latest plan (baseline vs optimised cost), supplier issues, agent activity and recent events; `GET /api/inbox` returns completed actions and supplier responses; `GET /api/team/members` lists people with workload and last activity; order and dispute details include their history and links. There is no member-invite API, so the Team page shows members read-only.

## Tests

| Command | What | Needs |
|---|---|---|
| `npm test` | 134 unit, property and API tests (Vitest, fast-check, Fastify `inject`): every SRS acceptance criterion, engines, RBAC, policy, runtime, delegation, durable questions, portal tokens, outbox, adapters with mocked `fetch`, Gemini history mapping, performance targets | nothing |
| `npm run eval` | 20 agent-eval scenarios on recorded model responses (morning, collaboration, suppliers, invoices, safety); fails on any policy violation or grounding failure. `npm run eval -- --live` runs the 16 behaviour scenarios against Gemini and reports tool-selection accuracy (the 4 that script model misbehaviour to test runtime guards are recorded-only) | nothing (`--live`: key) |
| `npm run e2e` | Builds the web app and runs Playwright in Google Chrome: the demo path (steps 1–6 above), all pages, 360 px mobile layout, data-entry forms, CSV import/export, light/dark/system theme persistence, time travel and data reset (7 tests) | Chrome |
| `npm run smoke` | Live calls to the external APIs | network (+ keys for Gemini/Brevo) |
| `npm run typecheck` / `npm run build` | TypeScript strict for API and web; Vite build | nothing |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): typecheck → tests → evals → build → browser E2E.

## Architecture

```
apps/api        Fastify + TypeScript backend
  src/engines       pure, tested: forecast (M1–M4, backtest), reorder, optimiser (MILP, verifier, greedy), matcher, variance, grounding
  src/agents        runtime (loop, checkpoints, budgets, delegation, ask-human), policy engine, manifests, 24 tools,
                    deterministic playbooks, standup briefing, LLM gateway (Interactions / generateContent / recorded)
  src/services      planning, purchase orders, portal, receiving, invoices, disputes, ledger, collaboration, onboarding, scorecards
  src/integrations  Open-Meteo, Nager.Date, Brevo
  src/jobs          durable job queue, worker, scheduler
  src/routes        REST API (/api/*), SSE (/api/events), supplier portal pages (/s/:token)
apps/web        React 19 + Vite + Tailwind 4 + TanStack Query; Recharts on the Forecast page
packages/shared Shared types
templates/      "Restaurant Purchasing Team": 4 agent manifests, default policy, schedule, onboarding tasks
evals/          Agent eval scenarios (with recorded responses) and runner
e2e/            Playwright browser tests
data/           SQLite file (git-ignored) and the sample invoice
```

Principle: **numbers in code, language in AI.** Quantities, prices, totals, variances and savings come from the engines and are verified; the model chooses tools, delegates, asks questions and writes text, and every number in AI text is checked against the facts.

## Verification status (local, 2026-10-24)

| Level | What | Status |
|---|---|---|
| **Live API** | Open-Meteo forecast + historical, Nager.Date | **Verified** (`npm run smoke`, seed, browser E2E refreshes context live) |
| **Local, end to end** | Engines, agent runtime, policy, every workflow in no-key mode, supplier portal, outbox `not_configured` path, UI | **Verified**: 134 tests, 20 recorded evals, 7 browser tests |
| **Recorded model** | AI-mode runs (delegation, tool calls, structured standup, model fallback, budget) | Verified against **recorded** Gemini responses only |
| **Mocked HTTP** | Brevo 201 / 401, Open-Meteo 500, Nager.Date v4 → v3 fallback | Verified against a stubbed `fetch` only |
| **Not verified** | Gemini Interactions and generateContent APIs, Gemini vision extraction, AP Clerk mapping suggestions, Brevo delivery | **Implemented, never run against the real service** (no keys were available). Follow the next section |

## Verifying Gemini and Brevo

Both are optional; the app stays fully usable without them. Keys go only in `.env`; restart the API after changing it.

### Gemini

1. Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) on the Free Tier (leave billing disabled). Add `GEMINI_API_KEY=…` to `.env`.
2. `npm run smoke` — expect `✓ Gemini models.get: …gemini-3.8-flash, …gemini-3.5-flash-lite` and `✓ Gemini generation (interactions): "OK"`. A `✗` shows the HTTP status (404 = model name, 403 = key/region, 429 = quota).
3. `npm run eval -- --live --only=01` (one recorded-equivalent morning run against Gemini), then `npm run eval -- --live` for all 16 behaviour scenarios. It must end with `N/N passed` (policy-violation and grounding gates apply live) and prints the tool-selection accuracy. The Free Tier limits are not published; the client limiter (`GEMINI_MAX_RPM=10`) waits between calls, so the full run takes several minutes.
4. In the app (`npm run seed && npm run dev`): **Today → Run morning plan**, then open the run (Activity). Expect the badge `AI · gemini-3.8-flash` (not `rule-based`), "model" steps with tool calls in the trace, and the standup badge `AI`. The header shows `AI n/250`.
5. Vision: **Receiving → Capture an invoice** with `data/sample-invoice/INV-GG-20817.png` for the Golden Gate order. Expect extraction mode `gemini:…` (not `recorded_sample`), no `math_error`, and after confirming, variances $9.60 + $32.50.
6. Optional: Team chat "Private party of 40 on Saturday, mostly burgers"; on an invoice with unmatched lines, **Ask AP Clerk**; a dispute's text mode shows `gemini:…`.
7. Repeat steps 2–3 with `GEMINI_API_STYLE=generate_content` to verify the second adapter.

If a run shows `rule-based (model_error | model_unavailable | rate_limited | timeout)`, the cause is in **Activity → Audit** (`run.fallback`, with the provider message) and in `GET /api/metrics`. The parts most likely to need adjustment are the tool-parameter JSON Schema (`z.toJSONSchema`, OpenAPI 3.0 target) and the Interactions step format; both are confined to `apps/api/src/agents/llm/` and `agents/tools/index.ts`.

### Brevo

1. Create a free Brevo account, **verify a sender address** (Senders & IP → Senders), and create an API key (SMTP & API → API keys). New accounts can need Brevo's activation before transactional sending (SRS risk R-14).
2. In `.env`: `BREVO_API_KEY=…`, `BREVO_SENDER_EMAIL=<verified sender>`, `BREVO_SENDER_NAME=StockPilot AI`, `SUPPLIER_EMAIL_OVERRIDE=<an inbox you read>`, keep `DEMO_MODE=true` (so no `*.example` address is ever emailed) and set `APP_BASE_URL` to the URL you will open the portal links from.
3. `npm run smoke` — expect `✓ Brevo API key: ok`. In the app, **Settings → Integrations → Email → Test connection** shows `ok`.
4. `npm run seed && npm run dev`, **Run morning plan**: two standup emails arrive in the override inbox (Owner and Chef are both redirected). **Activity → Outbox** shows them `sent`; `GET /api/emails/<id>` has the `provider_message_id`, also visible in Brevo → Transactional → Logs.
5. Approve the Golden Gate order: the outbox entry becomes `sent`, the PO shows status `sent` with channel `email`, and the email's "Confirm, short or substitute items" button opens the portal.
6. **Settings → Data & clock → +5 h**: exactly one reminder email. Run the invoice → dispute flow and approve the dispute: the credit-request email with its accept/reject link arrives.
7. Failure path (AC-090): set a wrong `BREVO_API_KEY`, restart, approve a PO → outbox `failed` with Brevo's message, a notification, and the PO stays `approved`; after fixing the key use **Resend** in the outbox.

## Limitations and not implemented

- P1 items are **not** implemented: Telegram approvals, margin alerts, documented supplier JSON API (OpenAPI), MCP server, template export. Portal JSON endpoints exist (`/api/portal/:token`) but are not documented as a public API.
- Weather effects on SF summer data: the archive has very few rain days, so M4's rain coefficient is often not eligible on real weather (the planted effect is recovered in the synthetic-weather test, AC-023).
- `waste_avoided_estimate` is not recorded: consumption is not tracked, so there is no honest basis for it yet (the ledger type and UI field exist). `time_saved_estimate` is recorded per completed morning run with its assumption shown (45 min × $30/h).
- No lint/format step in CI yet (TypeScript strict type-checking only). No formal accessibility audit.
- Partly covered P0 details (found in the requirements review): briefing opt-in is a workspace setting, not per user (FR-093); per-day weather/holiday effects are shown as the rain coefficient and context strip, not plotted per day (FR-027); integration status does not show a separate `rate-limited` state (FR-100); structured logs do not carry run IDs (NFR-OBS-1); the auto-send "no line flagged by the verifier" condition holds by construction (unverified plans cannot be drafted and edited POs below a minimum cannot be sent) rather than as a separate check (FR-066).
- The live seed plans chicken ≈ 36 lb rather than the illustrative 38.0 lb, so the demo shortfall is ≈ 6 lb; the exact 8.0 lb case is asserted in tests and the outcome ($49.00 Bay Meat order) is the same.
- Single restaurant, local SQLite, link-based supplier portal (no supplier accounts).
- Gemini Free Tier rate limits are not published; the client-side limiter and daily budget keep the app within configured bounds and fall back to rule-based mode.
