# syntax=docker/dockerfile:1

# --- Build the static SPA ---
FROM node:lts-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not ci) so the container's platform gets its own optional native
# deps — the lockfile is resolved on macOS and omits some Linux-only optionals.
# --ignore-scripts skips the `prepare` (svelte-kit sync) hook, which would fail
# here as the source isn't copied yet; `npm run build` runs the sync itself.
RUN npm install --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

# --- Serve the SPA + proxy the HA websocket (Node) ---
FROM node:lts-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY --from=build /app/build ./build
COPY server ./server
EXPOSE 8080
CMD ["node", "server/index.js"]
