import { browser } from '$app/environment';
import { writable, derived } from 'svelte/store';
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

// Derived room list: populated by connectLive() or startMock() from registries + entity states.
export const rooms = writable<Room[]>([]);

// Connection status indicator.
export const status = writable<'connecting' | 'connected' | 'disconnected' | 'offline-mock'>(
  'connecting'
);

// Drives the first-run / reconfigure settings overlay.
export const showSettings = writable<boolean>(false);

// Per-device room visibility (opt-out): only explicitly-hidden area IDs are filtered,
// so new HA areas appear automatically. Stored locally, never in the repo.
const HIDDEN_KEY = 'room-remote:hiddenRooms';

function loadHidden(): string[] {
  if (!browser) return [];
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const hiddenRooms = writable<string[]>(loadHidden());
if (browser) {
  hiddenRooms.subscribe((v) => localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)));
}

// Never return an empty list: if every room is hidden, show them all.
export function computeVisibleRooms(rooms: Room[], hidden: string[]): Room[] {
  const visible = rooms.filter((r) => !hidden.includes(r.id));
  return visible.length > 0 ? visible : rooms;
}

export const visibleRooms = derived([rooms, hiddenRooms], ([$rooms, $hidden]) =>
  computeVisibleRooms($rooms, $hidden)
);
