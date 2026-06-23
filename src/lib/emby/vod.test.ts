import { describe, it, expect } from 'vitest';
import {
  posterUrl,
  progressPct,
  mapItem,
  buildResumeUrl,
  buildLatestUrl,
  buildLibraryItemsUrl,
  buildSeasonsUrl,
  buildEpisodesUrl
} from './client';
import {
  mockLibraries,
  mockLibraryItems,
  mockSeasons,
  mockEpisodes,
  mockContinueWatching,
  mockRecentlyAdded
} from './mock';

describe('posterUrl', () => {
  it('builds a proxied primary-image url with sizing', () => {
    const u = posterUrl('abc');
    expect(u).toContain('/emby/Items/abc/Images/Primary?');
    expect(u).toContain('maxHeight=330');
    expect(u).toContain('quality=85');
  });
  it('honours a custom height', () => {
    expect(posterUrl('x', 120)).toContain('maxHeight=120');
  });
});

describe('progressPct', () => {
  it('returns a 0..100 percentage from ticks', () => {
    expect(progressPct(50, 100)).toBe(50);
  });
  it('clamps over-run to 100', () => {
    expect(progressPct(150, 100)).toBe(100);
  });
  it('is undefined without a runtime (no misleading 0/NaN)', () => {
    expect(progressPct(50, undefined)).toBeUndefined();
    expect(progressPct(50, 0)).toBeUndefined();
    expect(progressPct(undefined, 100)).toBeUndefined();
  });
});

describe('mapItem', () => {
  it('maps a movie with its own poster, year and runtime', () => {
    const m = mapItem({
      Id: 'm1',
      Name: 'Salt and Stone',
      Type: 'Movie',
      ProductionYear: 2024,
      RunTimeTicks: 100,
      ImageTags: { Primary: 'tag' }
    });
    expect(m).toMatchObject({ id: 'm1', kind: 'Movie', name: 'Salt and Stone', year: 2024 });
    expect(m.poster).toContain('/emby/Items/m1/Images/Primary');
  });

  it('derives progress for an in-progress episode and falls back to series art', () => {
    const e = mapItem({
      Id: 'e1',
      Name: 'Episode 1',
      Type: 'Episode',
      SeriesId: 's1',
      SeriesName: 'Harbour Lights',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      RunTimeTicks: 100,
      UserData: { PlaybackPositionTicks: 40 },
      SeriesPrimaryImageTag: 'stag'
      // no own ImageTags.Primary -> falls back to the series poster
    });
    expect(e.kind).toBe('Episode');
    expect(e.seriesName).toBe('Harbour Lights');
    expect(e.parentIndexNumber).toBe(1);
    expect(e.progressPct).toBe(40);
    expect(e.poster).toContain('/emby/Items/s1/Images/Primary');
  });

  it('maps a series with no poster gracefully', () => {
    const s = mapItem({ Id: 's2', Name: 'Glasshouse', Type: 'Series' });
    expect(s).toMatchObject({ id: 's2', kind: 'Series', name: 'Glasshouse' });
    expect(s.poster).toBeUndefined();
    expect(s.progressPct).toBeUndefined();
  });

  it('defaults an unknown type to Movie', () => {
    expect(mapItem({ Id: 'x', Type: 'BoxSet' }).kind).toBe('Movie');
  });
});

describe('request builders', () => {
  it('resume asks for in-progress video items', () => {
    const u = buildResumeUrl('u1');
    expect(u).toContain('/Users/u1/Items/Resume?');
    expect(u).toContain('MediaTypes=Video');
  });
  it('latest hits the recently-added endpoint', () => {
    expect(buildLatestUrl('u1')).toContain('/Users/u1/Items/Latest?');
  });
  it('library items are scoped to the parent and sorted by name', () => {
    const u = buildLibraryItemsUrl('u1', 'lib9');
    expect(u).toContain('ParentId=lib9');
    expect(u).toContain('SortBy=SortName');
  });
  it('seasons and episodes target the shows endpoints', () => {
    expect(buildSeasonsUrl('u1', 's1')).toContain('/Shows/s1/Seasons?');
    const e = buildEpisodesUrl('u1', 's1', 'se1');
    expect(e).toContain('/Shows/s1/Episodes?');
    expect(e).toContain('SeasonId=se1');
  });
});

describe('mock fixtures', () => {
  it('exposes movies and tv libraries', () => {
    const kinds = mockLibraries().map((l) => l.kind).sort();
    expect(kinds).toEqual(['movies', 'tvshows']);
  });

  it('continue watching items carry a 0..100 progress', () => {
    const cw = mockContinueWatching();
    expect(cw.length).toBeGreaterThan(0);
    for (const item of cw) {
      expect(item.progressPct).toBeGreaterThanOrEqual(0);
      expect(item.progressPct).toBeLessThanOrEqual(100);
    }
  });

  it('recently added is non-empty', () => {
    expect(mockRecentlyAdded().length).toBeGreaterThan(0);
  });

  it('a series resolves to seasons resolve to episodes', () => {
    const seasons = mockSeasons('s1');
    expect(seasons.length).toBeGreaterThan(0);
    expect(seasons[0].kind).toBe('Season');
    const eps = mockEpisodes('s1', seasons[0].id);
    expect(eps.length).toBeGreaterThan(0);
    expect(eps[0].kind).toBe('Episode');
    expect(eps[0].seriesId).toBe('s1');
  });

  it('library items are films or series only', () => {
    expect(mockLibraryItems('movies').every((i) => i.kind === 'Movie')).toBe(true);
    expect(mockLibraryItems('tvshows').every((i) => i.kind === 'Series')).toBe(true);
  });
});
