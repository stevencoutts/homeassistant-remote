# First-run Settings Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a device be configured in-app — enter the Home Assistant URL + long-lived token on a first-run settings screen, with an opt-in demo and a header gear to reconfigure — instead of typing into the devtools console.

**Architecture:** Split the connection layer into `connectLive()` (requires stored credentials, rejects on failure — no silent fallback), `startMock()` (the offline demo) and `disconnect()` (closes the socket + clears state). A new `Settings.svelte` overlay drives those via a `showSettings` store; `+page.svelte` decides on boot whether to connect, and adds a gear to reopen settings. Credentials stay in `localStorage` only.

**Tech Stack:** SvelteKit (static/SPA) + TypeScript, `home-assistant-js-websocket`, Svelte 5, Vitest.

## Global Constraints

- TypeScript strict mode on; British English in UI copy/comments.
- No secrets in repo or bundle — HA URL + token live only in `localStorage`; never render the stored token back into the DOM.
- Kiosk hygiene: 44px minimum touch targets; reuse the existing CSS custom properties; respect `prefers-reduced-motion`.
- Reflect HA-pushed state when connected; show a clear disconnected state.
- Do NOT change the card components (LightsCard/ScenesCard/ClimateCard/MediaCard/CoverCard/RoomNav).
- Reuse existing types in `src/lib/types.ts`.

---

### Task 1: Auth helpers + connection-layer split

**Files:**
- Modify: `src/lib/ha/auth.ts` (add `credentialsValid`, `clearCredentials`)
- Modify: `src/lib/ha/auth.test.ts` (add tests for the two helpers)
- Rewrite: `src/lib/ha/connection.ts` (`connectLive` / `startMock` / `disconnect`, replacing `startHa`)
- Create: `src/lib/ha/connection.test.ts`
- Modify: `src/lib/stores.ts` (add `showSettings`)

**Interfaces:**
- Consumes: `loadCredentials`/`saveCredentials`/`normaliseHassUrl` (existing in auth.ts); `fetchRegistries`/`subscribeRegistryEvents` (registries.ts); `deriveRooms` (rooms/derive.ts); `mockRegistries`/`mockStates` (mock/registries.ts); `entities`/`rooms`/`status` (stores.ts); `home-assistant-js-websocket`.
- Produces:
  - `credentialsValid(url: string, token: string): boolean` — both non-empty after trim.
  - `clearCredentials(): void` — removes both localStorage keys.
  - `connectLive(): Promise<void>` — throws if no stored credentials; connects, subscribes, fetches registries, sets `status`; rejects on connection/auth failure or a 10s timeout.
  - `startMock(): void` — loads the fixture, sets `status` to `'offline-mock'`.
  - `disconnect(): void` — unsubscribes, closes the socket, resets module state, clears `entities`/`rooms`, sets `status` to `'connecting'`.
  - `getConnection(): Connection | null` — unchanged.
  - `showSettings` store: `writable<boolean>`.

- [ ] **Step 1: Add the `showSettings` store**

In `src/lib/stores.ts`, after the `status` store, add:
```ts
// Drives the first-run / reconfigure settings overlay.
export const showSettings = writable<boolean>(false);
```

- [ ] **Step 2: Write the failing auth-helper tests**

Append to `src/lib/ha/auth.test.ts` (inside the existing `describe('credential storage', ...)` block, after the last test):
```ts
  it('credentialsValid requires both fields non-empty', () => {
    expect(credentialsValid('http://ha.local:8123', 'tok')).toBe(true);
    expect(credentialsValid('  ', 'tok')).toBe(false);
    expect(credentialsValid('http://ha.local:8123', '   ')).toBe(false);
    expect(credentialsValid('', '')).toBe(false);
  });

  it('clearCredentials removes both stored keys', () => {
    saveCredentials('http://ha.local:8123', 'tok');
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });
```
And update the import at the top of the file to include the new names:
```ts
import { normaliseHassUrl, loadCredentials, saveCredentials, credentialsValid, clearCredentials } from './auth';
```

- [ ] **Step 3: Run the auth tests to verify they fail**

Run: `npm test -- auth`
Expected: FAIL — `credentialsValid` / `clearCredentials` are not exported.

- [ ] **Step 4: Implement the auth helpers**

Append to `src/lib/ha/auth.ts`:
```ts
export function credentialsValid(url: string, token: string): boolean {
  return url.trim().length > 0 && token.trim().length > 0;
}

export function clearCredentials(): void {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
```

- [ ] **Step 5: Run the auth tests to verify they pass**

Run: `npm test -- auth`
Expected: PASS.

- [ ] **Step 6: Write the failing connection test**

