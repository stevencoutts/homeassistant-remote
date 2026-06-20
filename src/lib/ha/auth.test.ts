import { describe, it, expect, beforeEach } from 'vitest';
import { normaliseHassUrl, loadCredentials, saveCredentials } from './auth';

describe('normaliseHassUrl', () => {
  it('strips the websocket path and trailing slash', () => {
    expect(normaliseHassUrl('http://ha.local:8123/api/websocket')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('http://ha.local:8123/')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('  https://ha.local:8123  ')).toBe('https://ha.local:8123');
  });
});

describe('credential storage', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      _s: {} as Record<string, string>,
      getItem(k: string) { return this._s[k] ?? null; },
      setItem(k: string, v: string) { this._s[k] = v; },
      removeItem(k: string) { delete this._s[k]; },
      clear() { this._s = {}; },
      get length() { return Object.keys(this._s).length; },
      key(i: number) { return Object.keys(this._s)[i] ?? null; }
    } as unknown as Storage;
  });

  it('returns null when nothing stored', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('round-trips and normalises the url', () => {
    saveCredentials('http://ha.local:8123/api/websocket', 'tok123');
    expect(loadCredentials()).toEqual({ url: 'http://ha.local:8123', token: 'tok123' });
  });
});
