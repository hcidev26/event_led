FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Asia/Ho_Chi_Minh

WORKDIR /app

# Cai thu vien truoc de tan dung cache khi chi sua code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# Du lieu (data.json + anh/video tai len) nam trong volume /data
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/form" > /dev/null || exit 1

CMD ["node", "server.js"]
