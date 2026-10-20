# syntax=docker/dockerfile:1

# ── Stage 1: Build ──
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build tools if necessary for native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for efficient layer caching
COPY ui/package.json ui/package-lock.json ./ui/

WORKDIR /app/ui
RUN npm ci

# Copy database schema and source files
WORKDIR /app
COPY db/ ./db/
COPY ui/ ./ui/

# Build Nuxt 4 application
WORKDIR /app/ui
RUN npm run build

# ── Stage 2: Runner ──
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/watchsense.db \
    SCHEMA_PATH=/app/db/schema.sql \
    EXPORTS_PATH=/app/exports

# Create directories for persistent storage and grant permissions to node user
RUN mkdir -p /app/data /app/exports && chown -R node:node /app

# Copy db schema and compiled Nuxt output
COPY --from=builder /app/db /app/db
COPY --from=builder --chown=node:node /app/ui/.output /app/.output

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

VOLUME ["/app/data"]

CMD ["node", ".output/server/index.mjs"]
