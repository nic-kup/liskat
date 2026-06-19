# Build the client with Node (same toolchain we build with locally), then run
# the server with Bun, which serves the API/WebSocket and the built static client.

FROM node:22-slim AS build
WORKDIR /app
# Install workspace deps first (manifests only) for better layer caching.
COPY package.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm install
# Copy sources and build the client to packages/client/dist.
COPY . .
RUN npm run build --workspace @liskat/client

FROM oven/bun:1-slim AS runtime
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV PORT=8080
ENV LISKAT_DATA_DIR=/data
EXPOSE 8080
CMD ["bun", "packages/server/src/index.ts"]
