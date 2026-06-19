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
