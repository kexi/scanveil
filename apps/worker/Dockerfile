FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN corepack prepare pnpm@11.8.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @scanveil/core build
RUN pnpm --filter @scanveil/github build
RUN pnpm --filter @scanveil/rag build
RUN pnpm --filter @scanveil/scanners build
RUN pnpm --filter @scanveil/worker build
RUN pnpm --filter @scanveil/worker --prod deploy --legacy /prod/worker

FROM node:24-slim AS osv-scanner

ARG OSV_SCANNER_VERSION=2.4.0
ARG OSV_SCANNER_SHA256=15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /usr/local/bin/osv-scanner "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
  && echo "${OSV_SCANNER_SHA256}  /usr/local/bin/osv-scanner" | sha256sum -c - \
  && chmod 0755 /usr/local/bin/osv-scanner

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --target /app/agy-vendor \
  google-antigravity==0.1.4 \
  pydantic==2.12.5
COPY --from=build /prod/worker/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY apps/agy-runner ./apps/agy-runner
COPY --from=osv-scanner /usr/local/bin/osv-scanner /usr/local/bin/osv-scanner
CMD ["node", "dist/index.mjs"]
