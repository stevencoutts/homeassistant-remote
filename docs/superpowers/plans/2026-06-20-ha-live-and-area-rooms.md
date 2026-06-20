# HA Live Connection + Area-Derived Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the remote to a live Home Assistant over WebSocket, derive the room list and cards from HA areas (no authored config), reflect live state, reconnect on drops, and make the controls call real HA services.

**Architecture:** Phase 1's static mock is replaced by a live `home-assistant-js-websocket` connection. A pure `deriveRooms(registries, states)` function turns HA's area/floor/device/entity registries into the existing `Room[]` shape, so the phase-1 components are reused unchanged. Registry-update events recompute rooms; `subscribeEntities` streams state. Offline/dev runs the same `deriveRooms` against a mock registries fixture, so online and offline paths are identical. Controls dispatch HA service calls when connected (debounced for continuous writes) and fall back to optimistic local mutation when offline.

**Tech Stack:** SvelteKit (static/SPA) + TypeScript, `home-assistant-js-websocket`, Vitest (added here for TDD), Vite.

## Global Constraints

- TypeScript strict mode on (`tsconfig.json` already sets `"strict": true`).
- British English in UI copy, comments and docs.
- No secrets in the repo or bundle. HA URL + long-lived token are entered at runtime and stored in `localStorage` only. `rooms.json` / `static/rooms.json` stay gitignored.
- Config-driven: a card renders only if the area has entities of that domain. Rooms derive from HA areas; `rooms.json` is an offline fixture only.
- Debounce continuous writes (~200 ms): brightness, volume, cover position.
- Reflect HA-pushed state, not optimistic-only state, when connected. Reconnect with backoff; show a clear disconnected state.
- Handle capability differences (TRV vs full thermostat, covers with/without position, unavailable/off media) — already partly in the phase-1 components; do not regress.
- Kiosk hygiene preserved (no scrollbars, no select/callout, 44 px targets, `prefers-reduced-motion`).
- Use the existing `Room`, `NamedEntity`, `EntityState`, `EntityMap` types in `src/lib/types.ts` so components need no changes.

---

### Task 1: Add Vitest + HA auth/URL storage

**Files:**
- Modify: `package.json` (add `vitest`, `home-assistant-js-websocket`, a `test` script)
- Create: `vitest.config.ts`
- Create: `src/lib/ha/auth.ts`
- Test: `src/lib/ha/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normaliseHassUrl(input: string): string` — trims, strips a trailing `/api/websocket` and trailing slash, returns the base http(s) origin (e.g. `http://homeassistant.local:8123`).
  - `loadCredentials(): { url: string; token: string } | null` — reads `localStorage` keys `room-remote:haUrl` / `room-remote:haToken`; returns null if either missing.
  - `saveCredentials(url: string, token: string): void` — normalises the url and stores both.

- [ ] **Step 1: Install dev/runtime deps**

Run:
```bash
npm i home-assistant-js-websocket
npm i -D vitest
```
Expected: both added to `package.json`, `npm install` completes.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
```

- [ ] **Step 4: Write the failing test**

`src/lib/ha/auth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { normaliseHassUrl, loadCredentials, saveCredentials } from './auth';

describe('normaliseHassUrl', () => {
  it('strips the websocket path and trailing slash', () => {
    expect(normaliseHassUrl('http://ha.local:8123/api/websocket')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('http://ha.local:8123/')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('  https://ha.local:8123  ')).toBe('https://ha.local:8123');
  });
});

