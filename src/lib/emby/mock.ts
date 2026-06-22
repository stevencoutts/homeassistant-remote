import type { Channel, Programme } from './types';

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
