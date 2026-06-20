# Design: Card layout — wide Climate/Media + collapsible Lights/Scenes

**Date:** 2026-06-20
**Status:** Approved, pending implementation
**Affects:** `src/app.css`, `src/lib/components/ClimateCard.svelte`, `MediaCard.svelte`, `LightsCard.svelte`, `ScenesCard.svelte`, `src/lib/services.ts`; new pure helper + tests.

## Problem

All cards are equal-width in the 2-column grid, and Lights/Scenes show their
full contents at all times, which makes a busy room's screen long. Climate and
Media want more horizontal room; Lights and Scenes want an overview-first,
expand-on-demand presentation.

## Decision

### 1. Double-width Climate & Media
- `app.css`: `.card.wide { grid-column: 1 / -1; }`.
- `ClimateCard` and `MediaCard` render their root as `class="card wide"`.
- Landscape (2-col) flow: `Lights | Scenes` on row 1, `Climate` full-width,
  `Media` full-width, then `Covers` (single width). Portrait (already 1-col):
  no visual change. Covers stay single-width.

### 2. Lights — collapsed overview, tap to expand
- Collapsed (default): header row = bulb icon, "Lights", `N on` count, a
  **master toggle**, and a chevron. The header is a `<button>` that toggles
  expansion (`aria-expanded`); the master toggle is a separate control whose
  tap does NOT expand (stop propagation).
- Expanded: the existing per-light rows (name / % / switch / brightness slider)
  render below; chevron flips.
- **Master toggle semantics:** shown *on* if at least one of the room's lights
  is on. Tapping it: if any are on → turn **all** off; otherwise → turn all on.
  Pure helper `allLightsOn(states, entityIds): boolean` (any-on) drives the
  display; the next action is `!allOn`.

### 3. Scenes — collapsed overview, tap to expand
- Collapsed (default): header `<button>` = scene icon, "Scenes", the active
  scene name (from the existing best-effort `activeScene[roomId]` → look up the
  scene's display name, or "—" if none), chevron.
- Expanded: the chips, as now.

### 4. Interaction
- Expand/collapse is per-card local state (`$state(false)`, collapsed by
  default). Cards are re-created when the room changes, so it naturally resets
  to overview-first per room.
- Headers are 44px touch targets with `aria-expanded`; the chevron rotation
  respects `prefers-reduced-motion`.

### 5. Service for the master toggle
- `services.ts`: `setLights(entityIds: string[], on: boolean)` — when connected,
  one `light.turn_on`/`turn_off` call targeting all entity IDs; offline-mock
  mutates each entity in the store. New pure builder
  `lightsCall(entityIds, on): ServiceCall` (`light`, `turn_on`|`turn_off`,
  `{}`, `{ entity_id: entityIds }`).

## Components & responsibilities
- `app.css`: `.card.wide`, collapsible-header styles, chevron.
- `ClimateCard`/`MediaCard`: add the `wide` class (no behaviour change).
- `LightsCard`: collapse state + master toggle; existing rows unchanged when
  expanded.
- `ScenesCard`: collapse state + active-scene summary; existing chips unchanged
  when expanded.
- `services.ts`: `lightsCall` builder + `setLights` dispatcher.

## Out of scope (YAGNI)
- Persisting expand/collapse across reloads or rooms.
- Making Covers wide or collapsible.
- Animated height transitions beyond the chevron.

## Testing
- Unit: `allLightsOn(states, ids)` (any-on, none, empty); `lightsCall(ids, on)`
  builds the correct turn_on/turn_off call with an array target.
- Expand/collapse and master-toggle click-through are Playwright (phase 6).
