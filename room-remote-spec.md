# Room Remote — Build Specification

**Project:** Per-room touchscreen remote for Home Assistant
**Author:** Steven Coutts
**Status:** Ready for implementation
**Audience:** Claude Code (app build) plus hardware notes for procurement and install
**Companion file:** `room-remote-mockup.html` (interactive UI reference in this folder)

---

## 1. Summary

Build a standalone touchscreen app that shows the controls for a single room at a time: lights, climate, media and covers, plus room scenes. The same screen runs on a wall-mounted device and on a portable device that lives on a table and charges on a magnetic dock. The app talks directly to Home Assistant over its local WebSocket API. No cloud, no third-party services.

The look and interaction model are already prototyped in `room-remote-mockup.html`. That file is the visual source of truth for layout, card structure and behaviour. This document specifies how to turn it into a real, configurable, HA-connected app and the hardware it runs on.

---

## 2. Recommended stack (and why)

**Recommendation: a Progressive Web App (PWA) built with SvelteKit, run full-screen in a kiosk browser.**

Reasoning:

- **Hardware independence.** A PWA runs on any device with a modern browser: cheap Android tablets, a Raspberry Pi, an old iPad, a desktop. The hardware decision in section 8 is then not locked to the code. This matters because the device is portable and may be swapped or upgraded.
- **One codebase, installable.** A PWA installs to the home screen, runs full-screen with no browser chrome, and works behind a kiosk launcher. No app-store friction, no signing, no per-platform builds.
- **Fast for an LLM to build and iterate.** Plain web tech, no native toolchain, instant reload. The existing mockup is already HTML/CSS/JS, so the design transfers directly.
- **Svelte over React** for this use case: smaller bundle, less boilerplate, compiled output that runs smoothly on low-power tablet hardware. The whole UI is reactive state over a WebSocket, which Svelte stores model cleanly. React is an acceptable substitute if preferred; the architecture below is framework-agnostic.

Flutter and native Android were considered and rejected for this project: they tie the build to a heavier toolchain and, in the native case, to one hardware platform, for no benefit given the UI is simple and the data source is a WebSocket.

**Concrete stack:**

- SvelteKit (static adapter, SPA mode) or plain Vite + Svelte if routing is not needed
- TypeScript
- `home-assistant-js-websocket` (the official HA WebSocket client library) for the connection, auth and state subscription
- Vanilla CSS (custom properties already defined in the mockup) or UnoCSS; no heavy UI framework
- Vite PWA plugin for the installable manifest and service worker
- Vitest plus Playwright for unit and end-to-end tests

---

## 3. Architecture

```
+--------------------------+        local LAN / WLAN          +-----------------------+
|  Room Remote (PWA)       |  <----------------------------->  |  Home Assistant       |
|  kiosk browser on device |   WebSocket: wss://ha.local:8123  |  (existing instance)  |
|                          |   /api/websocket                  |                       |
|  - config: rooms.json    |   - auth via long-lived token     |  entities, services   |
|  - HA WS client          |   - subscribe_entities            |                       |
|  - reactive UI (Svelte)  |   - call_service                  |                       |
+--------------------------+                                   +-----------------------+
```

- The app holds a **room/entity configuration** (`rooms.json`, see section 6) mapping each room to its HA entity IDs.
- On launch it opens a single **WebSocket** to HA, authenticates with a **long-lived access token**, and subscribes to entity state.
- All state is **pushed** from HA. The UI is a pure function of that state plus the local config. No polling.
- User actions call HA services (`light.turn_on`, `climate.set_temperature`, `media_player.media_play`, `cover.set_cover_position`, `scene.turn_on`) over the same socket.
- The app is **stateless** beyond the current room selection and UI preferences (stored in `localStorage`). Restarting the device loses nothing.

This is deliberately thin: HA remains the single source of truth and the only place automation logic lives. The remote is a view and a controller, nothing more.

---

## 4. Functional requirements

### 4.1 Rooms

- Multiple rooms, each selectable from a persistent bottom navigation bar (icons plus short label), exactly as in the mockup.
- Only the selected room's controls are shown.
- The current room persists across reloads (`localStorage`).
- Optional config flag to pin a device to one fixed room (a wall device outside the lounge always shows the lounge) and hide the nav.

### 4.2 Cards

Each card type renders only if the room config includes entities of that type.

**Lights**

