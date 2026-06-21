# Central HA Credentials via WS Proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The container holds the HA URL + token in its environment and proxies the HA WebSocket with the token injected server-side, so devices auto-connect with the token never reaching a browser.

**Architecture:** Replace the static-only nginx runtime with a small Node server (`sirv` static + `ws` proxy). The proxy authenticates upstream to HA with `HA_TOKEN` and accepts any token from the browser. The SPA fetches `/config.json` and, if `proxy:true`, connects to the same-origin `/api/websocket` with a dummy token (per-device `localStorage` creds still override).

**Tech Stack:** Node (ESM), `ws`, `sirv`, SvelteKit static SPA, Vitest, Docker.

## Global Constraints

- TypeScript strict for client code; server is plain ESM JS. British English in copy/comments.
- The HA token lives only in the container environment — never in the repo, the image, `/config.json`, or any browser payload.
- Per-device `localStorage` credentials override the proxy; proxy is the default when `/config.json` says `proxy:true`; otherwise the setup screen.
- No built-in auth on the proxy (v1) — documented caveat: don't expose the bare proxy to the internet without fronting auth.
- Don't change `deriveRooms` or the card components.

---

### Task 1: Proxy bridge module + tests

**Files:**
- Create: `server/bridge.js`
- Test: `server/bridge.test.js`
- Modify: `package.json` (add `ws`, `sirv` to dependencies)
- Modify: `vitest.config.ts` (include `server/**/*.test.js`)

**Interfaces:**
- Produces: `bridge(browser, upstream, token)` — wires two ws-like objects (`.send(string)`, `.close()`, `.on('message'|'close'|'error', cb)`). Authenticates `upstream` to HA with `token`; mirrors the handshake to `browser` accepting any auth; queues browser→upstream messages until upstream is authed; then relays both ways.

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install ws sirv
```
Expected: `ws` and `sirv` added under `dependencies` in `package.json`.

- [ ] **Step 2: Add server tests to Vitest config**

In `vitest.config.ts`, change the `include` line:
```ts
    include: ['src/**/*.test.ts']
```
to:
```ts
    include: ['src/**/*.test.ts', 'server/**/*.test.js']
```

- [ ] **Step 3: Write the failing test**

Create `server/bridge.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { bridge } from './bridge.js';

function fakeSocket() {
  const handlers = {};
  return {
    sent: [],
    send(s) { this.sent.push(s); },
    close: vi.fn(),
    on(ev, cb) { handlers[ev] = cb; },
    emit(ev, data) { handlers[ev] && handlers[ev](data); }
  };
}

describe('bridge', () => {
  it('auths upstream with the real token and accepts any browser token', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');

    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '2025.1' }));
    expect(upstream.sent).toContain(JSON.stringify({ type: 'auth', access_token: 'REAL' }));
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_required', ha_version: '2025.1' }));

    browser.emit('message', JSON.stringify({ type: 'auth', access_token: 'dummy' }));
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_ok', ha_version: '2025.1' }));
  });

  it('queues browser commands until upstream is authed, then relays both ways', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');
    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '1' }));
    browser.emit('message', JSON.stringify({ type: 'auth' }));

    const sub = JSON.stringify({ id: 1, type: 'subscribe_entities' });
    browser.emit('message', sub);
    expect(upstream.sent).not.toContain(sub); // queued, upstream not authed yet

    upstream.emit('message', JSON.stringify({ type: 'auth_ok', ha_version: '1' }));
    expect(upstream.sent).toContain(sub); // flushed

    const evt = JSON.stringify({ id: 1, type: 'event' });
    upstream.emit('message', evt);
    expect(browser.sent).toContain(evt); // relayed downstream
  });

  it('closes both sides on auth_invalid', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'BAD');
    upstream.emit('message', JSON.stringify({ type: 'auth_required' }));
    upstream.emit('message', JSON.stringify({ type: 'auth_invalid', message: 'nope' }));
    expect(browser.close).toHaveBeenCalled();
    expect(upstream.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- bridge`
Expected: FAIL — `server/bridge.js` does not exist.

- [ ] **Step 5: Implement `server/bridge.js`**

```js
// Bridges a browser WebSocket to an upstream Home Assistant WebSocket, doing
// HA's auth handshake upstream with the real token so the token never reaches
// the browser. `browser`/`upstream` are ws-like: .send(string), .close(),
// .on('message'|'close'|'error', cb). Messages arrive as Buffer or string.
export function bridge(browser, upstream, token) {
  let upstreamAuthed = false;
  let browserAuthed = false;
  let haVersion;
  const queue = []; // browser -> upstream messages awaiting upstream auth

  upstream.on('message', (raw) => {
    const text = raw.toString();
    if (!upstreamAuthed) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.type === 'auth_required') {
        haVersion = msg.ha_version;
        upstream.send(JSON.stringify({ type: 'auth', access_token: token }));
        browser.send(JSON.stringify({ type: 'auth_required', ha_version: haVersion }));
      } else if (msg.type === 'auth_ok') {
        upstreamAuthed = true;
        while (queue.length) upstream.send(queue.shift());
      } else if (msg.type === 'auth_invalid') {
        browser.close();
        upstream.close();
      }
      return;
    }
    browser.send(text);
  });

  browser.on('message', (raw) => {
    const text = raw.toString();
    if (!browserAuthed) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.type === 'auth') {
        browserAuthed = true;
        browser.send(JSON.stringify({ type: 'auth_ok', ha_version: haVersion }));
      }
      return;
    }
    if (upstreamAuthed) upstream.send(text);
    else queue.push(text);
  });

  browser.on('close', () => upstream.close());
  upstream.on('close', () => browser.close());
  browser.on('error', () => upstream.close());
  upstream.on('error', () => browser.close());
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- bridge`
Expected: PASS (3 tests).

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/bridge.js server/bridge.test.js package.json package-lock.json vitest.config.ts
git commit -m "feat: HA websocket auth-injecting proxy bridge"
```

