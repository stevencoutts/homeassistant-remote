# Design: First-run settings screen

**Date:** 2026-06-20
**Status:** Approved, pending implementation
**Affects:** `src/lib/ha/connection.ts`, `src/routes/+page.svelte`, `src/lib/stores.ts`; new `src/lib/components/Settings.svelte`. Updates spec §6 (per-device config) / §7 (token) notes.

## Problem

Credentials (HA URL + long-lived token) can currently only be entered via the
browser devtools console (`localStorage.setItem`). There is no in-app way to
configure a device, and with no credentials the app silently shows the
offline-mock demo. A real deployment needs an in-app setup step. (Spec §6 lists
"first run is a minimal HA URL + token entry" as in scope.)

## Decision

A settings-first flow with an opt-in demo and a header gear to reconfigure.

### Boot flow (`+page.svelte` onMount)
- Credentials stored → connect live. On success show the app; on failure open
  Settings with the error shown.
- No credentials → open Settings. (The silent offline-mock-on-no-creds fallback
  is removed; the demo becomes explicit.)

### Settings screen (`src/lib/components/Settings.svelte`)
Full-screen overlay built from the existing CSS custom properties.

- HA URL text input.
- Long-lived token input, masked (`type="password"`) with a show/hide toggle.
- **Connect**: validate both non-empty → `saveCredentials()` → attempt connect.
  Show a connecting state; on success close the overlay; on failure stay open
  with an inline error ("Couldn't connect — check the URL and token."), leaving
  the saved credentials so the user can correct them.
- **Try demo**: load the offline-mock fixture, close the overlay.
- When opened with credentials already stored (via the gear): pre-fill the URL,
  leave the token blank (never display the stored token), and offer
  **Disconnect & clear** — wipe stored credentials, close the socket, return to
  setup.
- 44px minimum touch targets; British English copy.

### Header gear (`+page.svelte`)
A gear button in the top bar, always visible (offline-mock, connected, or
disconnected), opens the Settings overlay. Driven by a `showSettings` store.

### Connection layer (`src/lib/ha/connection.ts`)
Split today's `startHa()`:
- `connectLive(): Promise<void>` — requires stored credentials; throws if none.
  Connects, subscribes to entities, fetches registries, subscribes to registry
  events. **Rejects on auth/connection failure** (no internal offline fallback)
  so the form can surface the error.
- `startMock(): void` — loads the mock fixture, sets status `offline-mock`.
- `disconnect(): void` — closes the socket, clears the module connection/state,
  resets `rooms`/`status`. Also closes the subscription-teardown gap logged in
  the previous review.

`+page.svelte` decides which to call; `connectLive` no longer hides failures.

### Store
- `showSettings: writable<boolean>` drives the overlay.

## Components & responsibilities
- `Settings.svelte`: presentation + form state + validation; calls
  `saveCredentials`, `connectLive`/`startMock`/`disconnect`; owns the inline
  error. No HA protocol knowledge.
- `connection.ts`: all socket lifecycle; exposes `connectLive`, `startMock`,
  `disconnect`, `getConnection`.
- `+page.svelte`: boot decision, gear, and overlay mounting.

## Security
Unchanged. Credentials live only in `localStorage`; nothing in the bundle. The
stored token is never rendered back into the DOM (token field starts blank on
reconfigure).

## Out of scope (YAGNI)
- A "test connection without saving" button — Connect already validates by
  attempting the real connection.
- Remembering multiple HA profiles.
- Auto-discovery of the HA URL.

## Testing
- Unit: `connectLive()` rejects when no credentials stored; the form validation
  guard (both fields required) blocks an empty submit.
- The full click-through (enter creds → connect → app; gear → clear → setup;
  try demo) is Playwright e2e in phase 6.

## Impact on build phases
Pulls the "minimal first-run URL + token entry" forward from the phase-6/spec
nice-to-have into now. Phase 5 kiosk polish and phase 6 tests/docs are otherwise
unchanged; the Playwright suite will cover this flow.
