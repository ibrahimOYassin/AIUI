# syntax=docker/dockerfile:1
# AIUI web: the built React app served by nginx, which also forwards /api to the API container.
# Build from the repository root:  docker build -f apps/web/Dockerfile -t aiui-web .

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @aiui/web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @aiui/web

FROM nginx:stable-alpine
# Files in /etc/nginx/templates have ${VARIABLES} filled in from the environment at start-up.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# Where the API container is reachable from this one.
ENV AIUI_API_URL=http://api:4317
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
