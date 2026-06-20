import { describe, it, expect, vi } from 'vitest';
import { fetchRegistries, subscribeRegistryEvents } from './registries';

function fakeConn(lists: Record<string, unknown[]>) {
  return {
    sendMessagePromise: vi.fn(async (msg: { type: string }) => lists[msg.type] ?? []),
    subscribeEvents: vi.fn(async () => () => {})
  };
}

describe('fetchRegistries', () => {
  it('maps each list command to its registry array', async () => {
    const conn = fakeConn({
      'config/area_registry/list': [{ area_id: 'living', name: 'Living Room', icon: 'mdi:sofa', floor_id: 'ground' }],
      'config/floor_registry/list': [{ floor_id: 'ground', name: 'Ground', level: 0 }],
      'config/device_registry/list': [{ id: 'dev1', area_id: 'living' }],
      'config/entity_registry/list': [{ entity_id: 'light.living', area_id: null, device_id: 'dev1' }]
    });
    const reg = await fetchRegistries(conn as any);
    expect(reg.areas[0].name).toBe('Living Room');
    expect(reg.floors[0].level).toBe(0);
    expect(reg.devices[0].id).toBe('dev1');
    expect(reg.entities[0].entity_id).toBe('light.living');
  });
});

describe('subscribeRegistryEvents', () => {
  it('subscribes to all four registry events and unsubscribes all', async () => {
    const conn = fakeConn({});
    const unsub = await subscribeRegistryEvents(conn as any, () => {});
    expect(conn.subscribeEvents).toHaveBeenCalledTimes(4);
    unsub();
  });
});
