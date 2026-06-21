import type { Registries, EntityEntry } from '$lib/ha/registries';
import type { EntityMap } from '$lib/types';

// Offline fixture: the five demo rooms as HA-style registry entries + states.
// deriveRooms() runs against this exactly as it does against a live HA.

interface Seed {
  area: string;
  name: string;
  icon: string;
  lights: string[];
  scenes: string[];
  climate?: string;
  media?: string;
  covers?: string[];
  power?: string[];
}

interface SeedWithFloor extends Seed {
  floor: string;
  level: number;
}

const SEEDS: SeedWithFloor[] = [
  {
    area: 'living', name: 'Living Room', icon: 'mdi:sofa', floor: 'f0', level: 0,
    lights: ['Ceiling', 'Lamps', 'TV backlight'],
    scenes: ['Bright', 'Movie', 'Evening', 'Off'],
    climate: 'living_room', media: 'living_sonos', covers: ['Blinds'],
    power: ['TV socket', 'Fan']
  },
  {
    area: 'kitchen', name: 'Kitchen', icon: 'mdi:silverware-fork-knife', floor: 'f1', level: 1,
    lights: ['Spots', 'Under-cabinet'],
    scenes: ['Cooking', 'Dim', 'Off'],
    climate: 'kitchen', media: 'kitchen_echo'
  },
  {
    area: 'bedroom', name: 'Bedroom', icon: 'mdi:bed', floor: 'f2', level: 2,
    lights: ['Ceiling', 'Bedside L', 'Bedside R'],
    scenes: ['Wake up', 'Read', 'Night', 'Off'],
    climate: 'bedroom_trv', media: 'bedroom_homepod', covers: ['Curtains']
  },
  {
    area: 'office', name: 'Office', icon: 'mdi:desk', floor: 'f3', level: 3,
    lights: ['Desk', 'Ceiling'],
    scenes: ['Focus', 'Call', 'Off'],
    climate: 'office', media: 'office_desktop', covers: ['Blinds'],
    power: ['Monitor', 'Heater']
  },
  {
    area: 'bath', name: 'Bathroom', icon: 'mdi:shower', floor: 'f4', level: 4,
    lights: ['Main', 'Mirror'],
    scenes: ['Bright', 'Relax', 'Off'],
    climate: 'bathroom_trv'
  }
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function ent(entity_id: string, area: string, name: string | null): EntityEntry {
  return {
    entity_id,
    area_id: area,
    device_id: null,
    name: null,
    original_name: name,
    hidden_by: null,
    disabled_by: null,
    entity_category: null
  };
}

export function mockRegistries(): Registries {
  const entities: EntityEntry[] = [];
  for (const s of SEEDS) {
    s.lights.forEach((n) => entities.push(ent(`light.${s.area}_${slug(n)}`, s.area, n)));
    s.scenes.forEach((n) => entities.push(ent(`scene.${s.area}_${slug(n)}`, s.area, n)));
    if (s.climate) entities.push(ent(`climate.${s.climate}`, s.area, s.name));
    if (s.media) entities.push(ent(`media_player.${s.media}`, s.area, s.name));
    s.covers?.forEach((n) => entities.push(ent(`cover.${s.area}_${slug(n)}`, s.area, n)));
    s.power?.forEach((n) => entities.push(ent(`switch.${s.area}_${slug(n)}`, s.area, n)));
  }

  // Build unique floors from SEEDS
  const floorsMap = new Map<string, number>();
  for (const s of SEEDS) {
    if (!floorsMap.has(s.floor)) {
      floorsMap.set(s.floor, s.level);
    }
  }
  const floors = Array.from(floorsMap.entries()).map(([floor_id, level]) => ({
    floor_id,
    name: floor_id.charAt(0).toUpperCase() + floor_id.slice(1),
    level
  }));

  return {
    areas: SEEDS.map((s) => ({ area_id: s.area, name: s.name, icon: s.icon, floor_id: s.floor })),
    floors,
    devices: [],
    entities
  };
}

const PCTS = [80, 45, 30, 60, 20];

export function mockStates(reg: Registries): EntityMap {
  const m: EntityMap = {};
  const put = (id: string, state: string, attributes: Record<string, any> = {}) => {
    m[id] = { entity_id: id, state, attributes };
  };
  let li = 0;
  for (const e of reg.entities) {
    const domain = e.entity_id.split('.')[0];
    const fn = e.original_name ?? e.entity_id;
    if (domain === 'light') {
      const on = li % 2 === 0;
      put(e.entity_id, on ? 'on' : 'off', {
        friendly_name: fn,
        brightness: Math.round((PCTS[li % PCTS.length] / 100) * 255),
        supported_color_modes: ['brightness']
      });
      li++;
    } else if (domain === 'scene') {
      put(e.entity_id, '2026-01-01T00:00:00+00:00', { friendly_name: fn });
    } else if (domain === 'climate') {
      const trv = /trv/.test(e.entity_id);
      put(e.entity_id, 'heat', {
        friendly_name: fn,
        temperature: 21,
        current_temperature: 21.5,
        min_temp: 5,
        max_temp: 30,
        target_temp_step: 0.5,
        hvac_modes: trv ? ['heat', 'off'] : ['heat', 'cool', 'auto', 'off']
      });
    } else if (domain === 'media_player') {
      put(e.entity_id, 'playing', {
        friendly_name: fn,
        media_title: 'Wandering Star',
        media_artist: 'Portishead',
        source: 'Sonos',
        volume_level: 0.35,
        supported_features: 0xffff
      });
    } else if (domain === 'cover') {
      put(e.entity_id, 'open', { friendly_name: fn, current_position: 60, supported_features: 0xff });
    } else if (domain === 'switch') {
      put(e.entity_id, /socket|monitor/.test(e.entity_id) ? 'on' : 'off', { friendly_name: fn });
    }
  }
  return m;
}
