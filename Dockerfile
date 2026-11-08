# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/40-wirc-config.sh /docker-entrypoint.d/40-wirc-config.sh
RUN chmod +x /docker-entrypoint.d/40-wirc-config.sh

# WIRC_SERVER_URL: WebSocket URL of soju. Empty = same origin, wss://<host>/socket
# SOJU_UPSTREAM:   optional, e.g. soju.soju.svc.cluster.local:8080 — makes nginx
#                  proxy /socket and /uploads to soju itself (for setups without
#                  an ingress doing it).
# WIRC_SOURCE_URL: link to this program's source code, shown in the UI (AGPL §13).
ENV WIRC_SERVER_URL="" \
    SOJU_UPSTREAM="" \
    WIRC_SOURCE_URL=""
EXPOSE 8080
