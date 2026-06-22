import { describe, it, expect } from 'vitest';
import { deriveRooms, mapAreaIcon } from './derive';
import type { Registries } from '$lib/ha/registries';
import type { EntityMap } from '$lib/types';

const empty: Registries = { areas: [], floors: [], devices: [], entities: [] };
const states: EntityMap = {};

function ent(entity_id: string, over: Partial<Registries['entities'][number]> = {}) {
  return {
    entity_id,
    area_id: null,
    device_id: null,
    name: null,
    original_name: null,
    hidden_by: null,
    disabled_by: null,
    entity_category: null,
    ...over
  };
}

describe('mapAreaIcon', () => {
  it('maps known mdi names and falls back', () => {
    expect(mapAreaIcon('mdi:bed')).toBe('bed');
    expect(mapAreaIcon('mdi:unknown-thing')).toBe('sofa');
    expect(mapAreaIcon(null)).toBe('sofa');
  });
});

describe('deriveRooms', () => {
  it('collects multiple media players and sound-mode switches', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living', icon: null, floor_id: null }],
      entities: [
        ent('media_player.sonos_beam', { area_id: 'living', original_name: 'Sonos' }),
        ent('media_player.apple_tv', { area_id: 'living', original_name: 'Apple TV' }),
        ent('switch.sonos_beam_night_sound', { area_id: 'living', entity_category: 'config' }),
        ent('switch.sonos_beam_speech_enhancement', { area_id: 'living', entity_category: 'config' })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.media?.map((m) => m.entity)).toEqual(['media_player.apple_tv', 'media_player.sonos_beam']);
    expect(room.soundModes?.map((m) => m.name).sort()).toEqual(['Night Sound', 'Speech']);
  });

  it('collects user-facing switches as power, excluding sound-mode switches', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living', icon: null, floor_id: null }],
      entities: [
        ent('switch.tv_socket', { area_id: 'living', original_name: 'TV socket' }),
        ent('switch.fan', { area_id: 'living', original_name: 'Fan' }),
        ent('switch.sonos_beam_night_sound', { area_id: 'living', entity_category: 'config' })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.power?.map((p) => p.entity)).toEqual(['switch.fan', 'switch.tv_socket']);
    expect(room.soundModes?.map((m) => m.name)).toEqual(['Night Sound']);
  });

  it('dedupes same-named media players, keeping the Sonos over a mirror', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'office', name: 'Steven Office', icon: null, floor_id: null }],
      entities: [
        ent('media_player.steven_office', {
          area_id: 'office',
          original_name: 'Steven Office',
          platform: 'sonos'
        }),
        ent('media_player.steven_office_airplay', {
          area_id: 'office',
          original_name: 'Steven Office',
          platform: 'homekit_controller'
        })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.media?.map((m) => m.entity)).toEqual(['media_player.steven_office']);
  });

  it('collapses a grouped Sonos pair to its coordinator (one media tab)', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'office', name: 'Office', icon: null, floor_id: null }],
      entities: [
        ent('media_player.sonos_office_left', { area_id: 'office', original_name: 'Office Left' }),
        ent('media_player.sonos_office_right', { area_id: 'office', original_name: 'Office Right' })
      ]
    };
    // Both speakers are bonded into one group; the left is the coordinator.
    const st: EntityMap = {
      'media_player.sonos_office_left': {
        entity_id: 'media_player.sonos_office_left',
        state: 'playing',
        attributes: {
          group_members: ['media_player.sonos_office_left', 'media_player.sonos_office_right']
        }
      },
      'media_player.sonos_office_right': {
        entity_id: 'media_player.sonos_office_right',
        state: 'playing',
        attributes: {
          group_members: ['media_player.sonos_office_left', 'media_player.sonos_office_right']
        }
      }
    };
    const [room] = deriveRooms(reg, st);
    expect(room.media?.map((m) => m.entity)).toEqual(['media_player.sonos_office_left']);
  });

  it('keeps the Hue light when the same light is mirrored by SmartThings', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living', icon: null, floor_id: null }],
      entities: [
        ent('light.hue_lamp', { area_id: 'living', original_name: 'Lamp', platform: 'hue' }),
        ent('light.st_lamp', { area_id: 'living', original_name: 'Lamp', platform: 'smartthings' })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.lights?.map((l) => l.entity)).toEqual(['light.hue_lamp']);
  });

  it('attaches a home-level weather entity to rooms that have climate', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living', icon: null, floor_id: null }],
      entities: [ent('climate.living', { area_id: 'living' }), ent('weather.home', {})]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.weather).toBe('weather.home');
  });

  it('makes a room from an area that has a control entity, grouped by domain', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'living', name: 'Living Room', icon: 'mdi:sofa', floor_id: null }],
      entities: [
        ent('light.living_ceiling', { area_id: 'living', original_name: 'Ceiling' }),
        ent('climate.living', { area_id: 'living' }),
        ent('scene.movie', { area_id: 'living', original_name: 'Movie' })
      ]
    };
    const [room] = deriveRooms(reg, states);
    expect(room.id).toBe('living');
    expect(room.name).toBe('Living Room');
    expect(room.icon).toBe('sofa');
    expect(room.lights).toEqual([{ name: 'Ceiling', entity: 'light.living_ceiling' }]);
    expect(room.climate).toEqual({ entity: 'climate.living' });
    expect(room.scenes).toEqual([{ name: 'Movie', entity: 'scene.movie' }]);
    expect(room.media).toBeUndefined();
    expect(room.covers).toBeUndefined();
  });

  it('inherits the area from the device when the entity has none', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'kitchen', name: 'Kitchen', icon: null, floor_id: null }],
      devices: [{ id: 'dev1', area_id: 'kitchen' }],
      entities: [ent('light.k', { device_id: 'dev1' })]
    };
    expect(deriveRooms(reg, states)[0].id).toBe('kitchen');
  });

  it('drops hidden, disabled, config and diagnostic entities', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [
        ent('light.hidden', { area_id: 'a', hidden_by: 'user' }),
        ent('light.disabled', { area_id: 'a', disabled_by: 'user' }),
        ent('light.cfg', { area_id: 'a', entity_category: 'config' }),
        ent('sensor.diag', { area_id: 'a', entity_category: 'diagnostic' })
      ]
    };
    expect(deriveRooms(reg, states)).toEqual([]); // no visible control entity -> no room
  });

  it('skips areas with no control-domain entity (scenes alone do not count)', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [ent('scene.only', { area_id: 'a' })]
    };
    expect(deriveRooms(reg, states)).toEqual([]);
  });

  it('orders rooms by floor level then name', () => {
    const reg: Registries = {
      ...empty,
      areas: [
        { area_id: 'up', name: 'Bedroom', icon: null, floor_id: 'first' },
        { area_id: 'down_b', name: 'Study', icon: null, floor_id: 'ground' },
        { area_id: 'down_a', name: 'Lounge', icon: null, floor_id: 'ground' }
      ],
      floors: [
        { floor_id: 'ground', name: 'Ground', level: 0 },
        { floor_id: 'first', name: 'First', level: 1 }
      ],
      entities: [
        ent('light.1', { area_id: 'up' }),
        ent('light.2', { area_id: 'down_b' }),
        ent('light.3', { area_id: 'down_a' })
      ]
    };
    expect(deriveRooms(reg, states).map((r) => r.name)).toEqual(['Lounge', 'Study', 'Bedroom']);
  });

  it('names entities by precedence: registry name > friendly_name > original_name > id', () => {
    const reg: Registries = {
      ...empty,
      areas: [{ area_id: 'a', name: 'A', icon: null, floor_id: null }],
      entities: [
        ent('light.one', { area_id: 'a', name: 'Override', original_name: 'Ignored' }),
        ent('light.two', { area_id: 'a', original_name: 'Ignored' }),
        ent('light.three', { area_id: 'a', original_name: 'FromOriginal' }),
        ent('light.four', { area_id: 'a' })
      ]
    };
    const st: EntityMap = {
      'light.two': { entity_id: 'light.two', state: 'on', attributes: { friendly_name: 'FromFriendly' } }
    };
    const names = deriveRooms(reg, st)[0].lights!.map((l) => l.name).sort();
    expect(names).toEqual(['FromFriendly', 'FromOriginal', 'Override', 'light.four'].sort());
  });
});
