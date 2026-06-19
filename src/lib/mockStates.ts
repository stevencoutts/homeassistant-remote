import type { EntityMap, RoomsConfig } from './types';

// Generates HA-shaped mock states for every entity in the config.
// Phase 2 deletes this and lets the live WebSocket populate the entities store instead.

const PCTS = [80, 45, 30, 60, 20]; // mockup brightness levels, reused per-room

export function mockStates(config: RoomsConfig): EntityMap {
  const m: EntityMap = {};
  const put = (id: string, state: string, attributes: Record<string, any> = {}) => {
    m[id] = { entity_id: id, state, attributes };
  };

  for (const room of config.rooms) {
    room.lights?.forEach((l, i) => {
      const on = i % 2 === 0; // alternate so the off/disabled state is visible
      const pct = PCTS[i % PCTS.length];
      put(l.entity, on ? 'on' : 'off', {
        friendly_name: l.name,
        brightness: Math.round((pct / 100) * 255),
        supported_color_modes: ['brightness'] // v1: brightness only (spec leaves room for colour)
      });
    });

    // Scenes have no meaningful runtime state in HA (state is a timestamp).
    room.scenes?.forEach((s) => put(s.entity, '2026-01-01T00:00:00+00:00', { friendly_name: s.name }));

    if (room.climate) {
      const trv = /trv/.test(room.climate.entity); // TRVs: heat/off only, no cool/auto
      put(room.climate.entity, 'heat', {
        friendly_name: room.name,
        temperature: 21,
        current_temperature: 21.5,
        min_temp: 5,
        max_temp: 30,
        target_temp_step: 0.5,
        hvac_modes: trv ? ['heat', 'off'] : ['heat', 'cool', 'auto', 'off']
      });
    }

    if (room.media) {
      put(room.media.entity, 'playing', {
        friendly_name: room.name,
        media_title: 'Wandering Star',
        media_artist: 'Portishead',
        source: 'Sonos',
        volume_level: 0.35,
        supported_features: 0xffff
      });
    }

    room.covers?.forEach((c) =>
      put(c.entity, 'open', {
        friendly_name: c.name,
        current_position: 60,
        supported_features: 0xff
      })
    );
  }

  if (config.ha.outdoorTempEntity) {
    put(config.ha.outdoorTempEntity, '14', { unit_of_measurement: '°C' });
  }

  return m;
}
