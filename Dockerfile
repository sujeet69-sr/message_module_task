# Multi-stage Dockerfile for Multi-Tenant Messaging Service

# Stage 1: Build & Compile TypeScript
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY migrations/ ./migrations/
COPY src/ ./src/

RUN npm run build

# Stage 2: Production Runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/messaging.db

# Install curl for container health check
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled files and migrations
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/

# Create directory for persistent SQLite database
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/src/server.js"]
