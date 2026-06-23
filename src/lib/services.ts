import { callService } from 'home-assistant-js-websocket';
import { get } from 'svelte/store';
import { getConnection } from './ha/connection';
import { activeScene, entities } from './stores';
import { debounce, throttle } from './util/debounce';
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
// Explicit pause/play rather than the combined media_play_pause toggle, which
// some players (e.g. Apple TV) do not honour.
export const pauseCall = (id: string) => call('media_player', 'media_pause', id);
export const playCall = (id: string) => call('media_player', 'media_play', id);
export const prevCall = (id: string) => call('media_player', 'media_previous_track', id);
export const nextCall = (id: string) => call('media_player', 'media_next_track', id);
export const volumeCall = (id: string, pct: number) => call('media_player', 'volume_set', id, { volume_level: pct / 100 });
export const coverPositionCall = (id: string, position: number) => call('cover', 'set_cover_position', id, { position });
export const openCoverCall = (id: string) => call('cover', 'open_cover', id);
export const closeCoverCall = (id: string) => call('cover', 'close_cover', id);
export const stopCoverCall = (id: string) => call('cover', 'stop_cover', id);
export const sceneCall = (id: string) => call('scene', 'turn_on', id);
export const mediaTurnOnCall = (id: string) => call('media_player', 'turn_on', id);
export const selectSourceCall = (id: string, source: string) =>
  call('media_player', 'select_source', id, { source });
export const muteCall = (id: string, mute: boolean) => call('media_player', 'volume_mute', id, { is_volume_muted: mute });
export const switchToggleCall = (id: string) => call('switch', 'toggle', id);
export const playMediaCall = (id: string, contentId: string, contentType: string) =>
  call('media_player', 'play_media', id, { media_content_id: contentId, media_content_type: contentType });
export const shuffleCall = (id: string, shuffle: boolean) =>
  call('media_player', 'shuffle_set', id, { shuffle });

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
  const playing = get(entities)[id]?.state === 'playing';
  dispatch(playing ? pauseCall(id) : playCall(id), (e) => ({
    ...e,
    state: playing ? 'paused' : 'playing'
  }));
}
export function playFavourite(id: string, contentId: string, contentType: string) {
  dispatch(playMediaCall(id, contentId, contentType));
}
// Toggle shuffle on the now-playing card; reflects HA's `shuffle` attribute.
export function toggleShuffle(id: string, on: boolean) {
  dispatch(shuffleCall(id, on), (e) => ({ ...e, attributes: { ...e.attributes, shuffle: on } }));
}
// Neutral alias used by the media browser; same play path as favourites.
export function playMedia(id: string, contentId: string, contentType: string) {
  dispatch(playMediaCall(id, contentId, contentType));
}
// Play that surfaces success/failure to the caller, so the media browser can
// show a real error instead of swallowing it (the fire-and-forget `dispatch`
// only logs to the console). Resolves immediately in offline-mock.
export async function playMediaResult(id: string, contentId: string, contentType: string): Promise<void> {
  const conn = getConnection();
  if (!conn) return;
  const c = playMediaCall(id, contentId, contentType);
  await callService(conn, c.domain, c.service, c.data, c.target);
}
// Set shuffle on a player (Sonos: applies to the current queue). Awaitable so
// callers can sequence it after play_media. No-op offline.
export async function setShuffle(id: string, shuffle: boolean): Promise<void> {
  const conn = getConnection();
  if (!conn) return;
  const c = shuffleCall(id, shuffle);
  await callService(conn, c.domain, c.service, c.data, c.target);
}
export function mediaPrevious(id: string) { dispatch(prevCall(id)); }
export function mediaNext(id: string) { dispatch(nextCall(id)); }
export function mediaMute(id: string, mute: boolean) {
  dispatch(muteCall(id, mute), (e) => ({ ...e, attributes: { ...e.attributes, is_volume_muted: mute } }));
}
// Wake an Apple TV and launch an app on it (used to bring up Emby before
// playing). select_source uses the app name as the Apple TV integration lists
// it in source_list.
export function mediaTurnOn(id: string) {
  dispatch(mediaTurnOnCall(id));
}
export function mediaSelectSource(id: string, source: string) {
  dispatch(selectSourceCall(id, source));
}
export function toggleSwitch(id: string) {
  const on = get(entities)[id]?.state === 'on';
  dispatch(switchToggleCall(id), (e) => ({ ...e, state: on ? 'off' : 'on' }));
}
export function toggleSoundMode(id: string) {
  const on = get(entities)[id]?.state === 'on';
  dispatch(switchToggleCall(id), (e) => ({ ...e, state: on ? 'off' : 'on' }));
}

// Throttled (not debounced) so the speaker tracks the slider during a drag.
const writeVolume = throttle((id: string, pct: number) => dispatch(volumeCall(id, pct)), 120);
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
