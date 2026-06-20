import { describe, it, expect } from 'vitest';
import { computeVisibleRooms } from './stores';
import type { Room } from './types';

const room = (id: string): Room => ({ id, name: id, icon: 'sofa' });

describe('computeVisibleRooms', () => {
  const rooms = [room('a'), room('b'), room('c')];

  it('filters out hidden rooms, preserving order', () => {
    expect(computeVisibleRooms(rooms, ['b']).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns all rooms when nothing is hidden', () => {
    expect(computeVisibleRooms(rooms, []).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to all rooms when the filter would empty the list', () => {
    expect(computeVisibleRooms(rooms, ['a', 'b', 'c']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores hidden ids that no longer exist', () => {
    expect(computeVisibleRooms(rooms, ['x']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
