import { describe, it, expect, beforeEach } from 'vitest';
import { connectLive } from './connection';

describe('connectLive', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    globalThis.localStorage = {
      getItem(k: string) { return store[k] ?? null; },
      setItem(k: string, v: string) { store[k] = v; },
      removeItem(k: string) { delete store[k]; },
      clear() { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key(i: number) { return Object.keys(store)[i] ?? null; }
    } as unknown as Storage;
  });

  it('rejects when no credentials are stored', async () => {
    await expect(connectLive()).rejects.toThrow(/credential/i);
  });
});
