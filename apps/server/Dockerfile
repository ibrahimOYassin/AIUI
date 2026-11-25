# syntax=docker/dockerfile:1
# AIUI API: the server, the first-party plugins and the code-generation runtime.
# Build from the repository root:  docker build -f apps/server/Dockerfile -t aiui-api .

FROM node:24-bookworm-slim

# Python executes generated projects when someone presses Run in the IDE.
# The anthropic package lets those runs use Claude connections.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/aiui-python \
 && /opt/aiui-python/bin/pip install --no-cache-dir anthropic

WORKDIR /app

# Dependencies first, so this layer is reused until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @aiui/server && npm cache clean --force

COPY packages/shared packages/shared
COPY apps/server/src apps/server/src
COPY plugins plugins
COPY runtime runtime
# The documentation the AI Assistant searches.
COPY README.md ./
COPY docs docs

ENV NODE_ENV=production \
    PORT=4317 \
    AIUI_DATA_DIR=/data \
    AIUI_PYTHON=/opt/aiui-python/bin/python

# The database and the secret key live in /data; mount a volume there to keep them.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 4317

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
