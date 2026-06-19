import { activeScene, entities } from './stores';
import type { EntityState } from './types';

// Phase 1: these mutate the local entities store optimistically so the UI is interactive.
// Phase 2: each becomes a call_service over the HA WebSocket; the UI then follows the
// state HA pushes back, and continuous writes (brightness, volume, cover position) get
// debounced ~200ms here so dragging doesn't flood HA. No debounce in phase 1 — there is
// nothing to flood, and the on-screen percentage must track the slider live.

function patch(id: string, change: (e: EntityState) => EntityState) {
  entities.update((m) => {
    const e = m[id];
    if (!e) return m;
    return { ...m, [id]: change(e) };
  });
}

export function toggleLight(id: string) {
  patch(id, (e) => ({ ...e, state: e.state === 'on' ? 'off' : 'on' }));
}

export function setLightBrightness(id: string, pct: number) {
  patch(id, (e) => ({
    ...e,
    state: 'on',
    attributes: { ...e.attributes, brightness: Math.round((pct / 100) * 255) }
  }));
}

export function setTemperature(id: string, temp: number) {
  patch(id, (e) => ({ ...e, attributes: { ...e.attributes, temperature: temp } }));
}

export function setHvacMode(id: string, mode: string) {
  patch(id, (e) => ({ ...e, state: mode }));
}

export function mediaPlayPause(id: string) {
  patch(id, (e) => ({ ...e, state: e.state === 'playing' ? 'paused' : 'playing' }));
}

// Previous/next have no observable effect on mock data; real service calls land in phase 2.
export function mediaPrevious(_id: string) {}
export function mediaNext(_id: string) {}

export function setVolume(id: string, pct: number) {
  patch(id, (e) => ({ ...e, attributes: { ...e.attributes, volume_level: pct / 100 } }));
}

export function setCoverPosition(id: string, pos: number) {
  patch(id, (e) => ({
    ...e,
    state: pos > 0 ? 'open' : 'closed',
    attributes: { ...e.attributes, current_position: pos }
  }));
}

export function openCover(id: string) {
  setCoverPosition(id, 100);
}
export function closeCover(id: string) {
  setCoverPosition(id, 0);
}
export function stopCover(_id: string) {} // no-op against mock data

export function activateScene(roomId: string, sceneEntity: string) {
  activeScene.update((m) => ({ ...m, [roomId]: sceneEntity }));
}
