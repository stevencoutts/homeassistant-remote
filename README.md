# Room Remote

A standalone touchscreen app that shows the controls for one Home Assistant room at a time: lights, climate, media, covers and scenes. It runs full-screen in a kiosk browser on a tablet that mounts on the wall and also lifts off to sit on a table. It talks directly to Home Assistant over the local WebSocket API. No cloud.

| File | Purpose |
|---|---|
| `room-remote-spec.md` | Authoritative build specification |
| `room-remote-mockup.html` | Visual and interaction reference (open in a browser) |
| `CLAUDE.md` | Working instructions for Claude Code |
| `rooms.example.json` | Offline sample fixture (rooms normally derive from HA areas) |

## Stack

SvelteKit (static, SPA) + TypeScript + Vite, using `home-assistant-js-websocket` for the HA connection and the Vite PWA plugin for the installable manifest and service worker. Full rationale in `room-remote-spec.md` section 2.

## Quick start

```bash
npm install
npm run dev        # local dev (starts against mock data; no HA needed)
npm run build      # production PWA build
npm run preview    # serve the production build
npm test           # Vitest unit tests
npm run check      # svelte-check type checking
```

The app runs against mock data with no live Home Assistant instance required. Point it at a real instance only when you want live control.

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

### Emby (optional): Live TV guide and on-demand browser

Set `EMBY_URL` and `EMBY_API_KEY` in `.env` to enable two buttons on the media
card in any room that has a TV/AV player (Apple TV, Google/Android TV, Fire TV,
Chromecast, Shield, Roku). The container proxies Emby under `/emby/*` and injects
the API key server-side, so it never reaches a browser (same pattern as the HA
token). Create the key in Emby under Settings → Advanced → API Keys.

**TV Guide** opens a full-screen EPG. Pressing a programme tells Emby to play
that channel on the room's device via Emby's session remote.

**Films & TV** opens a full-screen on-demand browser: a Continue Watching row
(resume, with a progress bar), a Recently Added row, and A-to-Z browse of your
Movies and TV Series libraries (series drill into seasons and episodes). Tapping
a film or episode plays it on the room's device. Browse only, no search in v1.

In both cases, if the Emby app is not already running the app first wakes the
device and launches Emby through Home Assistant (`media_player.turn_on` +
`select_source`), waits for the Emby session to register, then plays — so you do
not need to open the app by hand. This needs the device's HA media-player
integration (for example pyatv for Apple TV), with Emby appearing in the player's
source list. The session and the Emby user are auto-detected. With Emby unset the
buttons are hidden and the rest of the app is unaffected.

### Music browser (Plex)

Rooms with a Sonos show a **Music** button on the media card. It opens a
full-screen browser over the Sonos `media_player/browse_media` tree and plays
the chosen item on the Sonos group coordinator with `media_player.play_media`.
The source is Plex via Home Assistant's native Plex integration; if no Plex node
is found it falls back to the Sonos Music Library. Browsing is folder-by-folder
(artist → album → track, plus playlists); tapping a playable node plays it.

No extra configuration: it uses the same HA connection as the rest of the app
and constructs no Plex-specific IDs (it replays the IDs HA's browse returns).
With no HA connection it serves a small mock library so the UI runs offline. If
Plex sits somewhere other than the Sonos browse root on your system, adjust
`pickMusicRoot` in `src/lib/ha/browse.ts`.

### Plex track ratings (thumbs up/down)

Set `PLEX_URL` and `PLEX_TOKEN` in `.env` to show thumbs up/down on the media
card for the playing track. Home Assistant cannot write ratings, so the rating
goes to Plex directly: the container proxies `/plex/*` with the token injected
server-side (never reaching a browser, same pattern as Emby/HA).

Plex uses a 0-10 star rating for library music, so thumbs up sets 5 stars (10),
thumbs down sets 1 star (2), and tapping the active thumb again clears it. The
playing track is matched to its Plex item via the active Plex session (by title
and artist), falling back to a rating key parsed from the media id. Find your
token as `X-Plex-Token` in a Plex Web request.

**Security:** the proxy has no built-in login — anyone who can reach `:8085` can
control HA (the blast radius of the wall switches it replaces, on a trusted LAN).
Do not expose it to the internet without fronting it with auth (reverse-proxy
basic auth, Cloudflare Access, etc.).

## Configuration

Rooms are **derived automatically from your Home Assistant areas** — there is no
central config file to author. Assign entities to areas in Home Assistant's
normal UI and each area with a light, climate, media player or cover becomes a
room, with the matching cards. Changes propagate to every device over the
WebSocket it already holds. Full rules in spec section 6.

A card renders only if the area has entities of that domain (no media player, no
media card). The area's icon maps to the built-in icon set, with a generic
fallback.

Per-device settings (stored in the device `localStorage`, never in the repo):

- **HA URL + long-lived token**, entered at first run, or supplied centrally by
  the Docker proxy (see above).
- **Room-lock:** add `?lock=<area_id>` to the URL to pin a wall device to one
  room and hide the navigation.
- **Outdoor temperature:** an optional sensor entity shown in the header.

`rooms.example.json` is an **offline fixture** for running the UI without a live
HA instance, not production config. `rooms.json` and `.env` are gitignored.

## Connecting to Home Assistant

1. In Home Assistant, create a **dedicated user** for the panels (for example `remote_panels`), not your admin account.
2. Generate a **long-lived access token** for that user (profile page, bottom of the page).
3. Provide the HA URL and token either **centrally** via the Docker `.env` (`HA_URL` + `HA_TOKEN`, proxied so the token never reaches a browser), or **per device** by entering them in the gear ⚙ settings at first run. They are stored in the device `localStorage` and never committed to the repo.
4. Prefer `wss://` (TLS); if HA uses a self-signed certificate on the LAN, trust it on the device.

See spec section 7 for the full security model, including the recommended IoT VLAN segmentation.

## Kiosk and hardware

Install the PWA to the home screen so it runs full-screen, and use a kiosk launcher (for example Fully Kiosk Browser on Android) to lock the device to the app, auto-start on boot and manage screen dimming. The recommended hardware is a cheap 8 inch Android tablet on a magnetic wall bracket with pogo-pin charging, plus a matching desk dock so it charges in either location. Full hardware design and bill of materials are in spec section 8.

## Security notes

- No secrets in the repo or the built bundle. The token is entered at runtime on the device, or injected server-side by the Docker proxy.
- `rooms.json`, `.env` and any token files are gitignored.
- Use a scoped HA user so a stolen or compromised panel can do no more than operate the home.

## Status

Implemented: the HA WebSocket connection with auto-reconnect, area-derived rooms
with live registry updates, the five cards (lights, climate, media, covers,
scenes) against live entities with debounced writes, per-device room-lock, the
PWA build and Docker proxy for central credentials, the Plex music browser and
track ratings, and the Emby Live TV guide and on-demand Films & TV browser. Unit
tests cover the state-to-UI mapping, service-call builders and the Emby/Plex
clients. See `CLAUDE.md` and spec section 9 for the build order and remaining
kiosk polish.
