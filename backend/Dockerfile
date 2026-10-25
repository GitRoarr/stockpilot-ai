# StockPilot AI API: Fastify + TypeScript, run with tsx (the same way as `npm start` on Render).
# Build context: the repository root, e.g. `docker build -f backend/Dockerfile .`
# No secrets are baked in: configuration comes from the environment at run time.

FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
# Every workspace manifest is needed for `npm ci` to validate the lockfile; only the backend's packages are installed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# tsx (the TypeScript runner) is a dev dependency, as on Render (`npm ci --include=dev`).
RUN npm ci --include=dev --workspace backend --no-audit --no-fund && npm cache clean --force

# Local development: source is bind-mounted by docker-compose.dev.yml and reloaded by `tsx watch`.
FROM deps AS dev
ENV NODE_ENV=development
COPY packages/shared packages/shared
COPY backend backend
COPY templates templates
COPY data/sample-invoice data/sample-invoice
WORKDIR /app/backend
EXPOSE 8787
CMD ["npm", "run", "dev"]

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/stockpilot.db
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY backend/package.json backend/tsconfig.json backend/
COPY backend/src backend/src
COPY tsconfig.base.json ./
# Runtime files resolved from the repository root: agent template and the sample invoice used by the demo.
COPY templates templates
COPY data/sample-invoice data/sample-invoice
# The SQLite database (/data) and invoice uploads (/app/data/uploads) are volumes owned by the unprivileged user.
RUN mkdir -p /data /app/data/uploads && chown -R node:node /data /app/data
USER node
WORKDIR /app/backend
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["../node_modules/.bin/tsx", "src/index.ts"]
