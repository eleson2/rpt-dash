# Multi-stage build: compile the web SPA and the server, then run a slim image.
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install only production deps (better-sqlite3 / duckdb native bindings included).
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=server /srv/dist ./dist
COPY --from=web /web/dist ./web
ENV WEB_DIST=/app/web
ENV DATA_DIR=/data
ENV STAGING_DIR=/data/staging
EXPOSE 3001
CMD ["node", "dist/app.js"]
