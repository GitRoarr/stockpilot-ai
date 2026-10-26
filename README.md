# StockPilot AI — Your AI Purchasing Team for Restaurants

Four AI agents run a restaurant's purchasing: **Pilot** plans the day, **Demand Planner** forecasts demand, **Buyer** orders at the lowest total cost, and **AP Clerk** checks invoices and recovers credits. People approve what matters — nothing reaches a supplier without them.

`forecast → optimise → order → supplier confirms → receive → match the invoice → recover credits → report savings`

Built for the Brain³ AI Automation Assignment (Full Stack AI Web Developer) from the approved SRS and Solution Design v3.0. All restaurant data is fictional (Harbor & Vine Bistro, San Francisco Bay Area, USD).

## Highlights

- **Agents:** typed tools, delegation, questions to people, durable runs, live traces.
- **Safety:** a policy engine decides what needs approval; numbers come only from tested engines and every number the AI writes is checked.
- **Engines:** backtested forecasting (weather, holidays), MILP supplier optimiser (HiGHS), three-way invoice matching.
- **Resilient:** works without any API key; if Gemini is unavailable, workflows finish on a labelled rules engine.
- **App:** public homepage, sign-in and sign-up, role-based dashboard (Owner, Chef, Staff), inbox approvals, supplier portal, email, CSV import/export, light/dark themes.

## Run locally

Requires **Node.js 22.13+** (24 recommended).

```bash
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
npm install
npm run seed     # loads the restaurant data
npm run dev      # http://localhost:5173 (API on :8787)
```

Open the homepage → **Sign in → Use demo data**, or sign in with:

| Role | Email | Password | Can |
|---|---|---|---|
| Owner | `sara@harborvine.com` | `harborvine2026` | Everything, including settings and policy |
| Chef | `daniel@harborvine.com` | `harborvine2026` | Plan, approve orders up to $1,500, disputes |
| Staff | `leo@harborvine.com` | `harborvine2026` | Receive deliveries, count stock, upload invoices |

In demo mode, **Get started** lets a visitor create an account (always Staff).

## Run with Docker

```bash
cp .env.example .env               # set SESSION_SECRET (+ optional Gemini / Brevo keys)
docker compose up --build          # http://localhost:8080
docker compose logs -f             # logs
docker compose down                # stop (data kept; `down -v` deletes it)
```

nginx serves the app and forwards `/api` and the supplier portal to the backend. The SQLite database and uploads live in Docker volumes; the schema and restaurant data are created on first start, and migrations run automatically. Hot reload: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` (http://localhost:5173). If `npm run dev` is running, set `DOCKER_API_PORT` in `.env` to avoid the port clash. Docker is for local use only.

## Configuration

All variables are in [`.env.example`](.env.example); secrets live only in `.env` (git-ignored).

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | **Required**, 32+ random characters |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_API_STYLE` | AI agents, standups, invoice reading — see **Gemini** below |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Order, standup and dispute emails |
| `DEMO_MODE`, `SUPPLIER_EMAIL_OVERRIDE` | Demo clock, data reset and sign-up; every email goes to the override inbox |
| `APP_BASE_URL`, `HOST`, `PORT`, `DATABASE_PATH` | Links in emails, server address, SQLite file |

Weather (Open-Meteo) and holidays (Nager.Date) need no keys. Check integrations in **Settings → Integrations** or with `npm run smoke`.

### Gemini

- Defaults: `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite`, `GEMINI_API_STYLE=generate_content`. Both models are on the free tier and each has its own daily quota.
- Free-tier limits are **per Google Cloud project, not per key**, and daily quotas reset at **midnight Pacific** — a new key in the same project does not reset them. Your exact limits are on [AI Studio → Rate limits](https://aistudio.google.com/rate-limit).
- When a model's daily quota is used up, the app skips it until the reset and uses the other model; if both are out (or time out), workflows finish on the labelled rules engine with the same figures.
- **Settings → Integrations → Test connection** sends a real request and shows which model answered.
- The key is read only by the backend; AI output is schema-validated and every number it writes must match the engines' results.

## Deploy to Render

One web service serves the API and the built app on the same origin (no CORS needed).

Build `npm ci --include=dev && npm run build` · Start `npm run start` · Health check `/api/health` · Environment: `NODE_VERSION=24`, `NODE_ENV=production`, `HOST=0.0.0.0`, `SESSION_SECRET`, `APP_BASE_URL` (the exact `https://…onrender.com` URL of the service — email links and the secure cookie use it), `DEMO_MODE=true`, `GEMINI_API_KEY` (+ the model variables above), `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `SUPPLIER_EMAIL_OVERRIDE`.

The first start seeds the data. SQLite lives on the service's disk: on the free plan it resets on every redeploy or restart; keeping data needs a paid persistent disk mounted where `DATABASE_PATH` points.

## Demo walkthrough

1. **Today → Run morning plan** and watch the agents' trace.
2. **Inbox:** approve the Golden Gate order — **$366.92, saving $18.48** (*Why? See the run*).
3. In the supplier portal, confirm only **30 lb** chicken → the Buyer replans the shortfall (**$49.00**).
4. As Staff: **Receiving → Receive**, upload `data/sample-invoice/INV-GG-20817.png` → the match finds **$9.60 + $32.50**.
5. **Disputes:** approve the **$42.10** claim, accept it in the portal → **Savings** shows the credit.

## Tests

`npm test` (147 unit and API tests, every SRS acceptance criterion) · `npm run eval` (20 agent scenarios) · `npm run e2e` (8 browser tests) · `npm run lint` (strict compiler checks) · `npm run typecheck` · `npm run build`. CI runs them on every push.

## Project structure

```
backend/     Fastify API: engines, agent runtime, policy, services, integrations (Dockerfile)
frontend/    React 19, Vite, Tailwind 4 web app (Dockerfile, nginx config)
packages/    shared types
templates/   agent manifests, policy and schedule
evals/ e2e/  agent evals and browser tests
```

## Limitations

- Single restaurant, SQLite, link-based supplier portal (no supplier accounts).
- Not built (P1): Telegram approvals, margin alerts, public supplier API, MCP server.
- Gemini free-tier quota is limited; when it runs out the app uses the rules engine until it resets.
