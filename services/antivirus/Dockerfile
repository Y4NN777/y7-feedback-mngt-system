FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/antivirus/package.json services/antivirus/package.json
RUN pnpm install --frozen-lockfile --filter @y7-feedback/antivirus...
COPY services/antivirus services/antivirus
RUN pnpm --filter @y7-feedback/antivirus build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /workspace/services/antivirus/dist ./dist
EXPOSE 8080
CMD ["node", "dist/main.js"]
