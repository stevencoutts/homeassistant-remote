# Design: Central HA credentials via a WebSocket proxy

**Date:** 2026-06-21
**Status:** Approved, pending implementation
**Affects:** new `server/index.js`; `Dockerfile`, `docker-compose.yml`, removes `nginx.conf`; `package.json` (runtime deps `ws`, `sirv`); client `src/lib/ha/connection.ts`, `src/routes/+page.svelte`; new `.env.example`; README + spec §7.
**Supersedes:** static-only nginx container (the 2026-06-20 docker setup) for deployed use.

## Problem

Each device must currently have the HA URL + long-lived token typed into its
setup screen and stored in `localStorage`. With a deployed container we want the
key stored **once, centrally**, so devices auto-connect — and ideally without the
token ever reaching a browser. The per-device model also inherited the browser→HA
reachability problems (raw `:8123` not reachable remotely, mixed content).

## Decision

The container runs a small **Node server** that serves the built SPA *and*
proxies the HA WebSocket with the token injected **server-side**. Browsers only
ever talk to the container; the container talks to HA on the LAN.

### Credentials
- Container env: `HA_URL` (e.g. `http://homeassistant.local:8123` or LAN IP) and
  `HA_TOKEN` (a long-lived access token).
- Provided via `docker-compose` `env_file: .env` — a host file, gitignored.
  Never committed, never baked into the image, never sent to a browser.

### The proxy (`server/index.js`)
- One Node process: `sirv` serves `build/` (with SPA fallback) and `ws` handles
  the WebSocket; both on the same HTTP server / port (default 80 in-container,
  published as `8085`).
- Proxy path: **`/api/websocket`** (same path HA uses, so the standard client
  library connects to the same origin unchanged).
- Per browser connection:
  1. Open an upstream `ws` to `HA_URL`'s `/api/websocket`.
  2. Perform HA's auth handshake upstream using `HA_TOKEN`
     (`auth_required` → `{type:'auth', access_token: HA_TOKEN}` → `auth_ok`).
  3. On the browser side, send `auth_required`, accept whatever `auth` message the
     browser sends (a dummy token — ignored), reply `auth_ok`.
  4. After both sides are authed, relay messages verbatim in both directions.
     Message IDs align because both post-auth streams start fresh.
- Lifecycle: closing either side closes the other; each browser gets its own
  upstream connection; upstream errors close the browser socket (the client
  reconnects).

### SPA boot
- The server serves `/config.json` = `{ "proxy": true }` (no secrets).
- On launch the app chooses, in order:
  1. **Per-device `localStorage` creds present** → use them (override; e.g. a LAN
     tablet talking to HA directly). 
  2. **`/config.json` says `proxy: true`** → connect to
     `ws(s)://<this-origin>/api/websocket` with a dummy token; **no setup screen**.
  3. Otherwise → the existing setup screen (`npm run dev`, or a static deploy
     without the proxy).
- The gear ⚙ still opens settings, so a device can override the proxy with its own
  URL/token, or clear back to proxy.

### Security
- No per-user auth on the proxy: anyone who can reach `:8085` can control HA —
  the same blast radius as the wall switches it replaces on a trusted LAN. **Do
  not expose the bare proxy to the internet** without fronting it (Cloudflare
  Access, basic auth, reverse-proxy auth). Documented in README + spec §7. A
  built-in shared-password gate is out of scope for v1.
- The token stays in the container environment only.

## Components & responsibilities
- `server/index.js`: static serving (sirv) + the WS auth-injecting proxy (ws).
  Pure Node; no SvelteKit. Reads `HA_URL`/`HA_TOKEN` from `process.env`.
- `connection.ts`: add `connectViaProxy()` (same-origin, dummy token) and a
  `loadAppConfig()` that fetches `/config.json`; boot order above.
- `+page.svelte`: boot uses the three-way selection.
- Docker: runtime stage = Node; `docker-compose.yml` gains `env_file`.

## Out of scope (YAGNI)
- Built-in authentication/login on the proxy.
- Multiple HA backends.
- Serving the token to the browser (explicitly rejected).

## Testing
- Unit (Node, on the proxy's handshake module): given a fake HA socket, the proxy
  authenticates upstream with `HA_TOKEN`, accepts any browser token, replies
  `auth_ok`, and relays a subsequent message both ways. (Extract the handshake/relay
  into a testable function taking two socket-like objects.)
- Unit (client): boot selection — localStorage creds win; else proxy; else setup.
- Manual: `docker compose up` with `.env`, open the app → connects with no setup
  screen; token absent from all browser traffic (verify in devtools).
