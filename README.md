# Room Remote

A standalone touchscreen app that shows the controls for one Home Assistant room at a time: lights, climate, media, covers and scenes. It runs full-screen in a kiosk browser on a tablet that mounts on the wall and also lifts off to sit on a table. It talks directly to Home Assistant over the local WebSocket API. No cloud.

| File | Purpose |
|---|---|
| `room-remote-spec.md` | Authoritative build specification |
| `room-remote-mockup.html` | Visual and interaction reference (open in a browser) |
| `CLAUDE.md` | Working instructions for Claude Code |
| `rooms.example.json` | Sample config; copy to `rooms.json` and edit |

## Stack

SvelteKit (static, SPA) + TypeScript + Vite, using `home-assistant-js-websocket` for the HA connection and the Vite PWA plugin for the installable manifest and service worker. Full rationale in `room-remote-spec.md` section 2.

## Quick start (once scaffolded)

```bash
npm install
cp rooms.example.json rooms.json   # then edit rooms.json with your real entity IDs
npm run dev                         # local dev with mock backend
npm run build                       # production PWA build
npm run preview                     # serve the production build
npm test                            # Vitest unit tests
npm run test:e2e                    # Playwright e2e against the mock backend
```

The app runs against a mock backend with no live Home Assistant instance required. Point it at a real instance only when you want live control.

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

### Emby Live TV guide (optional)

Set `EMBY_URL` and `EMBY_API_KEY` in `.env` to enable a full-screen TV guide,
opened from the **TV Guide** button on the media card in any room that has an
Apple TV. The container proxies Emby under `/emby/*` and injects the API key
server-side, so it never reaches a browser (same pattern as the HA token).
Create the key in Emby under Settings → Advanced → API Keys.

Pressing a programme tells Emby to play that channel on the room's Apple TV via
Emby's session remote. If the Emby app is not already running, the app first
wakes the Apple TV and launches Emby through Home Assistant (`media_player.turn_on`
+ `select_source`), waits for the Emby session to register, then plays — so you do
not need to open the app by hand. This needs the HA Apple TV (pyatv) integration,
with Emby appearing in the player's source list. The Apple TV session and the Live
TV user are auto-detected; override with `EMBY_USER_ID` / `EMBY_APPLE_TV_DEVICE`
if needed.

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

**Security:** the proxy has no built-in login — anyone who can reach `:8085` can
control HA (the blast radius of the wall switches it replaces, on a trusted LAN).
Do not expose it to the internet without fronting it with auth (reverse-proxy
basic auth, Cloudflare Access, etc.).

## Configuration

All rooms and entities are defined in `rooms.json` (shape and rules in spec section 6). Copy the example and edit it:

```bash
cp rooms.example.json rooms.json
```

Key points:

- A card renders only if the room includes that key. Omit `media` for a room and the media card disappears.
- Set `deviceRoomLock` to a room `id` to pin a device to one fixed room and hide the navigation (useful for a wall panel outside that room).
- `icon` maps to the built-in icon set; extend the set as needed.
- `rooms.json` is gitignored. Only `rooms.example.json` is committed.

## Connecting to Home Assistant

1. In Home Assistant, create a **dedicated user** for the panels (for example `remote_panels`), not your admin account.
2. Generate a **long-lived access token** for that user (profile page, bottom of the page).
3. Launch the app on the device and enter the token when prompted. It is stored in the device `localStorage` and is **never** committed to the repo or placed in `rooms.json`.
4. Set the HA WebSocket URL in `rooms.json` under `ha.url`, for example `wss://homeassistant.local:8123/api/websocket`. Prefer `wss://` (TLS); if HA uses a self-signed certificate on the LAN, trust it on the device.

See spec section 7 for the full security model, including the recommended IoT VLAN segmentation.

## Kiosk and hardware

Install the PWA to the home screen so it runs full-screen, and use a kiosk launcher (for example Fully Kiosk Browser on Android) to lock the device to the app, auto-start on boot and manage screen dimming. The recommended hardware is a cheap 8 inch Android tablet on a magnetic wall bracket with pogo-pin charging, plus a matching desk dock so it charges in either location. Full hardware design and bill of materials are in spec section 8.

## Security notes

- No secrets in the repo or the built bundle. The token is entered at runtime on the device.
- `rooms.json`, `.env` and any token files are gitignored.
- Use a scoped HA user so a stolen or compromised panel can do no more than operate the home.

## Status

Specification and design reference complete. Application code not yet scaffolded; follow the build order in `CLAUDE.md` and spec section 9.
