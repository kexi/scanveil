FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN corepack prepare pnpm@11.8.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @scanveil/core build
RUN pnpm --filter @scanveil/github build
RUN pnpm --filter @scanveil/api build
RUN pnpm --filter @scanveil/api --prod deploy --legacy /prod/api

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
CMD ["node", "dist/index.mjs"]
