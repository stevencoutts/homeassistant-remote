# CLAUDE.md — Room Remote

Instructions for Claude Code working in this repository.

## What this is

A standalone touchscreen app that shows the controls for one Home Assistant room at a time (lights, climate, media, covers, scenes). It runs full-screen in a kiosk browser on a tablet that mounts on the wall and also lifts off to sit on a table. It talks directly to Home Assistant over the local WebSocket API. No cloud.

## Read these first, in order

1. `room-remote-spec.md` — the full build specification. This is authoritative. Stack, architecture, functional requirements, config model, security, build phases and acceptance criteria all live here.
2. `room-remote-mockup.html` — the visual and interaction source of truth. Open it in a browser to see the intended UI. Production CSS and component structure should derive from it. Do not redesign the look without a reason; match it.

If this file and `room-remote-spec.md` ever disagree, the spec wins. Update the spec rather than diverging silently.

## Stack (decided, do not re-litigate)

- SvelteKit (static adapter, SPA mode) + TypeScript + Vite
- `home-assistant-js-websocket` for the HA connection, auth and state subscription
- Vite PWA plugin for the installable manifest and service worker
- Vanilla CSS using the custom properties already in the mockup; no heavy UI framework
- Vitest (unit) + Playwright (e2e against a mock backend)

## Architecture in one line

HA is the single source of truth. This app is a thin view plus controller: subscribe to entity state over one WebSocket, render it, and call HA services on user actions. No business logic, no polling, no local persistence beyond the selected room and UI prefs in `localStorage`.

## Guardrails

- **No secrets in the repo or the built bundle.** The HA long-lived token is entered on the device at runtime and stored in `localStorage`. Commit `rooms.example.json`, never a real `rooms.json` with entity IDs or tokens. Add both `rooms.json` and any `.env` to `.gitignore`.
- **Config-driven, not hard-coded.** Rooms and entities come from `rooms.json` (shape in spec section 6). A card type renders only if that room's config includes it.
- **Debounce continuous writes.** Brightness and volume drags must be debounced (~200 ms) so they do not flood HA with service calls.
- **Reflect HA state, not optimistic-only state.** The UI follows entity state pushed from HA. Reconnect with backoff and show a clear disconnected state.
- **Handle capability differences.** TRV vs full thermostat, covers with position vs open/close only, unavailable/off media players. Do not assume every entity supports every feature.
- **Kiosk hygiene.** No scrollbars, no text selection, no long-press menus, no pull-to-refresh, no navigation away from the app. 44 px minimum touch targets. Respect `prefers-reduced-motion`.

## Suggested project structure

```
/                      repo root
  CLAUDE.md            this file
  room-remote-spec.md  authoritative spec (keep updated)
  room-remote-mockup.html  design reference (do not ship as-is)
  README.md            setup: install, rooms.json, token, kiosk config
  rooms.example.json   committed sample config
  rooms.json           real config (gitignored)
  src/
    lib/
      ha/              WebSocket client, auth, service-call builders
      config/          rooms.json loader + validation
      components/      LightsCard, ClimateCard, MediaCard, CoverCard, Scenes, RoomNav
      stores/          reactive state (Svelte stores)
      icons/           icon set (extend the mockup's set)
    routes/ or App     app shell + layout
    styles/            CSS custom properties ported from the mockup
  tests/               Vitest unit + Playwright e2e
```

## Build order (from spec section 9)

1. Scaffold with static mock data so the UI runs offline.
2. HA WebSocket connection: connect, auth, subscribe, reconnect.
3. Config layer: load and validate `rooms.json`, wire the nav.
4. Cards live against real entities with correct service calls and debounced writes.
5. Kiosk polish: PWA manifest/service worker, full-screen, idle dim, room-lock mode.
6. Tests + README.

Build behind a mock backend first; do not require a live HA instance to run or test the app.

## Definition of done

Use the acceptance criteria in spec section 10. In short: room switching shows only that room and persists; every control produces the correct HA service call and the UI follows pushed state; cards absent from config do not render; the socket auto-reconnects; no credentials in the bundle; runs full-screen as an installed PWA; layout adapts portrait/landscape.

## Conventions

- British English in UI copy, comments and docs.
- TypeScript strict mode on.
- Keep components small and state in stores; the UI should be a pure function of state plus config.
- Test the state-to-UI mapping and the service-call builders; those are where bugs hide.
- Validate on a real low-spec tablet, not only a desktop browser.
