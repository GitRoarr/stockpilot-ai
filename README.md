# StockPilot AI — Your AI Purchasing Team for Restaurants

A team of four collaborating AI agents that runs a restaurant's purchasing: **Pilot** plans the day and delegates, **Demand Planner** forecasts demand, **Buyer** orders at the lowest total cost across suppliers, and **AP Clerk** checks invoices and recovers credits. People approve what matters, answer the agents' questions and work alongside them.

`forecast → optimise → order → supplier confirms → receive → match the invoice → recover credits → report savings`

Built for the Brain³ AI Automation Assignment (Full Stack AI Web Developer), from the approved SRS and Solution Design v3.0. All restaurant data is fictional (Harbor & Vine Bistro, San Francisco Bay Area, USD).

## Highlights

- **Agents:** manifests with typed tools, delegation, questions to humans, durable runs that survive restarts, budgets and live traces.
- **Safety:** a policy engine decides what needs approval; nothing reaches a supplier without it. Numbers come only from tested engines, and every number in AI-written text is checked against the facts.
- **Engines:** backtested forecasting with weather and holidays, reorder needs, a MILP optimiser (HiGHS) with a verifier, and three-way invoice matching.
- **Resilient:** works without any API key; if Gemini is unavailable, every workflow finishes on a labelled rule-based pipeline.
- **App:** light/dark themes, dashboard, inbox, orders, receiving, disputes, savings, forecast, team, CSV import/export, supplier portal, email.

## Quick start

Requires **Node.js 22.13+** (24 recommended). No paid services.

```bash
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
npm install
npm run seed     # loads the restaurant data and prints the logins
npm run dev      # web http://localhost:5173 · API http://127.0.0.1:8787
```

| Role | Email | Password |
|---|---|---|
| Owner | `sara@harborvine.com` | `harborvine2026` |
| Chef | `daniel@harborvine.com` | `harborvine2026` |
| Staff | `leo@harborvine.com` | `harborvine2026` |

Owner can do everything; Chef plans, approves up to $1,500 and handles disputes; Staff receives deliveries and uploads invoices.

## Configuration

All variables are in [`.env.example`](.env.example). Secrets live only in `.env` (git-ignored).

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | **Required.** 32+ random characters |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | AI agents, standups and invoice reading ([Google AI Studio](https://aistudio.google.com/app/apikey), free tier). Without a key: rule-based mode |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Order, standup and dispute emails from a Brevo-verified sender. Without them: portal links only |
| `SUPPLIER_EMAIL_OVERRIDE` | In `DEMO_MODE`, **every** email goes to this inbox, never to the sample addresses |
| `DEMO_MODE` | Enables the simulated clock and data reset (Settings → Data & clock) and the email redirect |
| `APP_BASE_URL` | Base URL for links in emails |
| `HOST`, `PORT`, `DATABASE_PATH`, `SEED_IF_EMPTY` | Server address, SQLite file, seeding on first start |

Weather (Open-Meteo) and holidays (Nager.Date) need no keys. Check all integrations with `npm run smoke` or **Settings → Integrations**.

## Deploy to Render (free)

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start` |
| Health check | `/api/health` |
| Environment | `NODE_VERSION=24`, `NODE_ENV=production`, `HOST=0.0.0.0`, `SESSION_SECRET`, `APP_BASE_URL=https://<service>.onrender.com`, `DEMO_MODE=true`, plus the Gemini and Brevo variables |

The first start seeds the database automatically. On the free plan data resets on restart or redeploy, and the service sleeps after about 15 idle minutes.

## Demo walkthrough

1. **Today → Run morning plan.** Pilot delegates to Demand Planner and Buyer; watch the trace.
2. **Inbox:** approve the Golden Gate order — **$366.92, saving $18.48** (*Why this supplier?* shows the comparison).
3. Open the supplier portal link from the order (or the email), confirm only **30 lb** chicken.
4. **Inbox:** the Buyer replanned the shortfall — Bay Meat Supply **$49.00**.
5. As Staff: **Receiving → Receive**, then upload `data/sample-invoice/INV-GG-20817.png` → three-way match finds **$9.60 + $32.50**.
6. **Disputes:** AP Clerk drafted **$42.10**; approve, accept it in the portal → **Savings** shows the credit.
7. **Team chat:** "Private party of 40 on Saturday" → approve the event → the forecast rises.
8. **Settings → Data & clock → +5 h:** a missed supplier confirmation triggers a reminder, then escalation.

Data you enter in **Inventory** (suppliers, offers, dishes, sales, stock) or import from CSV is used by the next plan.

## Tests

| Command | What |
|---|---|
| `npm test` | 135 unit, property and API tests, including every SRS acceptance criterion |
| `npm run eval` | 20 agent scenarios on recorded model responses (`-- --live` runs them against Gemini) |
| `npm run e2e` | 7 Playwright browser tests in Chrome |
| `npm run typecheck` / `npm run build` | Strict TypeScript and production build |

CI runs all of them on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Gemini, Brevo, Open-Meteo and Nager.Date have also been verified live.

## Project structure

```
apps/api     Fastify + TypeScript: engines, agent runtime and policy, services, integrations, jobs, REST + SSE
apps/web     React 19, Vite, Tailwind 4, TanStack Query
packages/    shared types
templates/   the "Restaurant Purchasing Team": agent manifests, policy, schedule
evals/       agent eval scenarios and runner
e2e/         browser tests
```

Principle: **numbers in code, language in AI.**

## Limitations

- P1 features are not built: Telegram approvals, margin alerts, public supplier API, MCP server, template export.
- Single restaurant, SQLite, link-based supplier portal (no supplier accounts).
- Gemini free-tier limits are unpublished; when the quota is reached the app switches to rule-based mode until it resets.
