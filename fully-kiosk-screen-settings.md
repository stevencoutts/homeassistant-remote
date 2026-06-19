# Fully Kiosk Browser — Screen Dimming and Charging-Aware Behaviour

How to make the room remote dim its screen when idle (instead of switching off completely),
and how to tie that behaviour to whether the tablet is on charge so a portable unit does not
flatten its battery.

Target device for this guide: Samsung Galaxy Tab A9 8.7" (Wi-Fi), running Fully Kiosk Browser.
Settings names follow the Android version of Fully Kiosk. Some options require the one-off
**Fully PLUS** licence; these are marked **(PLUS)**.

---

## 1. The goal in plain terms

- **On the dock (charging):** screen stays on but drops to a low brightness when nobody is
  using it. A faint clock or dashboard, tap to wake to full brightness.
- **Off the dock (on battery):** screen sleeps normally after a short timeout to preserve
  battery, and wakes on tap.

The first half is pure Fully Kiosk configuration. The charging-aware half is best done with a
small Home Assistant automation (section 4), because HA already knows the charging state.

---

## 2. Core dimming settings (Fully Kiosk)

Open Fully Kiosk, then the settings menu (swipe from the left edge, or the gear icon).

**Screensaver section**

- **Enable Screensaver:** ON. This is what triggers the dimmed idle state.
- **Screensaver Timer (seconds):** how long with no touch before it dims, e.g. `60`.
- **Screensaver Brightness (PLUS):** set a low value rather than zero, e.g. `5` to `15` on the
  0 to 255 scale. This is the key setting: a low non-zero value dims the screen instead of
  turning it off.
- **Screensaver URL:** leave blank to dim the current page, set to `dim://` for a plain dimmed
  screen, or point at a simple clock page. Avoid `black://` if you want a visible glow.
- **Use Screensaver While Plugged / Also When Charging:** ON, so it dims while docked.

**Important:** do not enable any "turn screen fully off in screensaver" option if you want it to
dim rather than go dark. The low Screensaver Brightness value is what gives the dimmed look.

**Device Management / Power section**

- **Keep Screen On:** ON. Stops Android's own timeout fighting Fully's screensaver.
- **Screen Brightness:** set your normal "awake" brightness here (or leave on system/auto).
- **Screen Off Timer:** leave at `0` (disabled) while docked, since the screensaver handles idle.

**Motion wake (optional, PLUS)**

- **Screen On on Motion / Visual Motion Detection:** ON to wake the screen from dim when someone
  approaches, using the front camera, rather than needing a tap. Handy for a wall panel.

---

## 3. Quick reference

| Setting | Value | Why |
|---|---|---|
| Enable Screensaver | ON | Triggers the idle dim |
| Screensaver Timer | ~60 s | Delay before dimming |
| Screensaver Brightness (PLUS) | 5 to 15 (of 255) | Dim, not off |
| Screensaver URL | blank or `dim://` | Keeps a faint display |
| Use screensaver while charging | ON | Dim while docked |
| Keep Screen On | ON | Prevents Android sleeping it |
| Screen Off Timer | 0 (while docked) | Screensaver handles idle |
| Screen On on Motion (PLUS) | ON (optional) | Wake without touching |

---

## 4. Charging-aware behaviour (recommended)

A dimmed screen still draws power, so leaving it lit off the dock will drain the A9's 5100 mAh
battery in a few hours. The clean fix is to behave differently on battery versus on charge.

### Option A — Home Assistant automation (most reliable)

Install the **Fully Kiosk Browser** integration in Home Assistant (Settings → Devices &
Services → Add Integration → Fully Kiosk Browser; you will need the device IP and the Fully
remote-admin password). It exposes, among others:

- a binary sensor for plugged/charging state,
- the screen on/off and screensaver controls,
- a screen brightness number entity.

Example automations (adjust entity IDs to match your device):

```yaml
# When unplugged: short timeout, let it sleep to save battery
- alias: Remote panel - on battery, allow sleep
  trigger:
    - platform: state
      entity_id: binary_sensor.room_remote_plugged_in
      to: "off"
  action:
    - service: fully_kiosk.set_config
      target:
        device_id: <room_remote_device_id>
      data:
        key: timeToScreensaverV2
        value: 30          # dim quickly
    - service: fully_kiosk.set_config
      target:
        device_id: <room_remote_device_id>
      data:
        key: screenOffInScreensaver
        value: true        # actually sleep when on battery

# When plugged in: keep it on but dim when idle
- alias: Remote panel - charging, stay dimmed
  trigger:
    - platform: state
      entity_id: binary_sensor.room_remote_plugged_in
      to: "on"
  action:
    - service: fully_kiosk.set_config
      target:
        device_id: <room_remote_device_id>
      data:
        key: screenOffInScreensaver
        value: false       # dim, don't sleep
    - service: fully_kiosk.set_config
      target:
        device_id: <room_remote_device_id>
      data:
        key: timeToScreensaverV2
        value: 60
```

This gives you exactly the requested behaviour: dimmed-but-on while docked, proper sleep on
battery, all driven by the charging state HA already tracks.

### Option B — Fully Kiosk "Run on Events" (no Home Assistant)

If you would rather keep it self-contained, Fully Kiosk can run actions on power events. In the
settings, find the events / "Run on Events" area and bind JavaScript to the power events, e.g.:

- **On Power Connected:** `fully.setScreensaverBrightness(10);` and keep screensaver on.
- **On Power Disconnected:** raise the screen-off behaviour so it sleeps on battery.

The exact event hooks vary slightly by Fully version; the Home Assistant route in Option A is
more robust and easier to adjust later.

---

## 5. Battery longevity note

Whichever route you pick, an always-docked tablet also benefits from charge limiting so it does
not sit at 100% continuously (the main long-term failure mode for these panels). Options:

- a launcher or device setting that caps charging where supported, or
- a smart plug driven by Home Assistant to cycle the charger (e.g. hold the tablet between
  roughly 40% and 80%), using the battery-level sensor the Fully Kiosk integration exposes.

---

## 6. Summary

1. Set the Screensaver to a low non-zero brightness so idle = dim, not off.
2. Keep Screen On and disable the Android screen-off timer while docked.
3. Tie "stay dimmed vs sleep" to charging state via the Home Assistant Fully Kiosk integration.
4. Add charge limiting to protect the battery over time.
