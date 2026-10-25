# StockPilot AI web app: built with Vite and served by nginx, which also proxies /api and the supplier portal (/s/)
# to the backend. Build context: the repository root, e.g. `docker build -f frontend/Dockerfile .`

FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --include=dev --workspace frontend --no-audit --no-fund && npm cache clean --force
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend

# Local development: Vite dev server with hot reload; source is bind-mounted by docker-compose.dev.yml.
FROM deps AS dev
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS build
RUN npm run build --workspace frontend

FROM nginx:1.31.6-alpine AS runtime
# Where nginx forwards API and portal requests; the compose service name by default.
ENV API_UPSTREAM=http://backend:8787
# The official image renders templates with envsubst at start-up (only ${API_UPSTREAM} is substituted).
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
