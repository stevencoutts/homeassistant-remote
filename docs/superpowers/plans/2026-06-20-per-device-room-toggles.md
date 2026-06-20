# Per-device Room Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each device hide/show individual rooms (opt-out) from a checkbox list in the gear ⚙ settings, persisted locally, without changing how rooms are derived from HA areas.

**Architecture:** Add a persisted `hiddenRooms` store and a pure `computeVisibleRooms(rooms, hidden)` helper backing a derived `visibleRooms` store. The bottom nav and current-room selection switch from `rooms` to `visibleRooms`; the settings overlay gains a "Rooms on this device" checkbox section. `deriveRooms` is untouched.

**Tech Stack:** SvelteKit (static/SPA) + TypeScript, Svelte 5 runes, Vitest.

## Global Constraints

- TypeScript strict mode on; British English in UI copy/comments.
- Per-device state in `localStorage` only; no secrets, nothing in the repo/bundle.
- Opt-out model: all derived rooms visible by default; only explicitly-hidden IDs are filtered; new HA areas appear automatically.
- The app must never render an empty room set (last-visible guard + all-hidden fallback).
- `?lock=<area_id>` still overrides toggles (pins one room, hides nav).
- Kiosk hygiene: 44px touch targets; reuse existing CSS custom properties.
- Do NOT change `deriveRooms` or the card components.

---

### Task 1: `hiddenRooms` store + `computeVisibleRooms` + `visibleRooms`

**Files:**
- Modify: `src/lib/stores.ts`
- Test: `src/lib/stores.test.ts` (create)

**Interfaces:**
- Consumes: `rooms` store and `Room` type (existing in stores.ts / types.ts), `browser` from `$app/environment`, `writable`/`derived` from `svelte/store`.
- Produces:
  - `computeVisibleRooms(rooms: Room[], hidden: string[]): Room[]` — returns rooms whose `id` is not in `hidden`, preserving order; returns the full `rooms` array unchanged if that filter would leave none.
  - `hiddenRooms: Writable<string[]>` — hydrated from `localStorage['room-remote:hiddenRooms']`, persisted on change.
  - `visibleRooms` — `derived([rooms, hiddenRooms], …)` using `computeVisibleRooms`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/stores.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeVisibleRooms } from './stores';
import type { Room } from './types';

const room = (id: string): Room => ({ id, name: id, icon: 'sofa' });

