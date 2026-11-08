# ── 1. Build du frontend ─────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ── 2. Image finale : nginx (vhost orbitos.mana) + serveur Node ──────
FROM node:22-alpine
RUN apk add --no-cache nginx tini
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY --from=web /app/web/dist ./web/dist
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data /run/nginx

ARG ORBIT_COMMIT=dev
LABEL org.opencontainers.image.title="OrbitOS" \
      org.opencontainers.image.source="https://github.com/Maanaaa/orbitos" \
      org.opencontainers.image.revision="${ORBIT_COMMIT}"
ENV NODE_ENV=production \
    ORBIT_COMMIT=${ORBIT_COMMIT} \
    ORBIT_DATA=/data \
    ORBIT_SSH_DIR=/ssh \
    PORT=4000 \
    HOST=127.0.0.1 \
    ORBIT_HOSTS=orbitos.mana,localhost,127.0.0.1

VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- --header "Host: ${ORBIT_HOSTS%%,*}" http://127.0.0.1/api/session >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
