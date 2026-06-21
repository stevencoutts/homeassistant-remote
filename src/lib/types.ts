// Config shape (rooms.json) and the HA-style entity state shape.
// Mock data in phase 1 is shaped exactly like HA states so phase 2 swaps the
// data source without rewriting the components.

export interface NamedEntity {
  name: string;
  entity: string;
}

export interface Room {
  id: string;
  name: string;
  icon: string;
  // A card renders only if its key is present in the room config.
  lights?: NamedEntity[];
  scenes?: NamedEntity[];
  climate?: { entity: string };
  weather?: string; // a home-level weather.* entity, shown beside climate
  media?: NamedEntity[];
  soundModes?: NamedEntity[];
  covers?: NamedEntity[];
}

// Mirrors home-assistant-js-websocket's HassEntity (the bits we use).
export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}

export type EntityMap = Record<string, EntityState>;
