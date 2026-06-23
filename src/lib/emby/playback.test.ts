import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Emby client the controller depends on.
vi.mock('./client', () => ({
  findPlayTarget: vi.fn(),
  listPlayTargets: vi.fn(),
  playItem: vi.fn(() => Promise.resolve())
}));

import { createPlaybackController } from './playback';
import { findPlayTarget, listPlayTargets, playItem } from './client';

// Minimal in-memory localStorage for the node test environment.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage;
  return store;
}

const noDelay = () => Promise.resolve();

describe('createPlaybackController', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installStorage();
    vi.mocked(findPlayTarget).mockReset();
    vi.mocked(listPlayTargets).mockReset();
    vi.mocked(playItem).mockClear();
  });

  it('plays to a confidently matched target and saves the binding', async () => {
    vi.mocked(findPlayTarget).mockResolvedValue({
      sessionId: 'sess1',
      name: 'Living Room Apple TV',
      deviceId: 'dev-1'
    });
    const flash = vi.fn();
    const c = createPlaybackController({
      appleTvHint: 'Living Room Apple TV',
      appleTvEntity: 'media_player.lounge',
      flash,
      delayMs: noDelay
    });

    await c.play('item-9', 'Salt and Stone');

    expect(playItem).toHaveBeenCalledWith('sess1', 'item-9');
    // Confident match (name contains hint) -> binding persisted.
    expect(store.get('emby_binding:media_player.lounge')).toContain('dev-1');
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Salt and Stone'));
  });

  it('clears a stale binding whose device is no longer an active session', async () => {
    store.set('emby_binding:media_player.lounge', JSON.stringify({ deviceId: 'old-dev' }));
    // The stored device is not in the live session list.
    vi.mocked(listPlayTargets).mockResolvedValue([
      { sessionId: 's', name: 'Living Room Apple TV', deviceId: 'new-dev' }
    ]);
    vi.mocked(findPlayTarget).mockResolvedValue({
      sessionId: 's',
      name: 'Living Room Apple TV',
      deviceId: 'new-dev'
    });

    const c = createPlaybackController({
      appleTvHint: 'Living Room Apple TV',
      appleTvEntity: 'media_player.lounge',
      flash: vi.fn(),
      delayMs: noDelay
    });

    const t = await c.ensureTarget();
    expect(t?.deviceId).toBe('new-dev');
    expect(store.get('emby_binding:media_player.lounge')).toBeUndefined();
  });

  it('reports a failure when no device can be reached', async () => {
    vi.mocked(findPlayTarget).mockResolvedValue(null);
    const flash = vi.fn();
    const c = createPlaybackController({
      // No entity -> cannot wake -> ensureTarget returns null.
      appleTvHint: 'Lounge',
      flash,
      delayMs: noDelay
    });

    await c.play('item-1', 'A Film');

    expect(playItem).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Could not reach the device'));
  });
});
