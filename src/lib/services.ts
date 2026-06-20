import { callService } from 'home-assistant-js-websocket';
import { getConnection } from './ha/connection';
import { activeScene, entities } from './stores';
import { debounce } from './util/debounce';
import type { EntityState, EntityMap } from './types';

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target: { entity_id: string | string[] };
}

// --- Pure builders (unit-tested) ---
const call = (domain: string, service: string, entity_id: string, data: Record<string, unknown> = {}): ServiceCall => ({
  domain, service, data, target: { entity_id }
});

export const lightToggleCall = (id: string) => call('light', 'toggle', id);
export const brightnessCall = (id: string, pct: number) => call('light', 'turn_on', id, { brightness_pct: pct });
export const temperatureCall = (id: string, temperature: number) => call('climate', 'set_temperature', id, { temperature });
export const hvacModeCall = (id: string, hvac_mode: string) => call('climate', 'set_hvac_mode', id, { hvac_mode });
export const playPauseCall = (id: string) => call('media_player', 'media_play_pause', id);
export const prevCall = (id: string) => call('media_player', 'media_previous_track', id);
export const nextCall = (id: string) => call('media_player', 'media_next_track', id);
export const volumeCall = (id: string, pct: number) => call('media_player', 'volume_set', id, { volume_level: pct / 100 });
export const coverPositionCall = (id: string, position: number) => call('cover', 'set_cover_position', id, { position });
export const openCoverCall = (id: string) => call('cover', 'open_cover', id);
export const closeCoverCall = (id: string) => call('cover', 'close_cover', id);
export const stopCoverCall = (id: string) => call('cover', 'stop_cover', id);
export const sceneCall = (id: string) => call('scene', 'turn_on', id);

// --- Dispatcher: live HA when connected, optimistic local mutation when offline-mock ---
function dispatch(c: ServiceCall, optimistic?: (e: EntityState) => EntityState) {
  const conn = getConnection();
  if (conn) {
    callService(conn, c.domain, c.service, c.data, c.target)
      .catch((err) => console.error('HA service call failed', err));
    return; // UI follows HA-pushed state
  }
  if (optimistic) {
    const entityId = c.target.entity_id;
    if (typeof entityId === 'string') {
      entities.update((m) => {
        const e = m[entityId];
        return e ? { ...m, [entityId]: optimistic(e) } : m;
      });
    }
  }
}

// --- Actions consumed by components (same names/signatures as before) ---
export function toggleLight(id: string) {
  dispatch(lightToggleCall(id), (e) => ({ ...e, state: e.state === 'on' ? 'off' : 'on' }));
}

const writeBrightness = debounce((id: string, pct: number) => dispatch(brightnessCall(id, pct)), 200);
export function setLightBrightness(id: string, pct: number) {
  // Always update the store so the slider tracks live during drag (optimistic-then-reconciled).
  // When connected, HA-pushed state reconciles shortly after; debounce the write to avoid flooding.
  entities.update((m) => {
    const e = m[id];
    return e ? { ...m, [id]: { ...e, state: 'on', attributes: { ...e.attributes, brightness: Math.round((pct / 100) * 255) } } } : m;
  });
  if (getConnection()) writeBrightness(id, pct);
}

export function setTemperature(id: string, temp: number) {
  dispatch(temperatureCall(id, temp), (e) => ({ ...e, attributes: { ...e.attributes, temperature: temp } }));
}
export function setHvacMode(id: string, mode: string) {
  dispatch(hvacModeCall(id, mode), (e) => ({ ...e, state: mode }));
}
export function mediaPlayPause(id: string) {
  dispatch(playPauseCall(id), (e) => ({ ...e, state: e.state === 'playing' ? 'paused' : 'playing' }));
}
export function mediaPrevious(id: string) { dispatch(prevCall(id)); }
export function mediaNext(id: string) { dispatch(nextCall(id)); }

const writeVolume = debounce((id: string, pct: number) => dispatch(volumeCall(id, pct)), 200);
export function setVolume(id: string, pct: number) {
  // Always update the store so the slider tracks live during drag (optimistic-then-reconciled).
  entities.update((m) => {
    const e = m[id];
    return e ? { ...m, [id]: { ...e, attributes: { ...e.attributes, volume_level: pct / 100 } } } : m;
  });
  if (getConnection()) writeVolume(id, pct);
}

const writeCover = debounce((id: string, pos: number) => dispatch(coverPositionCall(id, pos)), 200);
export function setCoverPosition(id: string, pos: number) {
  // Always update the store so the slider tracks live during drag (optimistic-then-reconciled).
  entities.update((m) => {
    const e = m[id];
    return e ? { ...m, [id]: { ...e, state: pos > 0 ? 'open' : 'closed', attributes: { ...e.attributes, current_position: pos } } } : m;
  });
  if (getConnection()) writeCover(id, pos);
}
export function openCover(id: string) { dispatch(openCoverCall(id), (e) => ({ ...e, state: 'open', attributes: { ...e.attributes, current_position: 100 } })); }
export function closeCover(id: string) { dispatch(closeCoverCall(id), (e) => ({ ...e, state: 'closed', attributes: { ...e.attributes, current_position: 0 } })); }
export function stopCover(id: string) { dispatch(stopCoverCall(id)); }

export function activateScene(roomId: string, sceneEntity: string) {
  dispatch(sceneCall(sceneEntity));
  activeScene.update((m) => ({ ...m, [roomId]: sceneEntity })); // best-effort highlight
}

export function anyLightOn(states: EntityMap, ids: string[]): boolean {
  return ids.some((id) => states[id]?.state === 'on');
}

export function lightsCall(entityIds: string[], on: boolean): ServiceCall {
  return { domain: 'light', service: on ? 'turn_on' : 'turn_off', data: {}, target: { entity_id: entityIds } };
}

export function setLights(entityIds: string[], on: boolean) {
  const conn = getConnection();
  if (conn) {
    callService(conn, 'light', on ? 'turn_on' : 'turn_off', {}, { entity_id: entityIds })
      .catch((err) => console.error('HA service call failed', err));
    return;
  }
  entities.update((m) => {
    const next = { ...m };
    for (const id of entityIds) {
      const e = next[id];
      if (e) next[id] = { ...e, state: on ? 'on' : 'off' };
    }
    return next;
  });
}