- One row per light or light group: name, on/off toggle, brightness slider (1 to 100%), live percentage.
- Slider disabled and greyed when the light is off.
- Brightness writes are **debounced** (about 200 ms) so dragging does not flood HA with service calls.
- Scene chips for the room (for example Bright, Movie, Evening, Off). Tapping a chip calls `scene.turn_on`. The active scene is highlighted where HA exposes it; otherwise highlight is best-effort on last tap.
- Card header shows count of lights on.
- Support `light` entities and `light` groups. Colour and colour-temperature control are **out of scope for v1** but the data model should leave room for them (see section 6).

**Climate**

- Large target-temperature readout with plus/minus stepper (0.5°C steps; clamp to the entity's min/max).
- Current room temperature shown as a subtitle (`current_temperature` attribute).
- Mode selector: Heat, Cool, Auto, Off, mapped to the entity's supported `hvac_modes`. Hide modes the entity does not support.
- Writes call `climate.set_temperature` and `climate.set_hvac_mode`.
- Handles entities that are thermostats and simple TRVs (target temp only, no cool mode).

**Media**

- Now-playing block: artwork (`entity_picture` if available, else a placeholder), title, artist/subtitle, source name.
- Transport: previous, play/pause, next. Play/pause reflects `state` (playing/paused/idle).
- Volume slider (`media_player.volume_set`, 0 to 100%).
- Card hidden for rooms with no media player.
- Gracefully handle `unavailable`/`off` players (show an idle state, disable transport).

**Covers**

- Position slider (0 to 100% open) writing `cover.set_cover_position`.
- Open / Stop / Close buttons (`cover.open_cover`, `cover.stop_cover`, `cover.close_cover`).
- Simple visual indicator of openness (as in the mockup).
- Support covers that only report open/closed (no position): fall back to open/close buttons and hide the slider.

### 4.3 Global

- Live clock in the header.
- Optional outdoor temperature in the header from a configurable sensor entity.
- Connection status indicator: visibly show when the WebSocket is down and auto-reconnect with backoff.
- Optional screensaver/dim after N seconds idle (clock or blank), tap to wake. Useful for an always-on wall device.

---

## 5. UI and UX

- The mockup `room-remote-mockup.html` defines the visual language: dark theme, large touch targets, card grid, warm accent for lights, blue accent for media and covers. Reuse its CSS custom properties and component structure.
- **Responsive layout** is required because the same build runs on different screen sizes and orientations:
  - Narrow / portrait (handheld, phone-size): single column of cards.
  - Wide / landscape (wall tablet): two-column card grid.
  - Use CSS grid with a breakpoint, as the mockup already does.
- **Touch first.** Minimum 44 px touch targets. No hover-only affordances. No tiny close buttons.
- **Kiosk friendly.** No scrollbars visible, no text selection, no long-press context menus, no pull-to-refresh. Disable these via CSS and meta tags.
- **Accessibility.** Sufficient contrast (the dark palette already passes AA for body text; verify accent-on-dark for any small text), respect `prefers-reduced-motion` for the slat and toggle animations.

---

## 6. Configuration model

**Rooms are derived from Home Assistant areas, not authored in a file.** HA is the
central control plane: assigning entities to areas in HA's normal UI *is* how the
screens are configured, and the change propagates to every remote over the socket
it already holds. There is no central config file and no second backend. See
`docs/superpowers/specs/2026-06-19-ha-area-driven-config-design.md` for the full
design.

### Room derivation

On connect, read HA's registries over the existing WebSocket (all built-in
commands — no custom integration): `config/area_registry/list`,
`config/floor_registry/list`, `config/device_registry/list`,
`config/entity_registry/list`, plus entity states from `subscribe_entities`. Then:

- Resolve each entity's area: `entity.area_id` if set, else its device's `area_id`.
- Drop entities that are `hidden_by`/`disabled_by`, or `entity_category`
  `config`/`diagnostic`.
- An **area becomes a room** if it has ≥1 entity in `light`, `climate`,
  `media_player` or `cover` (scenes alone do not create a room).
- Group the area's entities by domain into the five cards: `light.*` → Lights,
  `scene.*` assigned to the area → Scenes, `climate.*` → Climate,
  `media_player.*` → Media, `cover.*` → Covers.
- **A card renders only if the area has entities of that domain** (the
  config-driven guardrail, now sourced from HA).
- Room order: floor `level`, then area name. Display name: entity-registry
  `name` → `friendly_name` → `original_name` → `entity_id`. Room name/icon from
  the area; the area's mdi icon maps to the app's SVG icon set with a generic
  fallback (the full MDI set is not bundled).

