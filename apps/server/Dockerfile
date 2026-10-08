# Development tags only. Release builds must supply reviewed immutable base digests.
ARG NODE_BUILD_IMAGE=node:24-bookworm-slim
ARG NODE_RUNTIME_IMAGE=node:24-bookworm-slim
FROM ${NODE_BUILD_IMAGE} AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --filter @127vaults/server --filter @127vaults/web... --frozen-lockfile

FROM dependencies AS web-build
COPY apps/web/index.html apps/web/index.html
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/style.css apps/web/style.css
COPY apps/web/src apps/web/src
COPY apps/desktop/src/item-types.ts apps/desktop/src/item-types.ts
COPY apps/desktop/src/item-browser.ts apps/desktop/src/item-browser.ts
COPY packages/ui/src packages/ui/src
COPY apps/extension/src/passkeys.mjs apps/extension/src/passkeys.mjs
RUN pnpm --filter @127vaults/web build

FROM ${NODE_RUNTIME_IMAGE} AS runtime
WORKDIR /app
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/server/node_modules /app/apps/server/node_modules
COPY apps/server/src apps/server/src
COPY apps/server/admin apps/server/admin
COPY packages/sync/src packages/sync/src
COPY apps/server/wasm-auth apps/server/wasm-auth
COPY --from=web-build /app/apps/web/dist apps/web/dist
COPY apps/web/mvp.html apps/web/mvp.html
COPY apps/web/style.css apps/web/style.css
COPY apps/web/src/private-vault-client.mjs apps/web/src/private-vault-client.mjs
COPY apps/web/mvp-client.mjs apps/web/mvp-client.mjs
COPY apps/extension/src/passkeys.mjs apps/extension/src/passkeys.mjs
COPY apps/web/wasm apps/web/wasm
USER node
EXPOSE 12780
CMD ["node", "apps/server/src/entry.mjs", "serve"]
