import type { Channel, Programme, MediaItem, MediaLibrary } from './types';

// Offline fixture so the EPG grid renders (and is testable) without a live Emby.
// Generates back-to-back programmes per channel across the visible window.

const CHANNELS: Channel[] = [
  { id: 'c1', name: 'BBC One', number: '101' },
  { id: 'c2', name: 'BBC Two', number: '102' },
  { id: 'c3', name: 'ITV1', number: '103' },
  { id: 'c4', name: 'Channel 4', number: '104' },
  { id: 'c5', name: 'Channel 5', number: '105' },
  { id: 'c6', name: 'Sky Sports Main Event', number: '401' },
  { id: 'c7', name: 'Sky Atlantic', number: '108' },
  { id: 'c8', name: 'Dave', number: '127' }
];

const TITLES: Record<string, string[]> = {
  c1: ['BBC News', 'Bargain Hunt', 'The One Show', 'EastEnders', 'Drama Night', 'Question Time'],
  c2: ['Newsnight', 'Mastermind', 'University Challenge', 'Gardeners’ World', 'Horizon'],
  c3: ['ITV News', 'Tipping Point', 'The Chase', 'Coronation Street', 'Film: Action Hour'],
  c4: ['Channel 4 News', 'Countdown', 'A Place in the Sun', 'Grand Designs', 'Gogglebox'],
  c5: ['5 News', 'The Gadget Show', 'Police Interceptors', 'Film: Western'],
  c6: ['Premier League', 'Match of the Day', 'Football Tonight', 'Live: Cricket'],
  c7: ['Game of Thrones', 'Succession', 'The Last of Us', 'House of the Dragon'],
  c8: ['Taskmaster', 'QI', 'Would I Lie to You?', 'Red Dwarf', 'Mock the Week']
};

export function mockChannels(): Channel[] {
  return CHANNELS.map((c) => ({ ...c }));
}

// Deterministic-ish durations so the grid looks varied but stable per channel.
const DURATIONS = [30, 45, 60, 60, 90, 30];

export function mockGuide(startMs: number, endMs: number): Programme[] {
  const out: Programme[] = [];
  // Begin one hour before the window so the current programme starts off-screen left.
  const begin = startMs - 60 * 60_000;
  for (const ch of CHANNELS) {
    const titles = TITLES[ch.id] ?? ['Programme'];
    let t = begin;
    let i = 0;
    while (t < endMs) {
      const dur = DURATIONS[(i + ch.id.length) % DURATIONS.length] * 60_000;
      const end = t + dur;
      out.push({
        id: `${ch.id}-${i}`,
        channelId: ch.id,
        title: titles[i % titles.length],
        start: t,
        end,
        description: 'Sample programme description for the offline guide preview.'
      });
      t = end;
      i++;
    }
  }
  return out;
}

// --- On-demand (films and TV series) fixtures ---
// Offline data so the VOD browser renders and is testable with no live Emby.

export function mockLibraries(): MediaLibrary[] {
  return [
    { id: 'lib-movies', name: 'Films', kind: 'movies' },
    { id: 'lib-tv', name: 'TV Series', kind: 'tvshows' }
  ];
}

const MOVIES: MediaItem[] = [
  { id: 'm1', kind: 'Movie', name: 'The Quiet Coast', year: 2021, runtimeTicks: 6_600_000_000_000 },
  { id: 'm2', kind: 'Movie', name: 'Northern Lights', year: 2019, runtimeTicks: 7_200_000_000_000 },
  { id: 'm3', kind: 'Movie', name: 'Paper Aeroplanes', year: 2023, runtimeTicks: 5_400_000_000_000 },
  { id: 'm4', kind: 'Movie', name: 'The Long Drive Home', year: 2020, runtimeTicks: 6_000_000_000_000 },
  { id: 'm5', kind: 'Movie', name: 'Salt and Stone', year: 2024, runtimeTicks: 7_800_000_000_000 },
  { id: 'm6', kind: 'Movie', name: 'A Winter in Vienna', year: 2018, runtimeTicks: 6_900_000_000_000 }
];

const SERIES: MediaItem[] = [
  { id: 's1', kind: 'Series', name: 'Harbour Lights', year: 2022 },
  { id: 's2', kind: 'Series', name: 'The Cartographer', year: 2021 },
  { id: 's3', kind: 'Series', name: 'Glasshouse', year: 2024 }
];

// Two seasons per series, three episodes per season.
function seasonsFor(seriesId: string): MediaItem[] {
  const series = SERIES.find((s) => s.id === seriesId);
  return [1, 2].map((n) => ({
    id: `${seriesId}-s${n}`,
    kind: 'Season' as const,
    name: `Series ${n}`,
    seriesId,
    seriesName: series?.name,
    indexNumber: n
  }));
}

function episodesFor(seriesId: string, seasonId: string): MediaItem[] {
  const series = SERIES.find((s) => s.id === seriesId);
  const seasonNo = Number(seasonId.split('-s')[1] ?? 1);
  return [1, 2, 3].map((n) => {
    // Make the first episode of the first season part-watched for the progress bar.
    const inProgress = seasonId.endsWith('-s1') && n === 1;
    return {
      id: `${seasonId}-e${n}`,
      kind: 'Episode' as const,
      name: `Episode ${n}`,
      seriesId,
      seriesName: series?.name,
      parentIndexNumber: seasonNo,
      indexNumber: n,
      runtimeTicks: 3_000_000_000_000,
      ...(inProgress ? { resumePositionTicks: 1_200_000_000_000, progressPct: 40 } : {})
    };
  });
}

export function mockLibraryItems(kind: 'movies' | 'tvshows'): MediaItem[] {
  return (kind === 'movies' ? MOVIES : SERIES).map((i) => ({ ...i }));
}

export function mockSeasons(seriesId: string): MediaItem[] {
  return seasonsFor(seriesId);
}

export function mockEpisodes(seriesId: string, seasonId: string): MediaItem[] {
  return episodesFor(seriesId, seasonId);
}

export function mockContinueWatching(): MediaItem[] {
  return [
    { ...MOVIES[1], resumePositionTicks: 2_880_000_000_000, progressPct: 40 },
    {
      id: 's1-s1-e1',
      kind: 'Episode',
      name: 'Episode 1',
      seriesId: 's1',
      seriesName: 'Harbour Lights',
      parentIndexNumber: 1,
      indexNumber: 1,
      runtimeTicks: 3_000_000_000_000,
      resumePositionTicks: 1_200_000_000_000,
      progressPct: 40
    },
    { ...MOVIES[3], resumePositionTicks: 4_800_000_000_000, progressPct: 80 }
  ];
}

export function mockRecentlyAdded(): MediaItem[] {
  return [MOVIES[4], SERIES[2], MOVIES[2], SERIES[1]].map((i) => ({ ...i }));
}
