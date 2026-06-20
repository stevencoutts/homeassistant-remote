import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { EntityMap, Room } from './types';

// Single source of UI truth at runtime. Phase 1: filled from mockStates.
// Phase 2: filled and kept in sync by the HA WebSocket subscription.
export const entities = writable<EntityMap>({});

// Best-effort "active scene" highlight per room (HA rarely exposes which scene is live).
export const activeScene = writable<Record<string, string>>({});

// Selected room, persisted across reloads (spec 4.1).
const ROOM_KEY = 'room-remote:currentRoom';
const initialRoom = browser ? localStorage.getItem(ROOM_KEY) ?? '' : '';
export const currentRoomId = writable<string>(initialRoom);
if (browser) {
  currentRoomId.subscribe((id) => {
    if (id) localStorage.setItem(ROOM_KEY, id);
  });
}

// Derived room list: populated by startHa() from registries + entity states.
export const rooms = writable<Room[]>([]);

// Connection status indicator.
export const status = writable<'connecting' | 'connected' | 'disconnected' | 'offline-mock'>(
  'connecting'
);

// Drives the first-run / reconfigure settings overlay.
export const showSettings = writable<boolean>(false);
