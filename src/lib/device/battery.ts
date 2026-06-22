import { readable } from 'svelte/store';

export interface BatteryState {
  // 0–100, or null when unknown.
  level: number | null;
  charging: boolean;
  // false when no battery source is available (e.g. a desktop browser with no
  // Battery API and not running inside Fully Kiosk) — used to hide the UI.
  available: boolean;
}

// Fully Kiosk Browser injects a `fully` object with device hooks. We read the
// local tablet's battery from it; on a normal browser we fall back to the web
// Battery API, which many browsers no longer expose — in that case the
// indicator simply hides.
interface FullyApi {
  getBatteryLevel?: () => number | string;
  isPlugged?: () => boolean;
}
interface WebBattery {
  level: number;
  charging: boolean;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
}

const POLL_MS = 30_000;

export const battery = readable<BatteryState>(
  { level: null, charging: false, available: false },
  (set) => {
    if (typeof window === 'undefined') return;
    let stopped = false;
    let web: WebBattery | null = null;
    let onChange: (() => void) | null = null;

    const readFully = (): boolean => {
      const f = (window as unknown as { fully?: FullyApi }).fully;
      if (!f || typeof f.getBatteryLevel !== 'function') return false;
      const lvl = Number(f.getBatteryLevel());
      if (Number.isNaN(lvl)) return false;
      const charging = typeof f.isPlugged === 'function' ? !!f.isPlugged() : false;
      set({ level: Math.max(0, Math.min(100, Math.round(lvl))), charging, available: true });
      return true;
    };

    const poll = () => {
      if (stopped) return;
      // Prefer the Fully Kiosk reading (the real device); else the web battery.
      if (readFully()) return;
      if (web) {
        set({ level: Math.round(web.level * 100), charging: web.charging, available: true });
      }
    };

    const nav = navigator as unknown as { getBattery?: () => Promise<WebBattery> };
    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((b) => {
          if (stopped) return;
          web = b;
          onChange = () => poll();
          b.addEventListener('levelchange', onChange);
          b.addEventListener('chargingchange', onChange);
          poll();
        })
        .catch(() => {});
    }

    poll();
    const timer = setInterval(poll, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      if (web && onChange) {
        web.removeEventListener('levelchange', onChange);
        web.removeEventListener('chargingchange', onChange);
      }
    };
  }
);
