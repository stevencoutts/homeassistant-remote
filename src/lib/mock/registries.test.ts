import { describe, it, expect } from 'vitest';
import { mockRegistries, mockStates } from './registries';
import { deriveRooms } from '$lib/rooms/derive';

describe('mock fixture', () => {
  it('derives the five demo rooms with the expected cards', () => {
    const reg = mockRegistries();
    const rooms = deriveRooms(reg, mockStates(reg));
    expect(rooms.map((r) => r.id)).toEqual(['living', 'kitchen', 'bedroom', 'office', 'bath']);

    const bath = rooms.find((r) => r.id === 'bath')!;
    expect(bath.media).toBeUndefined();
    expect(bath.covers).toBeUndefined();
    expect(bath.lights?.length).toBe(2);

    const living = rooms.find((r) => r.id === 'living')!;
    expect(living.media).toBeDefined();
    expect(living.covers?.length).toBe(1);
  });

  it('gives every entity a mock state', () => {
    const reg = mockRegistries();
    const st = mockStates(reg);
    for (const e of reg.entities) expect(st[e.entity_id]).toBeDefined();
  });
});
