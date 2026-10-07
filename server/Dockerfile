FROM node:24.21.0-bookworm-slim AS build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
COPY src/domain/ ../src/domain/
COPY src/ui/components.tsx ../src/ui/components.tsx
RUN npm run build

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production TZ=Europe/Berlin RUNBACK_DATA_DIR=/data RUNBACK_PORT=8080
WORKDIR /app
RUN mkdir /data && chown node:node /data /app
COPY --from=build --chown=node:node /build/server/dist/server.js ./server.js
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
