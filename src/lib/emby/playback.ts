import type { PlayTarget } from './types';
import { findPlayTarget, listPlayTargets, playItem } from './client';

// Shared "resolve this room's device and play to it" controller, lifted from the
// EPG guide so the VOD browser does not duplicate the session logic. It owns the
// stable device binding (Emby DeviceId in localStorage, keyed by HA entity_id),
// the wake-and-retry when no session is awake, and verify-and-correct when the
// target was only a best-effort guess. Framework-agnostic; the UI passes
// callbacks for toasts, waking the device and reading HA entity state.

export interface EntitySnap {
  state: string;
  source: string;
  title: string;
  art: string;
}

export interface PlaybackDeps {
  appleTvHint?: string;
  appleTvIp?: string;
  appleTvEntity?: string;
  flash: (msg: string) => void;
  // Turn the device on and select the Emby source (HA service calls).
  wake?: () => void;
  // Current HA state for the device, used to verify playback actually landed.
  snapshot?: () => EntitySnap | null;
  // The title HA reports the device is playing via Emby, if any.
  nowPlayingTitle?: () => string | undefined;
  // Injectable for tests; defaults to setTimeout.
  delayMs?: (ms: number) => Promise<void>;
}

export interface PlaybackController {
  ensureTarget(): Promise<PlayTarget | null>;
  play(itemId: string, label: string): Promise<void>;
  readonly target: PlayTarget | null;
}

export function createPlaybackController(deps: PlaybackDeps): PlaybackController {
  const delay = deps.delayMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bindingKey = `emby_binding:${deps.appleTvEntity ?? ''}`;
  let target: PlayTarget | null = null;

  function loadDeviceId(): string | undefined {
    try {
      const raw = localStorage.getItem(bindingKey);
      return raw ? (JSON.parse(raw) as { deviceId: string }).deviceId : undefined;
    } catch {
      return undefined;
    }
  }
  function saveDeviceId(t: PlayTarget) {
    if (!t.deviceId) return;
    try {
      localStorage.setItem(bindingKey, JSON.stringify({ deviceId: t.deviceId }));
    } catch {
      /* ignore */
    }
  }
  function clearBinding() {
    try {
      localStorage.removeItem(bindingKey);
    } catch {
      /* ignore */
    }
  }

  // True when we can identify this room's device positively — known IP, or the
  // target's name matches the room's player name. When confident we never bounce
  // playback to another session during verification.
  function confidentTarget(t: PlayTarget | null): boolean {
    if (!t) return false;
    if (deps.appleTvIp) return true;
    if (!deps.appleTvHint) return false;
    const a = t.name.toLowerCase();
    const h = deps.appleTvHint.toLowerCase();
    return a.includes(h) || h.includes(a);
  }

  async function ensureTarget(): Promise<PlayTarget | null> {
    let storedDeviceId = loadDeviceId();
    // Drop a stale binding whose device is no longer an active session.
    if (storedDeviceId) {
      const live = await listPlayTargets();
      if (!live.some((s) => s.deviceId === storedDeviceId)) {
        clearBinding();
        storedDeviceId = undefined;
      }
    }
    const npt = deps.nowPlayingTitle?.();
    const fresh = await findPlayTarget(deps.appleTvHint, deps.appleTvIp, storedDeviceId, npt);
    if (fresh) {
      target = fresh;
      return fresh;
    }

    // No sessions at all — try to wake the device, then poll for it.
    if (!deps.appleTvEntity) return null;
    deps.flash('Starting Emby on the device…');
    deps.wake?.();
    for (let i = 0; i < 12; i++) {
      await delay(1500);
      const t = await findPlayTarget(deps.appleTvHint, deps.appleTvIp, storedDeviceId, npt);
      if (t) {
        target = t;
        saveDeviceId(t);
        return t;
      }
    }
    return null;
  }

  async function play(itemId: string, label: string): Promise<void> {
    const t = await ensureTarget();
    if (!t) {
      deps.flash('Could not reach the device. Open Emby on it and try again.');
      return;
    }
    const before = deps.snapshot?.() ?? null;
    try {
      await playItem(t.sessionId, itemId);
      deps.flash(`Playing ${label} on ${t.name}`);
    } catch (err) {
      deps.flash(`Could not start playback${err instanceof Error ? ': ' + err.message : ''}.`);
      return;
    }

    if (confidentTarget(t)) {
      saveDeviceId(t);
      return;
    }
    // Best-effort guess — verify in the background and self-correct.
    verifyAndCorrect(t, itemId, label, before).catch(() => {});
  }

  async function verifyAndCorrect(
    t: PlayTarget,
    itemId: string,
    label: string,
    before: EntitySnap | null
  ) {
    if (!before) return; // cannot verify without a baseline
    let changed = false;
    for (let i = 0; i < 4; i++) {
      await delay(2000);
      const after = deps.snapshot?.() ?? null;
      if (
        after &&
        (after.state !== before.state ||
          after.source !== before.source ||
          after.title !== before.title ||
          after.art !== before.art)
      ) {
        changed = true;
        break;
      }
    }
    if (changed) {
      saveDeviceId(t);
      return;
    }
    // This room's TV did not change — only correct when there is exactly one
    // other video session, otherwise we cannot tell which is this room's.
    try {
      const all = await listPlayTargets();
      const others = all.filter((s) => s.deviceId && s.deviceId !== t.deviceId);
      if (others.length !== 1) return;
      const other = others[0];
      await playItem(other.sessionId, itemId);
      target = other;
      saveDeviceId(other);
      deps.flash(`Playing ${label} on ${other.name}`);
    } catch {
      /* silent — retry on next play */
    }
  }

  return {
    ensureTarget,
    play,
    get target() {
      return target;
    }
  };
}