describe('computeVisibleRooms', () => {
  const rooms = [room('a'), room('b'), room('c')];

  it('filters out hidden rooms, preserving order', () => {
    expect(computeVisibleRooms(rooms, ['b']).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns all rooms when nothing is hidden', () => {
    expect(computeVisibleRooms(rooms, []).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to all rooms when the filter would empty the list', () => {
    expect(computeVisibleRooms(rooms, ['a', 'b', 'c']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores hidden ids that no longer exist', () => {
    expect(computeVisibleRooms(rooms, ['x']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- stores`
Expected: FAIL — `computeVisibleRooms` not exported.

- [ ] **Step 3: Implement in `src/lib/stores.ts`**

Change the import line at the top from:
```ts
import { writable } from 'svelte/store';
```
to:
```ts
import { writable, derived } from 'svelte/store';
```

Append at the end of the file:
```ts
// Per-device room visibility (opt-out): only explicitly-hidden area IDs are filtered,
// so new HA areas appear automatically. Stored locally, never in the repo.
const HIDDEN_KEY = 'room-remote:hiddenRooms';

function loadHidden(): string[] {
  if (!browser) return [];
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const hiddenRooms = writable<string[]>(loadHidden());
if (browser) {
  hiddenRooms.subscribe((v) => localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)));
}

// Never return an empty list: if every room is hidden, show them all.
export function computeVisibleRooms(rooms: Room[], hidden: string[]): Room[] {
  const visible = rooms.filter((r) => !hidden.includes(r.id));
  return visible.length > 0 ? visible : rooms;
}

export const visibleRooms = derived([rooms, hiddenRooms], ([$rooms, $hidden]) =>
  computeVisibleRooms($rooms, $hidden)
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- stores`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test`
Expected: all pass.
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores.ts src/lib/stores.test.ts
git commit -m "feat: hiddenRooms store + computeVisibleRooms/visibleRooms"
```

---

### Task 2: Wire `visibleRooms` into nav/selection + Settings toggle list

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/Settings.svelte`

**Interfaces:**
- Consumes: `visibleRooms`, `hiddenRooms`, `rooms` (Task 1), existing `currentRoomId`; `RoomNav`.
- Produces: nav + selection driven by `visibleRooms`; a "Rooms on this device" section in the settings overlay.

- [ ] **Step 1: Point selection + nav at `visibleRooms` in `src/routes/+page.svelte`**

Add `visibleRooms` to the second stores import (line 8). Change:
```ts
  import { entities, currentRoomId, rooms, status } from '$lib/stores';
```
to:
```ts
  import { entities, currentRoomId, rooms, visibleRooms, status } from '$lib/stores';
```

Change the selection guard (lines 44–48) from:
```ts
  $: if (lock) {
    currentRoomId.set(lock);
  } else if ($rooms.length && !$rooms.some((r) => r.id === $currentRoomId)) {
    currentRoomId.set($rooms[0].id);
  }
```
to:
```ts
  $: if (lock) {
    currentRoomId.set(lock);
  } else if ($visibleRooms.length && !$visibleRooms.some((r) => r.id === $currentRoomId)) {
    currentRoomId.set($visibleRooms[0].id);
  }
```

Leave the room lookup on line 50 as-is (`$rooms.find(...)`) — `rooms` is the full superset, so a `?lock`-pinned room that the user has hidden still renders.

Change the nav block (lines 100–102) from:
```svelte
  {#if $rooms.length && !lock}
    <RoomNav rooms={$rooms} />
  {/if}
```
to:
```svelte
  {#if $visibleRooms.length && !lock}
    <RoomNav rooms={$visibleRooms} />
  {/if}
```

- [ ] **Step 2: Add the "Rooms on this device" section to `src/lib/components/Settings.svelte`**

In the `<script>` block, extend the stores import. Change:
```ts
  import { showSettings } from '$lib/stores';
```
to:
```ts
  import { showSettings, rooms, hiddenRooms, visibleRooms } from '$lib/stores';
```

Add this function inside the `<script>` block (after `clear()`):
```ts
  function toggleRoom(id: string, show: boolean) {
    hiddenRooms.update((h) => (show ? h.filter((x) => x !== id) : h.includes(id) ? h : [...h, id]));
  }
```

In the template, immediately before the closing `</div>` of `.settings-card` (after the `{#if hasCreds}…{/if}` block), add:
```svelte
    {#if $rooms.length}
      <div class="rooms-section">
        <h2>Rooms on this device</h2>
        {#each $rooms as r (r.id)}
          {@const visible = !$hiddenRooms.includes(r.id)}
          <label class="room-row">
            <input
              type="checkbox"
              checked={visible}
              disabled={visible && $visibleRooms.length <= 1}
              onchange={(e) => toggleRoom(r.id, e.currentTarget.checked)}
            />
            <span>{r.name}</span>
          </label>
        {/each}
      </div>
    {/if}
```

In the `<style>` block, add:
```css
  .rooms-section {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 40vh;
    overflow-y: auto;
  }
  .rooms-section h2 {
    font-size: 0.82rem;
    color: var(--muted);
    font-weight: 600;
    margin: 6px 0 2px;
  }
  .room-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    font-size: 0.95rem;
  }
  .room-row input {
    width: 22px;
    height: 22px;
    flex: none;
    accent-color: var(--blue);
  }
```

- [ ] **Step 3: Type-check, test, build**

Run: `npm run check`
Expected: 0 errors.
Run: `npm test`
Expected: all pass.
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual smoke (offline)**

Run `npm run dev`, open with fresh `localStorage`, click **Try demo** → five rooms in the nav. Open the gear ⚙ → "Rooms on this device" lists all five. Uncheck one → it disappears from the nav immediately; if it was selected, the view switches to the first visible room. Uncheck down to one → the remaining room's checkbox is disabled (can't hide the last). Reload (after re-entering demo) → toggles persisted. (Hidden state is keyed in `localStorage` under `room-remote:hiddenRooms`.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/Settings.svelte
git commit -m "feat: per-device room toggles in settings"
```

---

## Self-Review

**Spec coverage (design doc 2026-06-20-per-device-room-toggles-design.md):**
- Opt-out storage `room-remote:hiddenRooms`, persisted `hiddenRooms` store → Task 1. ✓
- `deriveRooms` unchanged; `visibleRooms` = rooms − hidden drives nav + selection → Task 1 (store) + Task 2 (wiring). ✓
- Selected-room-hidden falls back to first visible → Task 2 (selection guard on `visibleRooms`). ✓
- `?lock=` still overrides (room lookup stays on full `rooms`; nav hidden when locked) → Task 2. ✓
- Last-visible guard (checkbox disabled) + all-hidden fallback → Task 2 (disable) + Task 1 (`computeVisibleRooms` fallback). ✓
- "Rooms on this device" section only when rooms known → Task 2 (`{#if $rooms.length}`). ✓
- Security: only area IDs in localStorage → Task 1. ✓
- Testing: `computeVisibleRooms` filter/fallback/order → Task 1. ✓

**Placeholder scan:** none — every step carries full code.

**Type consistency:** `computeVisibleRooms(rooms: Room[], hidden: string[]): Room[]`, `hiddenRooms: string[]`, `visibleRooms` derived — defined in Task 1, consumed by name in Task 2 (`+page.svelte` import, `Settings.svelte` import). Svelte 5 runes (`{@const}`, `onchange`, `checked`) consistent with the existing components.

**Deferred (not gaps):** checkbox click-through + last-room disable are Playwright in phase 6; central allow-list and reordering are explicitly out of scope.