---

### Task 2: Node server entry (static + config + ws upgrade)

**Files:**
- Create: `server/index.js`

**Interfaces:**
- Consumes: `bridge` (Task 1), `ws`, `sirv`, env `PORT`/`HA_URL`/`HA_TOKEN`.
- Produces: a Node server that serves `build/` (SPA fallback), serves `GET /config.json` → `{ proxy: <bool> }`, and (when `HA_URL`+`HA_TOKEN` are set) proxies `ws //…/api/websocket` to HA via `bridge`.

- [ ] **Step 1: Implement `server/index.js`**

```js
import { createServer } from 'node:http';
import sirv from 'sirv';
import { WebSocketServer, WebSocket } from 'ws';
import { bridge } from './bridge.js';

const PORT = Number(process.env.PORT) || 8080;
const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;
const proxyEnabled = Boolean(HA_URL && HA_TOKEN);

const serve = sirv('build', { single: true, etag: true });

const server = createServer((req, res) => {
  if (req.url === '/config.json') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-cache');
    res.end(JSON.stringify({ proxy: proxyEnabled }));
    return;
  }
  serve(req, res);
});

if (proxyEnabled) {
  // http(s)://host:port -> ws(s)://host:port/api/websocket
  const upstreamUrl = HA_URL.replace(/\/$/, '').replace(/^http/, 'ws') + '/api/websocket';
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/api/websocket') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (browser) => {
      bridge(browser, new WebSocket(upstreamUrl), HA_TOKEN);
    });
  });
  console.log(`room-remote: proxying /api/websocket -> ${upstreamUrl}`);
} else {
  console.log('room-remote: no HA_URL/HA_TOKEN — serving static only (devices use their own setup)');
}

server.listen(PORT, () => console.log(`room-remote listening on :${PORT} (proxy ${proxyEnabled ? 'on' : 'off'})`));
```

- [ ] **Step 2: Smoke test the static + config path (no env → proxy off)**

Run (needs a build to serve):
```bash
npm run build
PORT=8099 node server/index.js &
sleep 1
curl -s localhost:8099/config.json
curl -s -o /dev/null -w "%{http_code}\n" localhost:8099/
curl -s -o /dev/null -w "%{http_code}\n" localhost:8099/some/spa/route
kill %1
```
Expected: `{"proxy":false}`; `200` for `/`; `200` for the SPA route (fallback). Console logged "serving static only".

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: node server serving SPA + /config.json + HA ws proxy"
```

---

### Task 3: Client — proxy connection + boot selection

**Files:**
- Modify: `src/lib/ha/connection.ts`
- Modify: `src/routes/+page.svelte`
- Test: `src/lib/ha/connection.test.ts` (add `loadAppConfig` cases)

**Interfaces:**
- Consumes: existing `connectLive`/`disconnect`; `home-assistant-js-websocket`; `$app/paths` `base`.
- Produces:
  - internal `connectWith(hassUrl, token)` (shared body of the live connect).
  - `connectViaProxy(): Promise<void>` — `connectWith(location.origin, 'proxy')` (token ignored by the proxy).
  - `loadAppConfig(): Promise<{ proxy: boolean }>` — fetches `${base}/config.json`; `{ proxy:false }` on any failure.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ha/connection.test.ts` (add `loadAppConfig` to the import from `./connection`):