Create `src/lib/ha/connection.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { connectLive } from './connection';

describe('connectLive', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    globalThis.localStorage = {
      getItem(k: string) { return store[k] ?? null; },
      setItem(k: string, v: string) { store[k] = v; },
      removeItem(k: string) { delete store[k]; },
      clear() { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key(i: number) { return Object.keys(store)[i] ?? null; }
    } as unknown as Storage;
  });

  it('rejects when no credentials are stored', async () => {
    await expect(connectLive()).rejects.toThrow(/credential/i);
  });
});
```

- [ ] **Step 7: Run the connection test to verify it fails**

Run: `npm test -- connection`
Expected: FAIL — `connectLive` not exported (still `startHa`).

- [ ] **Step 8: Rewrite `src/lib/ha/connection.ts`**

```ts
import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
  type HassEntities
} from 'home-assistant-js-websocket';
import { loadCredentials } from './auth';
import { fetchRegistries, subscribeRegistryEvents, type Registries } from './registries';
import { deriveRooms } from '$lib/rooms/derive';
import { mockRegistries, mockStates } from '$lib/mock/registries';
import { entities, rooms, status } from '$lib/stores';
import type { EntityMap } from '$lib/types';

const CONNECT_TIMEOUT_MS = 10000;

let conn: Connection | null = null;
let latestStates: EntityMap = {};
let latestRegistries: Registries | null = null;
let unsubEntities: (() => void) | null = null;
let unsubRegistry: (() => void) | null = null;

export function getConnection(): Connection | null {
  return conn;
}

function recompute() {
  if (latestRegistries) rooms.set(deriveRooms(latestRegistries, latestStates));
}

function toEntityMap(hass: HassEntities): EntityMap {
  // HassEntity already matches EntityState (entity_id, state, attributes).
  return hass as unknown as EntityMap;
}

// Live HA connection. Requires stored credentials; rejects on failure so the
// settings form can show the error. No offline fallback here.
export async function connectLive(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error('No credentials stored');

  status.set('connecting');
  const auth = createLongLivedTokenAuth(creds.url, creds.token);

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

// Offline demo: run the same deriveRooms against the mock fixture.
export function startMock(): void {
  latestRegistries = mockRegistries();
  latestStates = mockStates(latestRegistries);
  entities.set(latestStates);
  recompute();
  status.set('offline-mock');
}

// Tear down the live connection and reset to a pre-connection state.
export function disconnect(): void {
  unsubEntities?.();
  unsubRegistry?.();
  unsubEntities = null;
  unsubRegistry = null;
  conn?.close();
  conn = null;
  latestStates = {};
  latestRegistries = null;
  entities.set({});
  rooms.set([]);
  status.set('connecting');
}
```

- [ ] **Step 9: Run the connection test to verify it passes**

Run: `npm test -- connection`
Expected: PASS.

- [ ] **Step 10: Full suite + type-check**

Run: `npm test`
Expected: all pass (note: `+page.svelte` still imports the removed `startHa` — `npm run check` will fail until Task 3; that is expected. `npm test` does not type-check Svelte files, so it passes.)

- [ ] **Step 11: Commit**

```bash
git add src/lib/ha/auth.ts src/lib/ha/auth.test.ts src/lib/ha/connection.ts src/lib/ha/connection.test.ts src/lib/stores.ts
git commit -m "feat: split connection into connectLive/startMock/disconnect + auth helpers"
```

---

### Task 2: Settings overlay component

