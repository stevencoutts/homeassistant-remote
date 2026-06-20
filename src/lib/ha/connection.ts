import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
  type HassEntities
} from 'home-assistant-js-websocket';
import { loadCredentials } from './auth';
import { fetchRegistries, subscribeRegistryEvents, type Registries } from './registries';
import { deriveRooms } from '$lib/rooms/derive';
import { mockRegistries, mockStates } from '$lib/mock/registries';
import { entities, rooms, status } from '$lib/stores';
import type { EntityMap } from '$lib/types';

let conn: Connection | null = null;
let latestStates: EntityMap = {};
let latestRegistries: Registries | null = null;

export function getConnection(): Connection | null {
  return conn;
}

function recompute() {
  if (latestRegistries) rooms.set(deriveRooms(latestRegistries, latestStates));
}

function toEntityMap(hass: HassEntities): EntityMap {
  // HassEntity already matches EntityState (entity_id, state, attributes).
  return hass as unknown as EntityMap;
}

export async function startHa(): Promise<void> {
  const creds = loadCredentials();

  if (!creds) {
    // Offline/dev: run the same deriveRooms against the fixture.
    latestRegistries = mockRegistries();
    latestStates = mockStates(latestRegistries);
    entities.set(latestStates);
    recompute();
    status.set('offline-mock');
    return;
  }

  status.set('connecting');
  const auth = createLongLivedTokenAuth(creds.url, creds.token);
  conn = await createConnection({ auth }); // auto-reconnects with backoff

  conn.addEventListener('ready', () => status.set('connected'));
  conn.addEventListener('disconnected', () => status.set('disconnected'));
  // Status stays 'connecting' until rooms are ready; set 'connected' after first recompute below.

  subscribeEntities(conn, (hass) => {
    latestStates = toEntityMap(hass);
    entities.set(latestStates);
    recompute();
  });

  latestRegistries = await fetchRegistries(conn);
  recompute();
  status.set('connected');

  await subscribeRegistryEvents(conn, async () => {
    if (conn) {
      latestRegistries = await fetchRegistries(conn);
      recompute();
    }
  });
}
