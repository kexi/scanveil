FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/console ./apps/console
RUN corepack prepare pnpm@11.8.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @scanveil/core build
RUN pnpm --filter @scanveil/auth build
RUN pnpm --filter @scanveil/github build
RUN pnpm --filter @scanveil/console build
RUN pnpm --filter @scanveil/console --prod deploy --legacy /prod/console

FROM node:24-slim

WORKDIR /app
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /prod/console/node_modules ./node_modules
COPY --from=build /app/apps/console/dist ./dist
CMD ["node", "dist/server/server.mjs"]
