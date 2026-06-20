# Design: Per-device room toggles

**Date:** 2026-06-20
**Status:** Approved, pending implementation
**Affects:** `src/lib/stores.ts`, `src/lib/components/Settings.svelte`, `src/routes/+page.svelte`; new pure helper + test.

## Problem

Rooms are derived automatically from HA areas (`deriveRooms`) and every
qualifying area shows on every device. There is no way to hide a room on a
particular tablet (e.g. a wall panel that should only show its own floor).

## Decision

Per-device, opt-out room visibility. All derived rooms are visible by default;
the user unchecks rooms to hide them on *this* device. Hidden rooms are stored
locally, so new HA areas still appear automatically (only explicitly-hidden
rooms are filtered).

### Storage
- `localStorage` key `room-remote:hiddenRooms` → JSON array of hidden area IDs.
- New store `hiddenRooms: writable<string[]>`, hydrated from localStorage on
  load and persisted on change (same pattern as `currentRoomId`).
- Per-device only; never in the repo or bundle.

### Filtering
- `deriveRooms` is unchanged — it still derives every qualifying area into the
  `rooms` store.
- A derived `visibleRooms` store = `rooms` minus any whose `id` is in
  `hiddenRooms`. The bottom nav and the current-room selection use
  `visibleRooms` instead of `rooms`.
- If the selected room becomes hidden, the existing reactive guard in
  `+page.svelte` re-points selection to the first visible room.
- `?lock=<area_id>` (deviceRoomLock) still overrides everything: it pins one
  room and hides the nav regardless of toggles.

### Guard
- The app must never be empty. In the toggle UI, a room's checkbox is disabled
  when it is the last currently-visible room (you cannot hide the last one).
- Defence in depth: if `hiddenRooms` somehow hides every room, `visibleRooms`
  falls back to the full `rooms` list rather than rendering nothing.

### UI
- A "Rooms on this device" section inside the gear ⚙ Settings overlay: one row
  per derived room (from the `rooms` store) with a checkbox (checked = shown),
  44px targets, toggling live.
- The section only renders when rooms are known (connected or demo). On the
  first-run / no-credentials screen it is absent, since no areas exist yet.

## Components & responsibilities
- `stores.ts`: `hiddenRooms` (persisted writable) + `visibleRooms` (derived from
  `rooms` + `hiddenRooms`, with the all-hidden fallback) + a pure helper
  `computeVisibleRooms(rooms, hidden): Room[]` that the derived store and tests
  both use.
- `Settings.svelte`: the "Rooms on this device" checkbox list; toggling updates
  `hiddenRooms`; disables the last-visible checkbox.
- `+page.svelte`: nav + current-room selection read `visibleRooms`.

## Security
Unchanged. Only area IDs are stored, in `localStorage`; no credentials involved.

## Out of scope (YAGNI)
- Central/shared room allow-list (this is per-device by request).
- Reordering rooms.
- Hiding individual cards within a room (use HA entity hiding for that).

## Testing
- Unit: `computeVisibleRooms` — filters hidden ids; returns all when the filter
  would empty the list; preserves order.
- The checkbox interaction and last-room disable are exercised by Playwright in
  phase 6.
