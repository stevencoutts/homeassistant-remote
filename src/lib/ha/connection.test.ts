import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connectLive, loadAppConfig } from './connection';

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

describe('loadAppConfig', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns proxy:true when the server says so', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ proxy: true }) })) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: true });
  });

  it('returns proxy:false on non-ok or error', async () => {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: false });
    globalThis.fetch = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await loadAppConfig()).toEqual({ proxy: false });
  });
});
