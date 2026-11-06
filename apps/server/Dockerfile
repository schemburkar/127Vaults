# Development tags only. Release builds must supply reviewed immutable base digests.
ARG NODE_BUILD_IMAGE=node:24-bookworm-slim
ARG NODE_RUNTIME_IMAGE=node:24-bookworm-slim
FROM ${NODE_BUILD_IMAGE} AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --filter @127vaults/server --filter @127vaults/web... --frozen-lockfile

FROM dependencies AS server-dependencies
RUN pnpm --filter @127vaults/server deploy --prod --legacy /runtime

FROM dependencies AS web-build
COPY apps/web/index.html apps/web/index.html
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/pwa-build.mjs apps/web/pwa-build.mjs
COPY apps/web/service-worker.template.js apps/web/service-worker.template.js
COPY apps/web/public apps/web/public
COPY apps/web/mvp-client.mjs apps/web/mvp-client.mjs
COPY apps/web/src/http-client.mjs apps/web/src/http-client.mjs
COPY apps/web/src/client-errors.mjs apps/web/src/client-errors.mjs
COPY apps/web/wasm apps/web/wasm
COPY apps/web/style.css apps/web/style.css
COPY apps/web/src apps/web/src
COPY packages/domain/src packages/domain/src
COPY packages/ui/src packages/ui/src
COPY apps/extension/src/passkeys.mjs apps/extension/src/passkeys.mjs
RUN pnpm --filter @127vaults/web build

FROM ${NODE_RUNTIME_IMAGE} AS runtime-common
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-dependencies /runtime/node_modules /app/node_modules
COPY apps/server/src apps/server/src
COPY packages/sync/src packages/sync/src
COPY packages/domain/src packages/domain/src
COPY apps/server/wasm-auth apps/server/wasm-auth
COPY --from=web-build /app/apps/web/dist apps/web/dist

FROM runtime-common AS cloud-runtime
COPY apps/server/internal-cloud apps/server/internal-cloud
ENV VAULTS_OPAQUE_NODE_MODULE=/app/apps/server/wasm-auth/vaults_browser_fixture.cjs
ENV VAULTS_CLOUD_BIND=0.0.0.0
USER node
EXPOSE 8443
CMD ["node", "apps/server/internal-cloud/serve.mjs"]

FROM runtime-common AS runtime
COPY apps/server/admin apps/server/admin
COPY apps/web/mvp.html apps/web/mvp.html
COPY apps/web/style.css apps/web/style.css
COPY apps/web/src/private-vault-client.mjs apps/web/src/private-vault-client.mjs
COPY apps/web/src/pwa-replica.mjs apps/web/src/pwa-replica.mjs
COPY apps/web/src/browser-enrollment.mjs apps/web/src/browser-enrollment.mjs
COPY apps/web/src/vault-lifecycle.mjs apps/web/src/vault-lifecycle.mjs
COPY apps/web/src/signed-sync.mjs apps/web/src/signed-sync.mjs
COPY apps/web/mvp-client.mjs apps/web/mvp-client.mjs
COPY apps/web/src/http-client.mjs apps/web/src/http-client.mjs
COPY apps/web/src/client-errors.mjs apps/web/src/client-errors.mjs
COPY apps/extension/src/passkeys.mjs apps/extension/src/passkeys.mjs
COPY apps/web/wasm apps/web/wasm
USER node
EXPOSE 12780
CMD ["node", "apps/server/src/entry.mjs", "serve"]
