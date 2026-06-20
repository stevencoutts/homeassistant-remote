import { describe, it, expect, beforeEach } from 'vitest';
import { normaliseHassUrl, loadCredentials, saveCredentials, credentialsValid, clearCredentials } from './auth';

describe('normaliseHassUrl', () => {
  it('strips the websocket path and trailing slash', () => {
    expect(normaliseHassUrl('http://ha.local:8123/api/websocket')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('http://ha.local:8123/')).toBe('http://ha.local:8123');
    expect(normaliseHassUrl('  https://ha.local:8123  ')).toBe('https://ha.local:8123');
  });
});

describe('credential storage', () => {
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

  it('returns null when nothing stored', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('round-trips and normalises the url', () => {
    saveCredentials('http://ha.local:8123/api/websocket', 'tok123');
    expect(loadCredentials()).toEqual({ url: 'http://ha.local:8123', token: 'tok123' });
  });

  it('credentialsValid requires both fields non-empty', () => {
    expect(credentialsValid('http://ha.local:8123', 'tok')).toBe(true);
    expect(credentialsValid('  ', 'tok')).toBe(false);
    expect(credentialsValid('http://ha.local:8123', '   ')).toBe(false);
    expect(credentialsValid('', '')).toBe(false);
  });

  it('clearCredentials removes both stored keys', () => {
    saveCredentials('http://ha.local:8123', 'tok');
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });
});