describe('credential storage', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      _s: {} as Record<string, string>,
      getItem(k: string) { return this._s[k] ?? null; },
      setItem(k: string, v: string) { this._s[k] = v; },
      removeItem(k: string) { delete this._s[k]; },
      clear() { this._s = {}; }
    } as unknown as Storage;
  });

  it('returns null when nothing stored', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('round-trips and normalises the url', () => {
    saveCredentials('http://ha.local:8123/api/websocket', 'tok123');
    expect(loadCredentials()).toEqual({ url: 'http://ha.local:8123', token: 'tok123' });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- auth`
Expected: FAIL — `auth.ts` has no such exports.

- [ ] **Step 6: Implement `src/lib/ha/auth.ts`**

```ts
const URL_KEY = 'room-remote:haUrl';
const TOKEN_KEY = 'room-remote:haToken';

export function normaliseHassUrl(input: string): string {
  return input
    .trim()
    .replace(/\/api\/websocket\/?$/, '')
    .replace(/\/$/, '');
}

export function loadCredentials(): { url: string; token: string } | null {
  const url = localStorage.getItem(URL_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  if (!url || !token) return null;
  return { url, token };
}

export function saveCredentials(url: string, token: string): void {
  localStorage.setItem(URL_KEY, normaliseHassUrl(url));
  localStorage.setItem(TOKEN_KEY, token);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- auth`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/ha/auth.ts src/lib/ha/auth.test.ts
git commit -m "feat: add vitest + HA credential storage"
```

---

### Task 2: HA registry types + fetch

**Files:**
- Create: `src/lib/ha/registries.ts`
- Test: `src/lib/ha/registries.test.ts`

**Interfaces:**
- Consumes: a connection-like object with `sendMessagePromise<T>(msg): Promise<T>` and `subscribeEvents(cb, eventType): Promise<() => void>` (the `home-assistant-js-websocket` `Connection` satisfies this).
- Produces:
  - Types `AreaEntry`, `FloorEntry`, `DeviceEntry`, `EntityEntry`, `Registries` (exact fields below).
  - `fetchRegistries(conn): Promise<Registries>` — issues the four `config/*_registry/list` calls in parallel.
  - `subscribeRegistryEvents(conn, onChange: () => void): Promise<() => void>` — subscribes to the four `*_registry_updated` events; returns an unsubscribe that removes all four.

- [ ] **Step 1: Write the failing test**

`src/lib/ha/registries.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchRegistries, subscribeRegistryEvents } from './registries';

function fakeConn(lists: Record<string, unknown[]>) {
  return {
    sendMessagePromise: vi.fn(async (msg: { type: string }) => lists[msg.type] ?? []),
    subscribeEvents: vi.fn(async () => () => {})
  };
}

describe('fetchRegistries', () => {
  it('maps each list command to its registry array', async () => {
    const conn = fakeConn({
      'config/area_registry/list': [{ area_id: 'living', name: 'Living Room', icon: 'mdi:sofa', floor_id: 'ground' }],
      'config/floor_registry/list': [{ floor_id: 'ground', name: 'Ground', level: 0 }],
      'config/device_registry/list': [{ id: 'dev1', area_id: 'living' }],
      'config/entity_registry/list': [{ entity_id: 'light.living', area_id: null, device_id: 'dev1' }]
    });
    const reg = await fetchRegistries(conn as any);
    expect(reg.areas[0].name).toBe('Living Room');
    expect(reg.floors[0].level).toBe(0);
    expect(reg.devices[0].id).toBe('dev1');
    expect(reg.entities[0].entity_id).toBe('light.living');
  });
});

describe('subscribeRegistryEvents', () => {
  it('subscribes to all four registry events and unsubscribes all', async () => {
    const conn = fakeConn({});
    const unsub = await subscribeRegistryEvents(conn as any, () => {});
    expect(conn.subscribeEvents).toHaveBeenCalledTimes(4);
    unsub();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- registries`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `src/lib/ha/registries.ts`**

```ts
export interface AreaEntry {
  area_id: string;
  name: string;
  icon: string | null;
  floor_id: string | null;
}
export interface FloorEntry {
  floor_id: string;
  name: string;
  level: number | null;
}
export interface DeviceEntry {
  id: string;
  area_id: string | null;
}
export interface EntityEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  name: string | null;
  original_name: string | null;
  hidden_by: string | null;
  disabled_by: string | null;
  entity_category: string | null;
}
export interface Registries {
  areas: AreaEntry[];
  floors: FloorEntry[];
  devices: DeviceEntry[];
  entities: EntityEntry[];
}

interface ConnLike {
  sendMessagePromise<T>(msg: { type: string }): Promise<T>;
  subscribeEvents(cb: (ev: unknown) => void, eventType: string): Promise<() => void>;
}

export async function fetchRegistries(conn: ConnLike): Promise<Registries> {
  const [areas, floors, devices, entities] = await Promise.all([
    conn.sendMessagePromise<AreaEntry[]>({ type: 'config/area_registry/list' }),
    conn.sendMessagePromise<FloorEntry[]>({ type: 'config/floor_registry/list' }),
    conn.sendMessagePromise<DeviceEntry[]>({ type: 'config/device_registry/list' }),
    conn.sendMessagePromise<EntityEntry[]>({ type: 'config/entity_registry/list' })
  ]);
  return { areas, floors, devices, entities };
}

const REGISTRY_EVENTS = [
  'area_registry_updated',
  'entity_registry_updated',
  'device_registry_updated',
  'floor_registry_updated'
];

export async function subscribeRegistryEvents(
  conn: ConnLike,
  onChange: () => void
): Promise<() => void> {
  const unsubs = await Promise.all(
    REGISTRY_EVENTS.map((ev) => conn.subscribeEvents(() => onChange(), ev))
  );
  return () => unsubs.forEach((u) => u());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- registries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ha/registries.ts src/lib/ha/registries.test.ts
git commit -m "feat: fetch HA registries and subscribe to registry events"
```

---

### Task 3: `deriveRooms` + area-icon mapping (the core)

**Files:**
- Create: `src/lib/rooms/iconMap.ts`
- Create: `src/lib/rooms/derive.ts`
- Test: `src/lib/rooms/derive.test.ts`

**Interfaces:**
- Consumes: `Registries` (Task 2), `EntityMap`/`Room`/`NamedEntity` from `src/lib/types.ts`.
- Produces:
  - `mapAreaIcon(mdi: string | null): string` — maps an HA mdi icon name to an app icon key (`src/lib/icons.ts` keys), fallback `'sofa'`.
  - `deriveRooms(reg: Registries, states: EntityMap): Room[]` — the registry→rooms transform described in spec section 6.

- [ ] **Step 1: Write the failing test**

`src/lib/rooms/derive.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveRooms, mapAreaIcon } from './derive';
import type { Registries } from '$lib/ha/registries';
import type { EntityMap } from '$lib/types';

const empty: Registries = { areas: [], floors: [], devices: [], entities: [] };
const states: EntityMap = {};

function ent(entity_id: string, over: Partial<Registries['entities'][number]> = {}) {
  return {
    entity_id,
    area_id: null,
    device_id: null,
    name: null,
    original_name: null,
    hidden_by: null,
    disabled_by: null,
    entity_category: null,
    ...over
  };
}

describe('mapAreaIcon', () => {
  it('maps known mdi names and falls back', () => {
    expect(mapAreaIcon('mdi:bed')).toBe('bed');
    expect(mapAreaIcon('mdi:unknown-thing')).toBe('sofa');
    expect(mapAreaIcon(null)).toBe('sofa');
  });
});

describe('deriveRooms', () => {
  it('makes a room from an area that has a control entity, grouped by domain', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living Room', icon: 'mdi:sofa', floor_id: null }],
      entities: [
        ent('light.living_ceiling', { area_id: 'living', original_name: 'Ceiling' }),
        ent('climate.living', { area_id: 'living' }),
        ent('scene.movie', { area_id: 'living', original_name: 'Movie' })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.id).toBe('living');
    expect(room.name).toBe('Living Room');
    expect(room.icon).toBe('sofa');
    expect(room.lights).toEqual([{ name: 'Ceiling', entity: 'light.living_ceiling' }]);
    expect(room.climate).toEqual({ entity: 'climate.living' });
    expect(room.scenes).toEqual([{ name: 'Movie', entity: 'scene.movie' }]);
    expect(room.media).toBeUndefined();
    expect(room.covers).toBeUndefined();
  });

  it('inherits the area from the device when the entity has none', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'kitchen', name: 'Kitchen', icon: null, floor_id: null }],
      devices: [{ id: 'dev1', area_id: 'kitchen' }],
      entities: [ent('light.k', { device_id: 'dev1' })]
    };
    expect(deriveRooms(reg, states)[0].id).toBe('kitchen');
  });

  it('drops hidden, disabled, config and diagnostic entities', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [
        ent('light.hidden', { area_id: 'a', hidden_by: 'user' }),
        ent('light.disabled', { area_id: 'a', disabled_by: 'user' }),
        ent('sensor.diag', { area_id: 'a', entity_category: 'diagnostic' })
      ]
    };
    expect(deriveRooms(reg, states)).toEqual([]); // no visible control entity -> no room
  });

  it('skips areas with no control-domain entity (scenes alone do not count)', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [ent('scene.only', { area_id: 'a' })]
    };
    expect(deriveRooms(reg, states)).toEqual([]);
  });

  it('orders rooms by floor level then name', () => {
    const reg: Registries = {
      ...empty,
      areas: [
        { area_id: 'up', name: 'Bedroom', icon: null, floor_id: 'first' },
        { area_id: 'down_b', name: 'Study', icon: null, floor_id: 'ground' },
        { area_id: 'down_a', name: 'Lounge', icon: null, floor_id: 'ground' }
      ],
      floors: [
        { floor_id: 'ground', name: 'Ground', level: 0 },
        { floor_id: 'first', name: 'First', level: 1 }
      ],
      entities: [
        ent('light.1', { area_id: 'up' }),
        ent('light.2', { area_id: 'down_b' }),
        ent('light.3', { area_id: 'down_a' })
      ]
    };
    expect(deriveRooms(reg, states).map((r) => r.name)).toEqual(['Lounge', 'Study', 'Bedroom']);
  });

  it('names entities by precedence: registry name > friendly_name > original_name > id', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [
        ent('light.one', { area_id: 'a', name: 'Override', original_name: 'Ignored' }),
        ent('light.two', { area_id: 'a', original_name: 'Ignored' }),
        ent('light.three', { area_id: 'a', original_name: 'FromOriginal' }),
        ent('light.four', { area_id: 'a' })
      ]
    };
    const st: EntityMap = {
      'light.two': { entity_id: 'light.two', state: 'on', attributes: { friendly_name: 'FromFriendly' } }
    };
    const names = deriveRooms(reg, st)[0].lights!.map((l) => l.name).sort();
    expect(names).toEqual(['FromFriendly', 'FromOriginal', 'Override', 'light.four'].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- derive`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `src/lib/rooms/iconMap.ts`**

```ts
// HA area icons are mdi names; map the common room ones to the app's SVG icon keys.
// Unmapped icons fall back to a generic room icon. We do not bundle the full MDI set.
const MAP: Record<string, string> = {
  'mdi:sofa': 'sofa',
  'mdi:sofa-outline': 'sofa',
  'mdi:television': 'sofa',
  'mdi:silverware-fork-knife': 'kitchen',
  'mdi:fridge': 'kitchen',
  'mdi:countertop': 'kitchen',
  'mdi:bed': 'bed',
  'mdi:bed-outline': 'bed',
  'mdi:bed-king': 'bed',
  'mdi:desk': 'office',
  'mdi:briefcase': 'office',
  'mdi:monitor': 'office',
  'mdi:shower': 'bath',
  'mdi:bathtub': 'bath',
  'mdi:toilet': 'bath'
};

export function mapAreaIcon(mdi: string | null): string {
  if (!mdi) return 'sofa';
  return MAP[mdi] ?? 'sofa';
}
```

- [ ] **Step 4: Implement `src/lib/rooms/derive.ts`**

```ts
import type { Registries, EntityEntry } from '$lib/ha/registries';
import type { EntityMap, Room } from '$lib/types';
import { mapAreaIcon } from './iconMap';

const domainOf = (id: string) => id.split('.')[0];
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const NO_FLOOR = Number.MAX_SAFE_INTEGER;

export { mapAreaIcon };

export function deriveRooms(reg: Registries, states: EntityMap): Room[] {
  const deviceArea = new Map(reg.devices.map((d) => [d.id, d.area_id]));
  const floorLevel = new Map(reg.floors.map((f) => [f.floor_id, f.level ?? NO_FLOOR]));

  const areaOf = (e: EntityEntry): string | null =>
    e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) ?? null : null);

  const displayName = (e: EntityEntry): string =>
    e.name ?? states[e.entity_id]?.attributes.friendly_name ?? e.original_name ?? e.entity_id;

  // Bucket visible entities by resolved area.
  const byArea = new Map<string, EntityEntry[]>();
  for (const e of reg.entities) {
    if (e.hidden_by || e.disabled_by) continue;
    if (e.entity_category === 'config' || e.entity_category === 'diagnostic') continue;
    const area = areaOf(e);
    if (!area) continue;
    let arr = byArea.get(area);
    if (!arr) {
      arr = [];
      byArea.set(area, arr);
    }
    arr.push(e);
  }

  const rooms: (Room & { _level: number })[] = [];
  for (const area of reg.areas) {
    const ents = byArea.get(area.area_id) ?? [];
    const pick = (domain: string) =>
      ents
        .filter((e) => domainOf(e.entity_id) === domain)
        .map((e) => ({ name: displayName(e), entity: e.entity_id }))
        .sort(byName);

    const lights = pick('light');
    const scenes = pick('scene');
    const climate = pick('climate')[0];
    const media = pick('media_player')[0];
    const covers = pick('cover');

    if (!lights.length && !climate && !media && !covers.length) continue;

    const room: Room & { _level: number } = {
      id: area.area_id,
      name: area.name,
      icon: mapAreaIcon(area.icon),
      _level: area.floor_id ? floorLevel.get(area.floor_id) ?? NO_FLOOR : NO_FLOOR
    };
    if (lights.length) room.lights = lights;
    if (scenes.length) room.scenes = scenes;
    if (climate) room.climate = { entity: climate.entity };
    if (media) room.media = { entity: media.entity };
    if (covers.length) room.covers = covers;
    rooms.push(room);
  }

  rooms.sort((a, b) => a._level - b._level || byName(a, b));
  return rooms.map(({ _level, ...r }) => r);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- derive`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/iconMap.ts src/lib/rooms/derive.ts src/lib/rooms/derive.test.ts
git commit -m "feat: derive rooms and cards from HA area registries"
```

---

### Task 4: Mock registries fixture (offline path)

**Files:**
- Create: `src/lib/mock/registries.ts`
- Delete: `src/lib/mockStates.ts` (replaced)
- Test: `src/lib/mock/registries.test.ts`

**Interfaces:**
- Consumes: `Registries` (Task 2), `EntityMap` (types), `deriveRooms` (Task 3).
- Produces:
  - `mockRegistries(): Registries` — five areas (living/kitchen/bedroom/office/bath) mirroring the current demo, with floors and device-less entities.
  - `mockStates(reg: Registries): EntityMap` — HA-shaped states for every entity in the fixture (moved/retained from the old `mockStates.ts`, now keyed off the registry rather than the config file).

- [ ] **Step 1: Write the failing test**

`src/lib/mock/registries.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mockRegistries, mockStates } from './registries';
import { deriveRooms } from '$lib/rooms/derive';

describe('mock fixture', () => {
  it('derives the five demo rooms with the expected cards', () => {
    const reg = mockRegistries();
    const rooms = deriveRooms(reg, mockStates(reg));
    expect(rooms.map((r) => r.id)).toEqual(['living', 'kitchen', 'bedroom', 'office', 'bath']);

    const bath = rooms.find((r) => r.id === 'bath')!;
    expect(bath.media).toBeUndefined();
    expect(bath.covers).toBeUndefined();
    expect(bath.lights?.length).toBe(2);

    const living = rooms.find((r) => r.id === 'living')!;
    expect(living.media).toBeDefined();
    expect(living.covers?.length).toBe(1);
  });

  it('gives every entity a mock state', () => {
    const reg = mockRegistries();
    const st = mockStates(reg);
    for (const e of reg.entities) expect(st[e.entity_id]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- mock/registries`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/lib/mock/registries.ts`**

```ts
import type { Registries, EntityEntry } from '$lib/ha/registries';
import type { EntityMap } from '$lib/types';

// Offline fixture: the five demo rooms as HA-style registry entries + states.
// deriveRooms() runs against this exactly as it does against a live HA.

interface Seed {
  area: string;
  name: string;
  icon: string;
  lights: string[];
  scenes: string[];
  climate?: string;
  media?: string;
  covers?: string[];
}

const SEEDS: Seed[] = [
  {
    area: 'living', name: 'Living Room', icon: 'mdi:sofa',
    lights: ['Ceiling', 'Lamps', 'TV backlight'],
    scenes: ['Bright', 'Movie', 'Evening', 'Off'],
    climate: 'living_room', media: 'living_sonos', covers: ['Blinds']
  },
  {
    area: 'kitchen', name: 'Kitchen', icon: 'mdi:silverware-fork-knife',
    lights: ['Spots', 'Under-cabinet'],
    scenes: ['Cooking', 'Dim', 'Off'],
    climate: 'kitchen', media: 'kitchen_echo'
  },
  {
    area: 'bedroom', name: 'Bedroom', icon: 'mdi:bed',
    lights: ['Ceiling', 'Bedside L', 'Bedside R'],
    scenes: ['Wake up', 'Read', 'Night', 'Off'],
    climate: 'bedroom_trv', media: 'bedroom_homepod', covers: ['Curtains']
  },
  {
    area: 'office', name: 'Office', icon: 'mdi:desk',
    lights: ['Desk', 'Ceiling'],
    scenes: ['Focus', 'Call', 'Off'],
    climate: 'office', media: 'office_desktop', covers: ['Blinds']
  },
  {
    area: 'bath', name: 'Bathroom', icon: 'mdi:shower',
    lights: ['Main', 'Mirror'],
    scenes: ['Bright', 'Relax', 'Off'],
    climate: 'bathroom_trv'
  }
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function ent(entity_id: string, area: string, name: string | null): EntityEntry {
  return {
    entity_id,
    area_id: area,
    device_id: null,
    name: null,
    original_name: name,
    hidden_by: null,
    disabled_by: null,
    entity_category: null
  };
}

export function mockRegistries(): Registries {
  const entities: EntityEntry[] = [];
  for (const s of SEEDS) {
    s.lights.forEach((n) => entities.push(ent(`light.${s.area}_${slug(n)}`, s.area, n)));
    s.scenes.forEach((n) => entities.push(ent(`scene.${s.area}_${slug(n)}`, s.area, n)));
    if (s.climate) entities.push(ent(`climate.${s.climate}`, s.area, s.name));
    if (s.media) entities.push(ent(`media_player.${s.media}`, s.area, s.name));
    s.covers?.forEach((n) => entities.push(ent(`cover.${s.area}_${slug(n)}`, s.area, n)));
  }
  return {
    areas: SEEDS.map((s) => ({ area_id: s.area, name: s.name, icon: s.icon, floor_id: 'ground' })),
    floors: [{ floor_id: 'ground', name: 'Ground', level: 0 }],
    devices: [],
    entities
  };
}

const PCTS = [80, 45, 30, 60, 20];

export function mockStates(reg: Registries): EntityMap {
  const m: EntityMap = {};
  const put = (id: string, state: string, attributes: Record<string, any> = {}) => {
    m[id] = { entity_id: id, state, attributes };
  };
  let li = 0;
  for (const e of reg.entities) {
    const domain = e.entity_id.split('.')[0];
    const fn = e.original_name ?? e.entity_id;
    if (domain === 'light') {
      const on = li % 2 === 0;
      put(e.entity_id, on ? 'on' : 'off', {
        friendly_name: fn,
        brightness: Math.round((PCTS[li % PCTS.length] / 100) * 255),
        supported_color_modes: ['brightness']
      });
      li++;
    } else if (domain === 'scene') {
      put(e.entity_id, '2026-01-01T00:00:00+00:00', { friendly_name: fn });
    } else if (domain === 'climate') {
      const trv = /trv/.test(e.entity_id);
      put(e.entity_id, 'heat', {
        friendly_name: fn,
        temperature: 21,
        current_temperature: 21.5,
        min_temp: 5,
        max_temp: 30,
        target_temp_step: 0.5,
        hvac_modes: trv ? ['heat', 'off'] : ['heat', 'cool', 'auto', 'off']
      });
    } else if (domain === 'media_player') {
      put(e.entity_id, 'playing', {
        friendly_name: fn,
        media_title: 'Wandering Star',
        media_artist: 'Portishead',
        source: 'Sonos',
        volume_level: 0.35
      });
    } else if (domain === 'cover') {
      put(e.entity_id, 'open', { friendly_name: fn, current_position: 60 });
    }
  }
  return m;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- mock/registries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock/registries.ts src/lib/mock/registries.test.ts
git rm src/lib/mockStates.ts
git commit -m "feat: mock registries fixture for the offline path"
```

---

### Task 5: Connection layer + wire into the app

**Files:**
- Create: `src/lib/ha/connection.ts`
- Modify: `src/lib/stores.ts` (add `rooms` and `status` stores; keep `entities`, `currentRoomId`, `activeScene`)
- Modify: `src/routes/+page.svelte` (connect on mount; render from `rooms`/`status`; room-lock; connection indicator)
- Delete: `src/lib/config.ts` (no longer loads a rooms file)
- Test: manual (the connection wiring is integration; logic is covered by Tasks 2–4)

**Interfaces:**
- Consumes: `loadCredentials` (Task 1), `fetchRegistries`/`subscribeRegistryEvents` (Task 2), `deriveRooms` (Task 3), `mockRegistries`/`mockStates` (Task 4), `home-assistant-js-websocket`.
- Produces:
  - `status` store: `'connecting' | 'connected' | 'disconnected' | 'offline-mock'`.
  - `rooms` store: `Room[]`.
  - `startHa(): Promise<void>` in `connection.ts` — if no credentials, load the mock fixture into `entities`/`rooms` and set status `offline-mock`; otherwise connect with retry, `subscribeEntities` → `entities`, fetch registries + subscribe events → recompute `rooms`, and track `ready`/`disconnected` into `status`.
  - `getConnection(): Connection | null` — exposes the live connection for service calls (Task 6).

- [ ] **Step 1: Add stores**

In `src/lib/stores.ts` add (keep existing exports):
```ts
import type { Room } from './types';

export const rooms = writable<Room[]>([]);
export const status = writable<'connecting' | 'connected' | 'disconnected' | 'offline-mock'>(
  'connecting'
);
```

- [ ] **Step 2: Implement `src/lib/ha/connection.ts`**

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

let conn: Connection | null = null;
let latestStates: EntityMap = {};
let latestRegistries: Registries | null = null;

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

export async function startHa(): Promise<void> {
  const creds = loadCredentials();

  if (!creds) {
    // Offline/dev: run the same deriveRooms against the fixture.
    latestRegistries = mockRegistries();
    latestStates = mockStates(latestRegistries);
    entities.set(latestStates);
    recompute();
    status.set('offline-mock');
    return;
  }

  status.set('connecting');
  const auth = createLongLivedTokenAuth(creds.url, creds.token);
  conn = await createConnection({ auth }); // auto-reconnects with backoff

  conn.addEventListener('ready', () => status.set('connected'));
  conn.addEventListener('disconnected', () => status.set('disconnected'));
  status.set('connected');

  subscribeEntities(conn, (hass) => {
    latestStates = toEntityMap(hass);
    entities.set(latestStates);
    recompute();
  });

  latestRegistries = await fetchRegistries(conn);
  recompute();

  await subscribeRegistryEvents(conn, async () => {
    if (conn) {
      latestRegistries = await fetchRegistries(conn);
      recompute();
    }
  });
}
```

- [ ] **Step 3: Rewrite `src/routes/+page.svelte`**

Replace the `<script>` config-loading block and template so it renders from `rooms`/`status` and supports room-lock. Full file:
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { startHa } from '$lib/ha/connection';
  import { entities, currentRoomId, rooms, status } from '$lib/stores';
  import RoomNav from '$lib/components/RoomNav.svelte';
  import LightsCard from '$lib/components/LightsCard.svelte';
  import ScenesCard from '$lib/components/ScenesCard.svelte';
  import ClimateCard from '$lib/components/ClimateCard.svelte';
  import MediaCard from '$lib/components/MediaCard.svelte';
  import CoverCard from '$lib/components/CoverCard.svelte';

  let clock = '';
  let error = '';

  // Per-device room-lock: ?lock=<area_id> pins this device to one room and hides the nav.
  const lock =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lock') : null;

  onMount(async () => {
    try {
      await startHa();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      status.set('disconnected');
    }
  });

  onMount(() => {
    const tick = () =>
      (clock = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  });

  // Keep selection valid as rooms arrive; honour the lock.
  $: if (lock) {
    currentRoomId.set(lock);
  } else if ($rooms.length && !$rooms.some((r) => r.id === $currentRoomId)) {
    currentRoomId.set($rooms[0].id);
  }

  $: room = $rooms.find((r) => r.id === $currentRoomId) ?? null;

  $: sub = room ? subtitle() : '';
  function subtitle(): string {
    if (!room) return '';
    const bits: string[] = [];
    if (room.lights?.length) {
      const on = room.lights.filter((l) => $entities[l.entity]?.state === 'on').length;
      bits.push(`${on}/${room.lights.length} lights`);
    }
    if (room.climate) {
      const t = $entities[room.climate.entity]?.attributes.current_temperature;
      if (t != null) bits.push(`${t.toFixed(1)}°C`);
    }
    if (room.media) {
      const s = $entities[room.media.entity]?.state;
      if (s === 'playing' || s === 'paused') bits.push(s);
    }
    return bits.join(' · ');
  }
</script>

<div class="app">
  <header class="topbar">
    <div class="room-title">
      <div class="name">{room?.name ?? 'Room Remote'}</div>
      <div class="sub">{sub}</div>
    </div>
    <div class="clock">
      <div class="time">{clock || '--:--'}</div>
      {#if $status === 'disconnected'}<div class="meta" style="color:var(--red)">Disconnected</div>
      {:else if $status === 'connecting'}<div class="meta">Connecting…</div>{/if}
    </div>
  </header>

  <main class="cards">
    {#if room}
      {#if room.lights?.length}<LightsCard lights={room.lights} />{/if}
      {#if room.scenes?.length}<ScenesCard roomId={room.id} scenes={room.scenes} />{/if}
      {#if room.climate}<ClimateCard entity={room.climate.entity} />{/if}
      {#if room.media}<MediaCard entity={room.media.entity} />{/if}
      {#each room.covers ?? [] as cover (cover.entity)}<CoverCard {cover} />{/each}
    {/if}
  </main>

  {#if $rooms.length && !lock}
    <RoomNav rooms={$rooms} />
  {/if}
</div>

{#if error}
  <div class="overlay">Connection error: {error}<br />Check the HA URL and token.</div>
{/if}
```

- [ ] **Step 4: Delete the obsolete config loader**

Run:
```bash
git rm src/lib/config.ts
```
(`config.ts` loaded the rooms file; rooms now come from `startHa`.)

- [ ] **Step 5: Verify type-check and offline render**

Run: `npm run check`
Expected: 0 errors.

Run: `npm run dev`, open the app with **no credentials stored** (fresh `localStorage`).
Expected: status reads nothing special, the five mock rooms render exactly as in phase 1 (offline-mock path), nav switches rooms, selection persists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ha/connection.ts src/lib/stores.ts src/routes/+page.svelte
git commit -m "feat: live HA connection with offline-mock fallback and room-lock"
```

---

### Task 6: Live service calls + debounce

**Files:**
- Create: `src/lib/util/debounce.ts`
- Modify: `src/lib/services.ts` (dispatch to HA when connected; debounce continuous writes; keep optimistic local mutation for offline-mock)
- Test: `src/lib/services.test.ts`, `src/lib/util/debounce.test.ts`

**Interfaces:**
- Consumes: `getConnection` (Task 5), `home-assistant-js-websocket` `callService`, existing `entities`/`activeScene` stores.
- Produces:
  - `debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T`.
  - Pure builders, each returning `{ domain, service, data, target }`: `lightToggleCall`, `brightnessCall`, `temperatureCall`, `hvacModeCall`, `playPauseCall`, `prevCall`, `nextCall`, `volumeCall`, `coverPositionCall`, `openCoverCall`, `closeCoverCall`, `stopCoverCall`, `sceneCall`.
  - The existing exported action functions (`toggleLight`, `setLightBrightness`, …, `activateScene`) keep the same names/signatures the components already import, now routing through the builders + dispatcher.

- [ ] **Step 1: Write the debounce test**

`src/lib/util/debounce.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  it('calls once with the last args after the delay', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 200);
    d(1); d(2); d(3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledExactlyOnceWith(3);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement `src/lib/util/debounce.ts`**

```ts
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}
```

- [ ] **Step 3: Run the debounce test**

Run: `npm test -- debounce`
Expected: PASS.

- [ ] **Step 4: Write the service-builder test**

`src/lib/services.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  lightToggleCall,
  brightnessCall,
  temperatureCall,
  hvacModeCall,
  volumeCall,
  coverPositionCall,
  sceneCall
} from './services';

describe('service-call builders', () => {
  it('builds the correct HA service calls', () => {
    expect(lightToggleCall('light.x')).toEqual({
      domain: 'light', service: 'toggle', data: {}, target: { entity_id: 'light.x' }
    });
    expect(brightnessCall('light.x', 50)).toEqual({
      domain: 'light', service: 'turn_on', data: { brightness_pct: 50 }, target: { entity_id: 'light.x' }
    });
    expect(temperatureCall('climate.x', 21.5)).toEqual({
      domain: 'climate', service: 'set_temperature', data: { temperature: 21.5 }, target: { entity_id: 'climate.x' }
    });
    expect(hvacModeCall('climate.x', 'heat')).toEqual({
      domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'heat' }, target: { entity_id: 'climate.x' }
    });
    expect(volumeCall('media_player.x', 40)).toEqual({
      domain: 'media_player', service: 'volume_set', data: { volume_level: 0.4 }, target: { entity_id: 'media_player.x' }
    });
    expect(coverPositionCall('cover.x', 60)).toEqual({
      domain: 'cover', service: 'set_cover_position', data: { position: 60 }, target: { entity_id: 'cover.x' }
    });
    expect(sceneCall('scene.x')).toEqual({
      domain: 'scene', service: 'turn_on', data: {}, target: { entity_id: 'scene.x' }
    });
  });
});
```

- [ ] **Step 5: Run the builder test to verify it fails**

Run: `npm test -- services`
Expected: FAIL — builders not exported yet.

- [ ] **Step 6: Rewrite `src/lib/services.ts`**

```ts
import { callService } from 'home-assistant-js-websocket';
import { getConnection } from './ha/connection';
import { activeScene, entities } from './stores';
import { debounce } from './util/debounce';
import type { EntityState } from './types';

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target: { entity_id: string };
}

// --- Pure builders (unit-tested) ---
const call = (domain: string, service: string, entity_id: string, data: Record<string, unknown> = {}): ServiceCall => ({
  domain, service, data, target: { entity_id }
});

export const lightToggleCall = (id: string) => call('light', 'toggle', id);
export const brightnessCall = (id: string, pct: number) => call('light', 'turn_on', id, { brightness_pct: pct });
export const temperatureCall = (id: string, temperature: number) => call('climate', 'set_temperature', id, { temperature });
export const hvacModeCall = (id: string, hvac_mode: string) => call('climate', 'set_hvac_mode', id, { hvac_mode });
export const playPauseCall = (id: string) => call('media_player', 'media_play_pause', id);
export const prevCall = (id: string) => call('media_player', 'media_previous_track', id);
export const nextCall = (id: string) => call('media_player', 'media_next_track', id);
export const volumeCall = (id: string, pct: number) => call('media_player', 'volume_set', id, { volume_level: pct / 100 });
export const coverPositionCall = (id: string, position: number) => call('cover', 'set_cover_position', id, { position });
export const openCoverCall = (id: string) => call('cover', 'open_cover', id);
export const closeCoverCall = (id: string) => call('cover', 'close_cover', id);
export const stopCoverCall = (id: string) => call('cover', 'stop_cover', id);
export const sceneCall = (id: string) => call('scene', 'turn_on', id);

// --- Dispatcher: live HA when connected, optimistic local mutation when offline-mock ---
function dispatch(c: ServiceCall, optimistic?: (e: EntityState) => EntityState) {
  const conn = getConnection();
  if (conn) {
    callService(conn, c.domain, c.service, c.data, c.target);
    return; // UI follows HA-pushed state
  }
  if (optimistic) {
    entities.update((m) => {
      const e = m[c.target.entity_id];
      return e ? { ...m, [c.target.entity_id]: optimistic(e) } : m;
    });
  }
}

// --- Actions consumed by components (same names/signatures as before) ---
export function toggleLight(id: string) {
  dispatch(lightToggleCall(id), (e) => ({ ...e, state: e.state === 'on' ? 'off' : 'on' }));
}

const writeBrightness = debounce((id: string, pct: number) => dispatch(brightnessCall(id, pct)), 200);
export function setLightBrightness(id: string, pct: number) {
  // Keep the on-screen % live offline; debounce the HA write so dragging doesn't flood it.
  if (!getConnection()) {
    entities.update((m) => {
      const e = m[id];
      return e ? { ...m, [id]: { ...e, state: 'on', attributes: { ...e.attributes, brightness: Math.round((pct / 100) * 255) } } } : m;
    });
    return;
  }
  writeBrightness(id, pct);
}

export function setTemperature(id: string, temp: number) {
  dispatch(temperatureCall(id, temp), (e) => ({ ...e, attributes: { ...e.attributes, temperature: temp } }));
}
export function setHvacMode(id: string, mode: string) {
  dispatch(hvacModeCall(id, mode), (e) => ({ ...e, state: mode }));
}
export function mediaPlayPause(id: string) {
  dispatch(playPauseCall(id), (e) => ({ ...e, state: e.state === 'playing' ? 'paused' : 'playing' }));
}
export function mediaPrevious(id: string) { dispatch(prevCall(id)); }
export function mediaNext(id: string) { dispatch(nextCall(id)); }

const writeVolume = debounce((id: string, pct: number) => dispatch(volumeCall(id, pct)), 200);
export function setVolume(id: string, pct: number) {
  if (!getConnection()) {
    entities.update((m) => {
      const e = m[id];
      return e ? { ...m, [id]: { ...e, attributes: { ...e.attributes, volume_level: pct / 100 } } } : m;
    });
    return;
  }
  writeVolume(id, pct);
}

const writeCover = debounce((id: string, pos: number) => dispatch(coverPositionCall(id, pos)), 200);
export function setCoverPosition(id: string, pos: number) {
  if (!getConnection()) {
    entities.update((m) => {
      const e = m[id];
      return e ? { ...m, [id]: { ...e, state: pos > 0 ? 'open' : 'closed', attributes: { ...e.attributes, current_position: pos } } } : m;
    });
    return;
  }
  writeCover(id, pos);
}
export function openCover(id: string) { dispatch(openCoverCall(id), (e) => ({ ...e, state: 'open', attributes: { ...e.attributes, current_position: 100 } })); }
export function closeCover(id: string) { dispatch(closeCoverCall(id), (e) => ({ ...e, state: 'closed', attributes: { ...e.attributes, current_position: 0 } })); }
export function stopCover(id: string) { dispatch(stopCoverCall(id)); }

export function activateScene(roomId: string, sceneEntity: string) {
  dispatch(sceneCall(sceneEntity));
  activeScene.update((m) => ({ ...m, [roomId]: sceneEntity })); // best-effort highlight
}
```

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: PASS (auth, registries, derive, mock, debounce, services).

- [ ] **Step 8: Type-check**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/util/debounce.ts src/lib/util/debounce.test.ts src/lib/services.ts src/lib/services.test.ts
git commit -m "feat: live HA service calls with debounced continuous writes"
```

---

## Manual verification (against a real or demo HA)

These confirm the live path the unit tests can't:

1. Store credentials once in the browser console on the device:
   `localStorage.setItem('room-remote:haUrl','http://<ha-host>:8123'); localStorage.setItem('room-remote:haToken','<long-lived-token>'); location.reload();`
2. Rooms appear from your HA areas; an area with only a light shows just the Lights card.
3. Assign an entity to a different area in HA → the tab/card updates within ~1 s (registry event).
4. Toggle a light / drag brightness / step the thermostat / play-pause / volume / cover → the device performs it and the UI follows the state HA pushes back.
5. Restart HA or drop Wi-Fi → header shows “Disconnected”, then it reconnects and resumes on its own.
6. Open with `?lock=<area_id>` → nav hidden, pinned to that room.

---

## Self-Review

**Spec coverage:**
- Section 6 room derivation → Task 3 (`deriveRooms`), Task 2 (registry fetch). ✓
- Section 6 push (registry events) → Task 2 `subscribeRegistryEvents`, Task 5 wiring. ✓
- Section 6 per-device config (URL/token, room-lock, outdoor sensor) → Task 1 (creds), Task 5 (room-lock). Outdoor-sensor display is optional and deferred to phase-5 kiosk polish (header already conditionally renders it); noted, not built here.
- Spec phase 2 (connect/auth/reconnect/status) → Task 5. ✓
- Guardrail: card renders only if domain present → Task 3 + unchanged components. ✓
- Guardrail: debounce continuous writes → Task 6. ✓
- Guardrail: reflect HA-pushed state when connected → Task 6 dispatcher returns after `callService`. ✓
- Guardrail: no secrets → Task 1 (localStorage only); fixtures carry no real entity ids. ✓
- Test the state-to-UI mapping + service-call builders (CLAUDE.md) → Task 3 + Task 6. ✓

**Placeholder scan:** none — every code/test step has full content.

**Type consistency:** `Registries`/`EntityEntry` defined in Task 2 and imported in Tasks 3–5; `ServiceCall` and builder names defined in Task 6 and matched in its test; `deriveRooms`/`mockRegistries`/`mockStates`/`startHa`/`getConnection` names used consistently across tasks; output `Room`/`NamedEntity` shape matches `src/lib/types.ts` so components are untouched.

**Deferred (not gaps):** outdoor-sensor wiring and idle-dim/PWA polish remain phase 5; Playwright e2e remains phase 6.
