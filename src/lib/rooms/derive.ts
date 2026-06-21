import type { Registries, EntityEntry } from '$lib/ha/registries';
import type { EntityMap, Room } from '$lib/types';
import { mapAreaIcon } from './iconMap';

const domainOf = (id: string) => id.split('.')[0];
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const NO_FLOOR = Number.MAX_SAFE_INTEGER;

export { mapAreaIcon };

export function deriveRooms(reg: Registries, states: EntityMap): Room[] {
  const deviceArea = new Map(reg.devices.map((d) => [d.id, d.area_id]));
  const floorLevel = new Map(reg.floors.map((f) => [f.floor_id, f.level ?? NO_FLOOR]));

  const areaOf = (e: EntityEntry): string | null =>
    e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) ?? null : null);

  const displayName = (e: EntityEntry): string =>
    e.name ?? states[e.entity_id]?.attributes.friendly_name ?? e.original_name ?? e.entity_id;

  // Bucket visible entities by resolved area.
  const byArea = new Map<string, EntityEntry[]>();
  for (const e of reg.entities) {
    if (e.hidden_by || e.disabled_by) continue;
    if (e.entity_category === 'config' || e.entity_category === 'diagnostic') continue;
    const area = areaOf(e);
    if (!area) continue;
    let arr = byArea.get(area);
    if (!arr) {
      arr = [];
      byArea.set(area, arr);
    }
    arr.push(e);
  }

  // Home-level weather entity (usually has no area); shown beside climate.
  const weatherEntity = reg.entities.find(
    (e) => e.entity_id.startsWith('weather.') && !e.hidden_by && !e.disabled_by
  )?.entity_id;

  const rooms: (Room & { _level: number })[] = [];
  for (const area of reg.areas) {
    const ents = byArea.get(area.area_id) ?? [];
    const pick = (domain: string) =>
      ents
        .filter((e) => domainOf(e.entity_id) === domain)
        .map((e) => ({ name: displayName(e), entity: e.entity_id }))
        .sort(byName);

    // Some lights are exposed twice (e.g. native Hue + a SmartThings mirror).
    // Keep one per name, preferring the Hue entity.
    // ponytail: dedupes by name within an area; two real same-named lights collapse — rename them in HA if that bites.
    const lightEnts = new Map<string, EntityEntry>();
    for (const e of ents) {
      if (domainOf(e.entity_id) !== 'light') continue;
      const key = displayName(e).toLowerCase();
      const cur = lightEnts.get(key);
      if (!cur || (e.platform === 'hue' && cur.platform !== 'hue')) lightEnts.set(key, e);
    }
    const lights = [...lightEnts.values()]
      .map((e) => ({ name: displayName(e), entity: e.entity_id }))
      .sort(byName);
    const scenes = pick('scene');
    const climate = pick('climate')[0];
    const media = pick('media_player');
    const covers = pick('cover');
    // Sonos (and similar) sound-mode switches, shown on the media card.
    const soundModes = ents
      .filter(
        (e) =>
          domainOf(e.entity_id) === 'switch' &&
          (e.entity_id.endsWith('_night_sound') || e.entity_id.endsWith('_speech_enhancement'))
      )
      .map((e) => ({
        name: e.entity_id.endsWith('_night_sound') ? 'Night Sound' : 'Speech',
        entity: e.entity_id
      }))
      .sort(byName);

    if (!lights.length && !climate && !media.length && !covers.length) continue;

    const room: Room & { _level: number } = {
      id: area.area_id,
      name: area.name,
      icon: mapAreaIcon(area.icon),
      _level: area.floor_id ? floorLevel.get(area.floor_id) ?? NO_FLOOR : NO_FLOOR
    };
    if (lights.length) room.lights = lights;
    if (scenes.length) room.scenes = scenes;
    if (climate) room.climate = { entity: climate.entity };
    if (climate && weatherEntity) room.weather = weatherEntity;
    if (media.length) room.media = media;
    if (soundModes.length) room.soundModes = soundModes;
    if (covers.length) room.covers = covers;
    rooms.push(room);
  }

  rooms.sort((a, b) => a._level - b._level || byName(a, b));
  return rooms.map(({ _level, ...r }) => r);
}
