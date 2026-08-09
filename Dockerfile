# syntax=docker/dockerfile:1

# --- build stage -------------------------------------------------------------
# Compiles Vanilla Extract (.css.ts) + bundles the server with esbuild.
# Uses npm because the VE build tooling is Node-based.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# --- runtime stage -----------------------------------------------------------
# Slim Node image + git (the app shells out to git upload-pack / receive-pack
# and git log for the viewer).
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Production dependencies only.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Compiled server + stylesheet.
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Sensible in-container defaults; secrets come from the environment / .env.
ENV MINIGIT_HOST=0.0.0.0 \
    MINIGIT_PORT=4010 \
    MINIGIT_REPOS_ROOT=/srv/git \
    MINIGIT_STATIC_DIR=/app/public

EXPOSE 4010
VOLUME ["/srv/git"]

# --experimental-sqlite enables the built-in node:sqlite used by the token store.
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "dist/server.js"]