```ts
describe('loadAppConfig', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns proxy:true when the server says so', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ proxy: true }) })) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: true });
  });

  it('returns proxy:false on non-ok or error', async () => {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: false });
    globalThis.fetch = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: false });
  });
});
```
Add `afterEach` to the vitest import at the top of the file if not present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- connection`
Expected: FAIL — `loadAppConfig` not exported.

- [ ] **Step 3: Refactor + add to `src/lib/ha/connection.ts`**

Add the import near the top:
```ts
import { base } from '$app/paths';
```
Replace the `connectLive` function with a shared `connectWith` plus the two entry points:
```ts
async function connectWith(hassUrl: string, token: string): Promise<void> {
  status.set('connecting');
  const auth = createLongLivedTokenAuth(hassUrl, token);

  // ponytail: a timed-out createConnection may keep retrying in the background
  // until the next reload; acceptable for a wrong-URL setup mistake.
  conn = await Promise.race([
    createConnection({ auth }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), CONNECT_TIMEOUT_MS)
    )
  ]);

  conn.addEventListener('ready', () => status.set('connected'));
  conn.addEventListener('disconnected', () => status.set('disconnected'));

  unsubEntities = subscribeEntities(conn, (hass) => {
    latestStates = toEntityMap(hass);
    entities.set(latestStates);
    recompute();
  });

  latestRegistries = await fetchRegistries(conn);
  recompute();
  status.set('connected');

  unsubRegistry = await subscribeRegistryEvents(conn, async () => {
    if (conn) {
      latestRegistries = await fetchRegistries(conn);
      recompute();
    }
  });
}

// Live HA connection using per-device stored credentials.
export async function connectLive(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error('No credentials stored');
  await connectWith(creds.url, creds.token);
}

// Connect through the container's same-origin proxy (token injected server-side;
// the token passed here is a placeholder the proxy ignores).
export async function connectViaProxy(): Promise<void> {
  await connectWith(window.location.origin, 'proxy');
}