**Files:**
- Create: `src/lib/components/Settings.svelte`
- Test: none (Svelte component; logic delegates to Task 1's tested `credentialsValid`; the click-through is Playwright in phase 6)

**Interfaces:**
- Consumes: `loadCredentials`, `saveCredentials`, `credentialsValid`, `clearCredentials` (auth.ts); `connectLive`, `startMock`, `disconnect` (connection.ts); `showSettings` (stores.ts).
- Produces: the `Settings` Svelte component (default export), shown when `$showSettings` is true. Closes itself by setting `showSettings` to false on success.

- [ ] **Step 1: Create `src/lib/components/Settings.svelte`**

```svelte
<script lang="ts">
  import { showSettings } from '$lib/stores';
  import { loadCredentials, saveCredentials, credentialsValid, clearCredentials } from '$lib/ha/auth';
  import { connectLive, startMock, disconnect } from '$lib/ha/connection';

  const existing = loadCredentials();
  let url = $state(existing?.url ?? '');
  let token = $state(''); // never pre-fill the stored token
  let showToken = $state(false);
  let connecting = $state(false);
  let errorMsg = $state('');
  const hasCreds = existing !== null;

  async function connect() {
    if (!credentialsValid(url, token)) {
      errorMsg = 'Enter both the URL and the token.';
      return;
    }
    errorMsg = '';
    connecting = true;
    saveCredentials(url, token);
    try {
      await connectLive();
      showSettings.set(false);
    } catch {
      errorMsg = "Couldn't connect — check the URL and token.";
    } finally {
      connecting = false;
    }
  }

  function demo() {
    startMock();
    showSettings.set(false);
  }

  function clear() {
    disconnect();
    clearCredentials();
    url = '';
    token = '';
    errorMsg = '';
  }
</script>

<div class="settings-overlay">
  <div class="settings-card">
    <h1>Room Remote — Setup</h1>

    <label for="ha-url">Home Assistant URL</label>
    <input
      id="ha-url"
      type="url"
      inputmode="url"
      autocomplete="off"
      placeholder="http://homeassistant.local:8123"
      bind:value={url}
      disabled={connecting}
    />

    <label for="ha-token">Long-lived access token</label>
    <div class="token-row">
      {#if showToken}
        <input id="ha-token" type="text" autocomplete="off" bind:value={token} disabled={connecting} />
      {:else}
        <input id="ha-token" type="password" autocomplete="off" bind:value={token} disabled={connecting} />
      {/if}
      <button type="button" class="ghost" onclick={() => (showToken = !showToken)} disabled={connecting}>
        {showToken ? 'Hide' : 'Show'}
      </button>
    </div>

    {#if errorMsg}<p class="err">{errorMsg}</p>{/if}

    <button class="primary" onclick={connect} disabled={connecting}>
      {connecting ? 'Connecting…' : 'Connect'}
    </button>
    <button class="secondary" onclick={demo} disabled={connecting}>Try demo</button>

    {#if hasCreds}
      <button class="danger" onclick={clear} disabled={connecting}>Disconnect &amp; clear</button>
    {/if}
  </div>
</div>

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
  }
  .settings-card {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 24px;
  }
  h1 {
    font-size: 1.2rem;
    font-weight: 680;
    margin: 0 0 6px;
  }
  label {
    font-size: 0.82rem;
    color: var(--muted);
    margin-top: 6px;
  }
  input {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel-3);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 1rem;
  }
  input:focus {
    outline: none;
    border-color: var(--blue);
  }
  .token-row {
    display: flex;
    gap: 8px;
  }
  .token-row input {
    flex: 1;
  }
  button {
    min-height: 44px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    font-size: 0.95rem;
    cursor: pointer;
    color: var(--text);
    background: var(--panel-3);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    background: var(--blue);
    border-color: var(--blue);
    color: #06121f;
    font-weight: 600;
    margin-top: 8px;
  }
  .ghost {
    min-height: 44px;
    flex: none;
  }
  .danger {
    color: var(--red);
    border-color: var(--red);
    background: transparent;
    margin-top: 6px;
  }
  .err {
    color: var(--red);
    font-size: 0.85rem;
    margin: 2px 0 0;
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: `Settings.svelte` itself is clean. (`+page.svelte` may still report the removed `startHa` import until Task 3 — that is expected.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: add first-run settings overlay component"
```

---

### Task 3: Wire boot flow + header gear

**Files:**
- Modify: `src/lib/icons.ts` (add a `cog` icon)
- Modify: `src/routes/+page.svelte` (boot decision, gear button, mount Settings)
- Modify: `src/app.css` (gear button style)

**Interfaces:**
- Consumes: `connectLive`, `disconnect` (connection.ts — replacing `startHa`); `loadCredentials` (auth.ts); `showSettings`, `entities`, `currentRoomId`, `rooms`, `status` (stores.ts); `Settings.svelte`; `icons.cog`.
- Produces: the assembled app — settings-first boot, gear-to-reconfigure.

- [ ] **Step 1: Add the cog icon**

In `src/lib/icons.ts`, add this entry to the `icons` object (e.g. after `vol`):
```ts
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a1 1 0 0 0 .2 1.1l.1.1a1.5 1.5 0 1 1-2.1 2.1l-.1-.1a1 1 0 0 0-1.7.7v.1a1.5 1.5 0 1 1-3 0v-.1a1 1 0 0 0-1.7-.7l-.1.1a1.5 1.5 0 1 1-2.1-2.1l.1-.1a1 1 0 0 0-.7-1.7h-.1a1.5 1.5 0 1 1 0-3h.1a1 1 0 0 0 .7-1.7l-.1-.1A1.5 1.5 0 1 1 8.9 5.4l.1.1a1 1 0 0 0 1.7-.7v-.1a1.5 1.5 0 1 1 3 0v.1a1 1 0 0 0 1.7.7l.1-.1a1.5 1.5 0 1 1 2.1 2.1l-.1.1a1 1 0 0 0 .2 1.1Z"/></svg>'
```

- [ ] **Step 2: Update `src/routes/+page.svelte`**

Change the script's connection wiring. Replace the `startHa` import line:
```ts
  import { startHa } from '$lib/ha/connection';
```
with:
```ts
  import { connectLive, disconnect } from '$lib/ha/connection';
  import { loadCredentials } from '$lib/ha/auth';
  import { showSettings } from '$lib/stores';
  import Settings from '$lib/components/Settings.svelte';
  import { icons } from '$lib/icons';
```
Add `showSettings` to the existing `$lib/stores` import only if not importing it separately — to avoid a duplicate, import `showSettings` solely on the line above and keep the existing `import { entities, currentRoomId, rooms, status } from '$lib/stores';` line unchanged.

Replace the first `onMount` (the one that currently calls `startHa()`):
```ts
  onMount(async () => {
    try {
      await startHa();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      status.set('disconnected');
    }
  });
```
with:
```ts
  onMount(async () => {
    if (loadCredentials()) {
      try {
        await connectLive();
      } catch {
        disconnect();
        showSettings.set(true);
      }
    } else {
      showSettings.set(true);
    }
  });
```
Remove the now-unused `let error = '';` declaration and the `{#if error}…{/if}` error overlay block at the bottom of the file (the settings form now surfaces connection errors).

In the header, add a gear button. Change the `.clock` block in the topbar from:
```svelte
    <div class="clock">
      <div class="time">{clock || '--:--'}</div>
      {#if $status === 'disconnected'}<div class="meta" style="color:var(--red)">Disconnected</div>
      {:else if $status === 'connecting'}<div class="meta">Connecting…</div>{/if}
    </div>
```
to:
```svelte
    <div class="header-right">
      <div class="clock">
        <div class="time">{clock || '--:--'}</div>
        {#if $status === 'disconnected'}<div class="meta" style="color:var(--red)">Disconnected</div>
        {:else if $status === 'connecting'}<div class="meta">Connecting…</div>{/if}
      </div>
      <button class="gear" aria-label="Settings" onclick={() => showSettings.set(true)}>
        {@html icons.cog}
      </button>
    </div>
```
At the very end of the markup (after the closing `</div>` of `.app`), add:
```svelte
{#if $showSettings}
  <Settings />
{/if}
```

- [ ] **Step 3: Add gear styles to `src/app.css`**

Append:
```css
.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.gear {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: none;
  border: 1px solid transparent;
  color: var(--muted);
  cursor: pointer;
}
.gear:active {
  background: var(--panel-2);
}
.gear svg {
  width: 22px;
  height: 22px;
}
```

- [ ] **Step 4: Type-check, test, build**

Run: `npm run check`
Expected: 0 errors.
Run: `npm test`
Expected: all pass.
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual smoke (offline)**

Run: `npm run dev`. With a fresh `localStorage` (no creds), the **Settings screen** appears. Click "Try demo" → the five mock rooms render. Reload → Settings appears again (demo doesn't persist). Click the header gear at any time → Settings reopens.

- [ ] **Step 6: Commit**

```bash
git add src/lib/icons.ts src/routes/+page.svelte src/app.css
git commit -m "feat: settings-first boot flow with header gear"
```

---

## Manual verification (against a real HA)

1. Fresh device → Settings screen shows.
2. Enter HA base URL + a long-lived token → Connect → rooms appear; the overlay closes.
3. Reload → connects straight to the app (credentials persisted).
4. Bad token → Connect → inline "Couldn't connect…" error; overlay stays open.
5. Gear → Disconnect & clear → returns to Settings; reload stays on Settings (credentials gone).

---

## Self-Review

**Spec coverage (design doc 2026-06-20-first-run-settings-design.md):**
- Boot: creds → connect, fail → settings; no creds → settings → Task 3 onMount. ✓
- Settings screen (URL, masked token + show toggle, Connect, Try demo, inline error) → Task 2. ✓
- Reconfigure: gear always visible; Disconnect & clear when creds present → Task 2 (clear) + Task 3 (gear). ✓
- Connection split connectLive/startMock/disconnect; connectLive rejects on failure → Task 1. ✓
- `showSettings` store → Task 1. ✓
- Security: token only in localStorage, never rendered (token field starts blank) → Task 2 (`token = ''`). ✓
- Testing: connectLive rejects with no creds; validation guard (`credentialsValid`) → Task 1. ✓
- Removed silent offline-mock-on-no-creds fallback → Task 1 (connectLive has no fallback) + Task 3 (boot shows settings instead). ✓

**Placeholder scan:** none — all steps carry full code.

**Type consistency:** `connectLive`/`startMock`/`disconnect`/`getConnection` defined in Task 1 and consumed in Tasks 2–3; `credentialsValid`/`clearCredentials` defined Task 1, used Task 2; `showSettings` defined Task 1, used Tasks 2–3; `Settings` default export used Task 3; `icons.cog` added Task 3 before use. Svelte 5 runes (`$state`) used in Settings.svelte consistent with the project's Svelte 5 setup.

**Deferred (not gaps):** component-level click-through is Playwright (phase 6); the timed-out-connection background-retry edge is marked with a ponytail comment as an accepted limitation.
