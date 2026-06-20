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

# --- Serve the static output with nginx ---
FROM nginx:alpine AS runtime
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