// Whether the serving container provides a central proxy. No secrets in this file.
export async function loadAppConfig(): Promise<{ proxy: boolean }> {
  try {
    const res = await fetch(`${base}/config.json`, { cache: 'no-cache' });
    if (!res.ok) return { proxy: false };
    const cfg = await res.json();
    return { proxy: cfg?.proxy === true };
  } catch {
    return { proxy: false };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- connection`
Expected: PASS.

- [ ] **Step 5: Update the boot flow in `src/routes/+page.svelte`**

Change the connection import:
```ts
  import { connectLive, disconnect } from '$lib/ha/connection';
```
to:
```ts
  import { connectLive, connectViaProxy, disconnect, loadAppConfig } from '$lib/ha/connection';
```
Replace the first `onMount` (the boot one) with:
```ts
  onMount(async () => {
    // 1) Per-device credentials override everything.
    if (loadCredentials()) {
      try {
        await connectLive();
      } catch {
        disconnect();
        showSettings.set(true);
      }
      return;
    }
    // 2) Otherwise use the container's central proxy if it offers one.
    const cfg = await loadAppConfig();
    if (cfg.proxy) {
      try {
        await connectViaProxy();
      } catch {
        disconnect();
        showSettings.set(true);
      }
      return;
    }
    // 3) Otherwise ask for credentials.
    showSettings.set(true);
  });
```

- [ ] **Step 6: Verify**

Run: `npm run check` → 0 errors. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ha/connection.ts src/lib/ha/connection.test.ts src/routes/+page.svelte
git commit -m "feat: connect via central proxy when offered; localStorage still overrides"
```

---

### Task 4: Docker — Node runtime + env-based credentials

**Files:**
- Modify: `Dockerfile` (runtime stage → Node running the server)
- Modify: `docker-compose.yml` (env_file, port)
- Delete: `nginx.conf`
- Create: `.env.example`
- Modify: `.gitignore` (un-ignore `.env.example`)
- Modify: `README.md` (central-key run instructions)

**Interfaces:**
- Consumes: `server/index.js` (Task 2), the built `build/`, env `HA_URL`/`HA_TOKEN`.

- [ ] **Step 1: Rewrite the runtime stage in `Dockerfile`**

Replace the `# --- Serve the static output with nginx ---` runtime stage (from `FROM nginx:alpine AS runtime` to end of file) with:
```dockerfile
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
```

- [ ] **Step 2: Update `docker-compose.yml`**

Replace its contents with:
```yaml
services:
  room-remote:
    build: .
    image: room-remote
    container_name: room-remote
    # Central HA credentials live here only (host .env, gitignored).
    env_file:
      - path: .env
        required: false
    ports:
      - "8085:8080"
    restart: unless-stopped
```

- [ ] **Step 3: Remove the obsolete nginx config**

Run:
```bash
git rm nginx.conf
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Copy to .env (gitignored) and fill in. The container proxies HA using these;
# the token never reaches a browser. Leave unset to serve static-only (each
# device then enters its own URL/token).
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-access-token
```

- [ ] **Step 5: Un-ignore `.env.example` in `.gitignore`**

The existing `.gitignore` ignores `.env.*`. Add an exception immediately after that line:
```
.env
.env.*
!.env.example
*.token
```
(Insert `!.env.example` so the example is committable; real `.env` stays ignored.)

- [ ] **Step 6: Update `README.md`**

Replace the "Run with Docker" section body with:
```markdown
## Run with Docker

The container serves the app **and** proxies the Home Assistant WebSocket with
the token injected server-side — so devices need no setup and the token never
reaches a browser.

```bash
cp .env.example .env     # set HA_URL + HA_TOKEN (gitignored)
docker compose up -d --build   # serves on http://localhost:8085
```

`HA_URL` is reached from the *container* (e.g. your LAN `http://homeassistant.local:8123`).
Open the app and it connects automatically. A device can still override centrally
by entering its own URL/token in the gear ⚙ settings.

Leave `.env` unset to serve static-only (each device enters its own credentials).

**Security:** the proxy has no built-in login — anyone who can reach `:8085` can
control HA (the blast radius of the wall switches it replaces, on a trusted LAN).
Do not expose it to the internet without fronting it with auth (reverse-proxy
basic auth, Cloudflare Access, etc.).
```

- [ ] **Step 7: Build, run end-to-end**

Create a throwaway `.env` (or rely on existing) and:
```bash
docker compose up -d --build
sleep 2
curl -s localhost:8085/config.json
curl -s -o /dev/null -w "%{http_code}\n" localhost:8085/
```
Expected: `{"proxy":true}` if `.env` has HA_URL+HA_TOKEN (else `{"proxy":false}`); `200` for `/`. With real creds, opening the app should connect with no setup screen.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example .gitignore README.md
git commit -m "feat: container runs node server with env-based HA proxy"
```

---

## Self-Review

**Spec coverage (design doc 2026-06-21-central-key-proxy-design.md):**
- Token only in container env → Task 4 (env_file/.env), never served → `/config.json` carries only `{proxy}` (Task 2). ✓
- Proxy injects auth server-side, accepts any browser token, relays → Task 1 `bridge` + Task 2 wiring. ✓
- Proxy path `/api/websocket`, http→ws/https→wss → Task 2. ✓
- SPA boot order (localStorage → proxy → setup) → Task 3 `+page.svelte`. ✓
- Per-device override retained → Task 3 step-5 ordering + existing settings screen. ✓
- Node runtime replaces nginx; sirv SPA fallback → Task 2/4. ✓
- Security caveat documented → Task 4 README. ✓
- Tests: bridge handshake/relay/queue/auth_invalid (Task 1); loadAppConfig (Task 3). ✓

**Placeholder scan:** none — full code in every step.

**Type consistency:** `bridge(browser, upstream, token)` (Task 1) used in Task 2; `connectViaProxy`/`loadAppConfig`/`connectWith` (Task 3) consumed by `+page.svelte`; `/config.json` shape `{proxy:boolean}` consistent between server (Task 2) and client (Task 3). Server is JS (ESM) tested by Vitest via the updated `include`.

**Deferred (not gaps):** proxy login/auth (v1 relies on network/reverse proxy); end-to-end live proxy↔HA verified manually (the bridge protocol is unit-tested with a fake HA socket); Playwright covers the boot flow in phase 6.
