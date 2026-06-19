# Design: HA-area-driven config

**Date:** 2026-06-19
**Status:** Approved, pending implementation
**Affects:** `room-remote-spec.md` sections 6 (config model), 9 (build phases), 11 (out of scope)
**Supersedes:** the hand-written `rooms.json` as production config

## Problem

We want to "customise the cards on each screen, centrally controlled, pushed to
registered remotes." The original spec drives the UI from a hand-written
`rooms.json` per device, which means editing config on every tablet by hand.

A separate config web app + device registry + push service was considered and
rejected: it is a second backend to host, secure, and keep in sync with HA, and
it breaks the spec's local-only / no-cloud / stateless-remote guarantees
(sections 3, 7).

## Decision

Home Assistant is already the central control plane: every remote holds an
authenticated WebSocket to it, HA already knows the devices, users, and rooms,
and it already fires change events. So the config is **derived from HA areas**
rather than authored. "Editing the screens" becomes "managing your HA areas,"
which the user already does. There is **no central config file and no second
backend.**

## How it works

### Room derivation

On connect, read HA's registries over the existing WebSocket (all built-in
commands — no custom integration):

- `config/area_registry/list`
- `config/floor_registry/list`
- `config/device_registry/list`
- `config/entity_registry/list`
- entity states from the phase-2 `subscribe_entities`

Then `deriveRooms(registries, states)`:

1. Resolve each entity's area: `entity.area_id` if set, else its device's
   `area_id`.
2. Drop entities that are `hidden_by != null`, `disabled_by != null`, or
   `entity_category` of `config`/`diagnostic`.
3. An **area becomes a room** if it has at least one entity in `light`,
   `climate`, `media_player`, or `cover`. (Scenes alone do not create a room.)
4. Group the area's entities by domain into the existing five card types:
   - `light.*` → Lights
   - `scene.*` assigned to the area → Scenes (none assigned → no scene chips)
   - `climate.*` → Climate
   - `media_player.*` → Media
   - `cover.*` → Covers
5. **A card renders only if the area has entities of that domain** — the
   existing config-driven guardrail, now sourced from HA.
6. Room order: floor `level`, then area name. Rooms with no floor sort after
   floored rooms, by name.

Naming and presentation:

- Entity display name: entity-registry `name` → state `friendly_name` →
  `original_name` → `entity_id`.
- Room name: area `name`. Room icon: area `icon` (mdi name) mapped to the app's
  existing SVG icon set via a small lookup, with a generic room icon fallback.
  We do **not** bundle the full MDI set.

### Editing = HA's normal UI

Add/rename/hide an entity, set an area icon, create an area — all done in HA.
No app-specific editor. (A visual editor was rejected with the second backend.)

### Push (native, no polling)

Subscribe to `area_registry_updated`, `entity_registry_updated`,
`device_registry_updated`, `floor_registry_updated`. On any event, re-fetch the
affected registry and recompute rooms. Entity **state** changes already stream
in from the phase-2 subscription. Edit in HA → every tablet re-renders within a
second, over the socket it already holds.

### Per-device config (the only authored config)

Areas cannot know which physical tablet is where, so a small amount of config is
per-device, stored in `localStorage`, never in the repo:

- HA URL + long-lived token, entered at first run (already in the spec).
- Optional **room-lock** for a wall tablet: `?lock=<area_id>` URL param or a
  one-time local setting; hides the nav and pins the device to one room.
- Optional outdoor-temperature sensor entity for the header.

### Offline / mock mode

Phase 1's static fixture stays for offline dev and tests, reshaped into a fake
registries-plus-states response so `deriveRooms()` runs identically online and
off. `rooms.json` is demoted to "offline fixture only"; it is no longer
production config.

## Scope

In scope: registry reads, `deriveRooms()`, registry-event subscriptions,
icon mapping with fallback, per-device room-lock and outdoor sensor, mock
registries fixture.

Deliberate v1 omissions:

- **No per-card entity ordering** — HA has no native per-area order; default to
  alphabetical by display name. Add later only if needed.
- **No visual editor** — HA is the editor.
- **No central settings file** — per-device settings only.

## Impact on build phases

- Phase 1 (scaffold, mock): done; unchanged except `rooms.json` is now framed as
  an offline fixture.
- Phase 2 (connect / auth / reconnect): unchanged.
- Phase 3 (config layer): changes from "load & validate `rooms.json`" to "read
  registries, `deriveRooms()`, subscribe to registry events, recompute on
  change." Per-device room-lock handled here or in phase 5.
- Phases 4–6 (cards live, kiosk polish, tests/docs): unchanged, except tests
  now cover `deriveRooms()` (the registry-to-rooms mapping) instead of
  `rooms.json` validation.

## Open risks

- An untidy HA (test/junk areas) shows extra tabs until tidied. Accepted
  tradeoff of the fully-automatic room list.
- Scenes only appear if assigned to an area in HA. Documented in the README.
- HA area icons are mdi names; only mapped icons render with a bespoke glyph,
  the rest fall back to a generic room icon.