### Push

Subscribe to `area_registry_updated`, `entity_registry_updated`,
`device_registry_updated`, `floor_registry_updated`; on any event re-fetch the
affected registry and recompute rooms. Entity state changes already stream from
`subscribe_entities`.

### Per-device config (the only authored config)

Areas cannot know which physical tablet is where, so a small amount of config is
per-device, stored in `localStorage`, never in the repo:

- HA URL + long-lived token, entered at first run (see security, section 7).
- Optional **room-lock** for a wall device: `?lock=<area_id>` URL param or a
  one-time local setting; pins the device to one room and hides the nav.
- Optional outdoor-temperature sensor entity for the header.

### Offline / mock

`rooms.example.json` / `rooms.json` are an **offline fixture only** (reshaped into
a fake registries-plus-states response so `deriveRooms()` runs identically online
and off), not production config.

---

## 7. Security and network design

Written for a setup where Home Assistant and the remotes share a LAN. Treat the remote as an untrusted, always-on, physically accessible device and scope its access accordingly.

- **Local-only.** The app connects to HA on the LAN. No cloud relay, no Nabu Casa dependency, no inbound internet exposure required.
- **Token.** Authenticate with a **long-lived access token** scoped to a dedicated HA user created for the remotes (for example `remote_panels`). Do not reuse a personal admin account. If/when HA exposes finer-grained scopes, restrict further.
- **Token storage.** Store the token in the device browser's `localStorage` or an HTTP-only mechanism, entered at first run, never committed to the repo and never placed in `rooms.json` in source control. Document this clearly for the user.
- **Transport.** Prefer `wss://` (TLS). If HA uses a self-signed certificate on the LAN, document the trust step on the device. Plain `ws://` is acceptable only on a trusted, segmented network and should be a conscious choice.
- **Network segmentation (recommended).** Place the remotes and HA on a dedicated IoT VLAN/SSID. Allow the remotes to reach only the HA host on port 8123. Block the IoT VLAN from initiating connections to other trusted subnets. This contains a compromised panel to HA control only, which is the same blast radius as the wall switches it replaces.
- **Physical security.** A wall panel is reachable by anyone in the room. Keep the kiosk locked to the app (no browser navigation, no settings escape), and rely on the scoped HA user so a stolen portable unit cannot do more than operate the home.
- **No secrets in the bundle.** The built PWA must contain no tokens or credentials. Auth is supplied at runtime on the device.

---

## 8. Hardware design

Goal: a device that mounts cleanly on the wall and lifts off to sit on a table, charging on a magnetic dock so it is always ready.

### 8.1 Recommended approach: off-the-shelf tablet plus magnetic dock

Recommend a cheap, modern **Android tablet** running a kiosk launcher, on a **magnetic wall/desk dock with pogo-pin charging**. Rationale: lowest cost and effort, proven in the HA community, instantly portable, and the PWA runs on it unchanged. A DIY Raspberry Pi panel and a purpose-built in-wall panel were considered; both are mains-only and not portable, so they do not meet the wall-or-table requirement. They remain valid for fixed panels in rooms where portability is not wanted.

**Device selection criteria:**

- 8 inch class screen (comfortable in hand, substantial enough on a wall). 10 inch for a main-room panel if preferred.
- Modern enough browser for a PWA and a service worker (current Android WebView/Chrome).
- Good idle battery and the ability to charge-limit or run always-on without battery swelling over time (important for a device that may sit on a dock continuously).
- IPS panel with decent off-axis viewing for wall use.

Suitable categories include mainstream budget Android tablets (for example Lenovo Tab or Samsung Galaxy Tab A class) and Amazon Fire HD tablets (cheapest, but require sideloading a proper launcher and browser; acceptable for a kiosk). Avoid very old tablets whose browsers cannot run a modern PWA. Confirm current models and prices at build time rather than relying on this document.

### 8.2 Wall plus battery dock

- **Magnetic mount with pogo-pin charging.** A wall bracket holds the tablet magnetically and feeds power through spring-loaded pogo pins that mate with a plate stuck to the tablet back. Lift the tablet off for table use, drop it back to charge. This is the mechanism that satisfies "wall mountable but also lying on a table".
- A matching **desk dock** with the same pogo arrangement gives a second charging point on a table or shelf, so the portable unit charges in either location.
- Qi wireless charging is an alternative to pogo pins where the tablet supports it, but pogo pins are more reliable for a frequently re-docked device and avoid heat from continuous wireless charging.
- **Battery longevity:** for a tablet that mostly sits on the dock, enable charge limiting (many launchers and some tablets support an 80% cap, or use a smart plug driven by HA to cycle charging) to avoid keeping the battery at 100% continuously. Worth calling out because it is the main failure mode of always-docked tablets.

