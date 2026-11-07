# syntax=docker/dockerfile:1
# NEXUS API image (TDD Section J, Deployment architecture): one container runs
# the API and the background workers (ROLE=all). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t nexus-api .

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @nexus/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @nexus/api build \
  && pnpm --filter @nexus/api deploy --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle/migrations ./drizzle/migrations
USER node
EXPOSE 4000
# Hosts without a pre-deploy step (Render's free plan) set MIGRATE_ON_START=true
# so pending migrations run before the server starts; migrations are idempotent.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_START\" = true ]; then node dist/migrate.js || exit 1; fi; exec node --enable-source-maps dist/index.js"]
