import { describe, it, expect, vi, afterEach } from 'vitest';
import { playChannel } from './client';

// playChannel must clear an active play queue before issuing PlayNow, otherwise
// the Apple TV Emby client can ignore the remote play and roll on to the next
// queued episode instead of switching to the chosen channel/item.
describe('playChannel stop-before-play', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops the session, then issues PlayNow in order', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).includes('/config.json')) {
        return { ok: true, json: async () => ({ emby: true }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await playChannel('sess1', 'chan9');

    const stopIdx = calls.findIndex((c) => c.includes('/Sessions/sess1/Playing/Stop'));
    const playIdx = calls.findIndex((c) => c.includes('ItemIds=chan9'));
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(playIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeLessThan(playIdx); // Stop precedes PlayNow
    expect(calls[playIdx]).toContain('PlayCommand=PlayNow');
    expect(calls[stopIdx]).toContain('POST');
  });
});