### 8.3 Mounting and finish

- Recessed/in-wall mounts give a flush, switch-plate look but remove portability; use a **surface magnetic bracket** here so the tablet detaches.
- Run charging power to the bracket from a nearby socket, or for a clean install, a low-voltage USB feed in the wall to the bracket. Mains work behind the wall should be done by a competent/qualified person per local regulations.
- One bracket per room where a wall position is wanted; rooms can also be dock-only (table) if no wall position suits.

### 8.4 Kiosk software on the device

- A kiosk launcher (for example Fully Kiosk Browser on Android) to: lock to the PWA, hide system UI, auto-start on boot, keep the screen on or dim on schedule, and optionally wake on motion.
- Configure the launcher to disable navigation away from the app, pull-to-refresh and the address bar.
- The PWA itself should also be installed to the home screen so it runs full-screen even without the launcher.

### 8.5 Indicative bill of materials (per room)

| Item | Purpose | Notes |
|---|---|---|
| 8 inch Android tablet | The remote | Confirm current model/price at build |
| Magnetic wall bracket with pogo-pin charging | Wall mount + charge | Detachable for table use |
| Pogo-pin desk dock (optional) | Second charge point | For table-heavy rooms |
| USB power supply + cable | Power to bracket/dock | Per location |
| Kiosk launcher licence | Lock to app | Small one-off per device |
| Charge-limiting (smart plug or launcher setting) | Battery longevity | Optional but recommended |

Prices move, so this document intentionally gives no figures. Price the chosen tablet and brackets at procurement time.

---

## 9. Build phases (for Claude Code)

1. **Scaffold.** SvelteKit + TS + Vite PWA. Port the mockup's CSS and component structure. Static mock data so the UI runs with no HA connection.
2. **HA connection.** Integrate `home-assistant-js-websocket`: connect, authenticate with a token entered at runtime, subscribe to entity states, reconnect with backoff. Connection-status indicator.
3. **Config layer.** Read HA's area/floor/device/entity registries, `deriveRooms()` (section 6), wire rooms to the bottom nav and live entities, and subscribe to the registry-updated events to recompute on change. Per-device room-lock.
4. **Cards, live.** Implement Lights, Climate, Media, Covers and Scenes against real entities, with debounced writes and correct service calls. Handle unavailable entities and capability differences (TRV vs full thermostat, position vs open/close covers).
5. **Kiosk polish.** PWA manifest and service worker, full-screen behaviour, disable selection/long-press/pull-to-refresh, idle dim/screensaver, room-lock mode.
6. **Tests and docs.** Unit tests for the state-to-UI mapping and service-call builders; a Playwright run against the mock backend; a README covering install, `rooms.json`, token setup and kiosk configuration.

---

## 10. Acceptance criteria

- Selecting a room shows only that room's cards; selection persists across reload.
- Toggling a light, dragging brightness, stepping the thermostat, changing mode, play/pause, volume, cover position and open/close all produce the correct HA service calls and the UI reflects HA-pushed state, not optimistic-only state.
- Brightness and volume drags are debounced and do not flood HA.
- Cards absent from a room's config do not render.
- The WebSocket reconnects automatically after HA restarts or network drops, and the UI shows a clear disconnected state meanwhile.
- No credentials are present in the built bundle or in source control.
- Runs full-screen as an installed PWA on the target tablet with no browser chrome and no accidental navigation.
- Layout adapts between portrait single-column and landscape two-column.

---

## 11. Out of scope for v1 (note for later)

- Light colour and colour-temperature control (leave room in the data model).
- An in-app **visual config editor** and an onboarding wizard. Rooms now derive from HA areas automatically (section 6); first run is a minimal HA URL + token entry only. Per-card entity ordering is also out of scope for v1 (default alphabetical by display name).
- Multi-home / multiple HA instances.
- User accounts or per-user permissions on the device (handled by the single scoped HA token).
- Voice control.

---

## 12. Repo handover notes

- Keep `rooms.json` and any token out of version control; commit a `rooms.example.json` instead.
- Treat `room-remote-mockup.html` as the design reference; the production CSS should derive from it.
- Target the lowest-spec tablet early and test on it, not only in a desktop browser, so performance and touch behaviour are validated on real hardware.
