# Trityanetra backend for Google Cloud Run (or any container host).
# Build:  docker build -t trityanetra-backend ./backend
# Cloud Run sets PORT; the server listens on HOST=0.0.0.0.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Run as the unprivileged "node" user that the base image provides.
USER node
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
