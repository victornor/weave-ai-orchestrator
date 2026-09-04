# AgentConductor daemon. See docs/DOCKER.md.
#
# Stage 1 builds the monorepo (tsc -b for every package plus the Vite web app); stage 2 is a slim
# runtime carrying only what the daemon needs at run time: node 22, git, gh, openspec, the built
# `dist/` output and the production dependency tree.

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /src

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Manifests first: the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY examples/ examples/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY scripts/ scripts/
COPY skills/ skills/
COPY templates/ templates/

RUN pnpm build \
 && pnpm --filter @agent-conductor/ui build \
 && pnpm prune --prod

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app

# git: clones and worktrees. gh: the built-in GitHub forge (PR state and merges).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg openssh-client \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# OpenSpec drives the `change` ticket flow and the Spec Explorer (PLAN §12).
RUN npm install -g @fission-ai/openspec@latest && openspec --version

COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages ./packages
COPY --from=build /src/skills ./skills
COPY --from=build /src/templates ./templates
COPY --from=build /src/package.json ./package.json

# One volume holds everything stateful: daemon config + registry + sqlite, and the workspaces.
ENV AC_CONFIG_HOME=/data/config \
    AC_SKILLS_DIR=/app/skills \
    AC_TEMPLATES_DIR=/app/templates \
    AC_UI_DIR=/app/packages/ui/dist \
    NODE_ENV=production
RUN mkdir -p /data/config /data/workspaces
VOLUME ["/data"]

EXPOSE 7433
CMD ["node", "packages/server/dist/bin.js", "--listen", "0.0.0.0:7433"]
