# Cerebro Hub — backend + panel (Node, sin dependencias).
FROM node:22-alpine

WORKDIR /app
COPY config/hub /app/hub

ENV NODE_ENV=production \
    HUB_DATA_DIR=/sistema/hub-data \
    SISTEMA_CEREBRO_DIR=/sistema \
    HUB_HOST=0.0.0.0

EXPOSE 4597

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4597/api/salud >/dev/null || exit 1

CMD ["node", "/app/hub/hub.mjs", "--port", "4597"]
