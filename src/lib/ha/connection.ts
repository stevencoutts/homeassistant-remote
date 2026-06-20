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

const CONNECT_TIMEOUT_MS = 10000;

let conn: Connection | null = null;
let latestStates: EntityMap = {};
let latestRegistries: Registries | null = null;
let unsubEntities: (() => void) | null = null;
let unsubRegistry: (() => void) | null = null;

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

// Live HA connection. Requires stored credentials; rejects on failure so the
// settings form can show the error. No offline fallback here.
export async function connectLive(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error('No credentials stored');

  status.set('connecting');
  const auth = createLongLivedTokenAuth(creds.url, creds.token);

  // ponytail: a timed-out createConnection may keep retrying in the background
  // until the next reload; acceptable for a wrong-URL setup mistake.
  conn = await Promise.race([
    createConnection({ auth }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), CONNECT_TIMEOUT_MS)
    )
  ]);

  conn.addEventListener('ready', () => status.set('connected'));
  conn.addEventListener('disconnected', () => status.set('disconnected'));

  unsubEntities = subscribeEntities(conn, (hass) => {
    latestStates = toEntityMap(hass);
    entities.set(latestStates);
    recompute();
  });

  latestRegistries = await fetchRegistries(conn);
  recompute();
  status.set('connected');

  unsubRegistry = await subscribeRegistryEvents(conn, async () => {
    if (conn) {
      latestRegistries = await fetchRegistries(conn);
      recompute();
    }
  });
}

// Offline demo: run the same deriveRooms against the mock fixture.
export function startMock(): void {
  latestRegistries = mockRegistries();
  latestStates = mockStates(latestRegistries);
  entities.set(latestStates);
  recompute();
  status.set('offline-mock');
}

// Tear down the live connection and reset to a pre-connection state.
export function disconnect(): void {
  unsubEntities?.();
  unsubRegistry?.();
  unsubEntities = null;
  unsubRegistry = null;
  conn?.close();
  conn = null;
  latestStates = {};
  latestRegistries = null;
  entities.set({});
  rooms.set([]);
  status.set('connecting');
}
