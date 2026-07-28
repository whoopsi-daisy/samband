# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-alpine

# Stage 1: install dependencies (needs a toolchain for better-sqlite3)
FROM ${NODE_IMAGE} AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: build the Next.js application
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js opens the database while collecting page data. Point that throwaway
# write at /tmp so the build's empty events.db is not traced into the standalone
# output — otherwise the image would ship a stale database at the exact path the
# data volume mounts over, and a fresh named volume would be seeded from it.
ENV SAMBAND_DATA_DIR=/tmp/samband-build
RUN npm run build

# Stage 3: production image
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# tzdata: not in alpine by default, and without it Node silently falls back to
# UTC and every parsed event time shifts by 1-2 hours. See TZ below.
# su-exec: lets the entrypoint drop from root to the runtime user after fixing
# ownership of the mounted data directory.
RUN apk add --no-cache tzdata su-exec

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SAMBAND_DATA_DIR=/app/data \
    TZ=Europe/Stockholm

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# The standalone bundle carries only the modules the server actually reaches,
# so no devDependencies and no full node_modules tree end up in the image.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Mount point for the SQLite database. Owned by the runtime user so the app can
# create the WAL/SHM sidecar files next to events.db. A bind mount replaces
# this directory wholesale, which is why the entrypoint re-applies ownership at
# boot rather than trusting the image.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

# Deliberately no `USER nextjs`: the entrypoint starts as root, hands the data
# directory to uid 1001 and then execs the server as uid 1001 via su-exec. The
# server process is unprivileged either way — this only moves the step-down
# from image build time to container start, where the mount actually exists.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
