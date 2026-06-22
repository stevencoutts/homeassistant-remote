import { describe, it, expect } from 'vitest';
import {
  buildChannelsUrl,
  buildGuideBody,
  channelSortKey,
  pickUser,
  matchAppleTvSession,
  layout
} from './client';
import { mockChannels, mockGuide } from './mock';
import type { Programme } from './types';

describe('request builders', () => {
  it('asks for every channel with images', () => {
    const u = buildChannelsUrl('u1');
    expect(u).toContain('/LiveTv/Channels?');
    expect(u).toContain('UserId=u1');
    expect(u).toContain('EnableImages=true');
    expect(u).toContain('Limit=1000');
  });

  it('builds an overlap-window guide body with the channel ids', () => {
    const start = Date.parse('2026-06-22T10:00:00.000Z');
    const end = Date.parse('2026-06-22T13:00:00.000Z');
    const body = buildGuideBody('u1', ['a', 'b'], start, end);
    expect(body).toMatchObject({
      UserId: 'u1',
      ChannelIds: ['a', 'b'],
      MinEndDate: '2026-06-22T10:00:00.000Z',
      MaxStartDate: '2026-06-22T13:00:00.000Z'
    });
  });
});

describe('channelSortKey', () => {
  it('orders by numeric channel number, unknowns last', () => {
    expect([{ number: '101' }, { number: '5' }, { number: undefined }, { number: '20' }]
      .sort((a, b) => channelSortKey(a.number) - channelSortKey(b.number))
      .map((c) => c.number)).toEqual(['5', '20', '101', undefined]);
  });
});

describe('pickUser', () => {
  it('prefers an administrator, else the first user', () => {
    expect(pickUser([{ Id: 'a' }, { Id: 'b', Policy: { IsAdministrator: true } }])).toBe('b');
    expect(pickUser([{ Id: 'a' }, { Id: 'b' }])).toBe('a');
    expect(pickUser([])).toBeNull();
  });
});

describe('matchAppleTvSession', () => {
  const sessions = [
    { Id: 's1', Client: 'Emby for Roku', DeviceName: 'Bedroom Roku' },
    { Id: 's2', Client: 'Emby for Apple TV', DeviceName: 'Living Room' },
    { Id: 's3', Client: 'Emby for Apple TV', DeviceName: 'Office' }
  ];

  it('returns null when no Apple TV session is present', () => {
    expect(matchAppleTvSession([{ Id: 'x', Client: 'Web' }])).toBeNull();
  });

  it('uses the only video session when there is just one candidate', () => {
    const one = [{ Id: 's2', Client: 'Emby for Apple TV', DeviceName: 'Living Room' }];
    expect(matchAppleTvSession(one)?.sessionId).toBe('s2');
  });

  it('refuses to guess between several candidates with no distinguishing signal', () => {
    // No hint, IP, binding or now-playing — must NOT fall back to one at random,
    // so the caller can wake this room's own device instead of hijacking another.
    expect(matchAppleTvSession(sessions)).toBeNull();
  });

  it('prefers the Apple TV whose device name matches the hint', () => {
    expect(matchAppleTvSession(sessions, 'Office')?.sessionId).toBe('s3');
    expect(matchAppleTvSession(sessions, 'Living Room')?.sessionId).toBe('s2');
  });

  it('returns null when the hint ties across two rooms (generic name)', () => {
    const twoApple = [
      { Id: 'a', Client: 'Emby for Apple TV', DeviceName: 'Living Room Apple TV', LastActivityDate: '2026-06-22T10:00:00Z' },
      { Id: 'b', Client: 'Emby for Apple TV', DeviceName: 'Conservatory Apple TV', LastActivityDate: '2026-06-22T11:00:00Z' }
    ];
    // 'Apple TV' overlaps both equally — recency must not break the tie.
    expect(matchAppleTvSession(twoApple, 'Apple TV')).toBeNull();
    // But a room-specific hint still resolves cleanly.
    expect(matchAppleTvSession(twoApple, 'Living Room Apple TV')?.sessionId).toBe('a');
  });

  it('matches on exact IP before falling back to the hint', () => {
    const withIp = [
      { Id: 'a', Client: 'Emby for Apple TV', DeviceName: 'Living Room', RemoteEndPoint: '192.168.1.10:55' },
      { Id: 'b', Client: 'Emby for Apple TV', DeviceName: 'Conservatory', RemoteEndPoint: '192.168.1.20:55' }
    ];
    expect(matchAppleTvSession(withIp, 'Conservatory', '192.168.1.10')?.sessionId).toBe('a');
  });

  it('lets a confident hint override a stale stored binding', () => {
    const twoApple = [
      { Id: 'a', DeviceId: 'dev-living', Client: 'Emby for Apple TV', DeviceName: 'Living Room Apple TV' },
      { Id: 'b', DeviceId: 'dev-cons', Client: 'Emby for Apple TV', DeviceName: 'Conservatory Apple TV' }
    ];
    // Binding wrongly points at the Conservatory, but the name says Living Room.
    expect(
      matchAppleTvSession(twoApple, 'Living Room Apple TV', undefined, 'dev-cons')?.sessionId
    ).toBe('a');
  });

  it('keeps the stored binding when no confident hint disagrees', () => {
    const twoApple = [
      { Id: 'a', DeviceId: 'dev-living', Client: 'Emby for Apple TV', DeviceName: 'Living Room Apple TV' },
      { Id: 'b', DeviceId: 'dev-cons', Client: 'Emby for Apple TV', DeviceName: 'Conservatory Apple TV' }
    ];
    expect(
      matchAppleTvSession(twoApple, 'Apple TV', undefined, 'dev-cons')?.sessionId
    ).toBe('b');
  });
});

describe('layout', () => {
  const windowStart = Date.parse('2026-06-22T10:00:00.000Z');
  const prog = (startIso: string, endIso: string): Programme => ({
    id: 'p',
    channelId: 'c',
    title: 't',
    start: Date.parse(startIso),
    end: Date.parse(endIso)
  });

  it('positions a programme by start offset and duration', () => {
    // 30 min after window start, 60 min long, at 4px/min.
    const { left, width } = layout(prog('2026-06-22T10:30:00Z', '2026-06-22T11:30:00Z'), windowStart, 4);
    expect(left).toBe(120);
    expect(width).toBe(240);
  });

  it('clamps a programme that started before the window to the left edge', () => {
    const { left, width } = layout(prog('2026-06-22T09:30:00Z', '2026-06-22T10:30:00Z'), windowStart, 4);
    expect(left).toBe(0);
    expect(width).toBe(120); // only the in-window half remains
  });
});

describe('mock data', () => {
  it('fills every channel with programmes spanning the window', () => {
    const start = Date.parse('2026-06-22T10:00:00Z');
    const end = start + 3 * 60 * 60_000;
    const channels = mockChannels();
    const guide = mockGuide(start, end);
    for (const c of channels) {
      const forCh = guide.filter((p) => p.channelId === c.id);
      expect(forCh.length).toBeGreaterThan(0);
      // Covers from before the window start through to its end.
      expect(Math.min(...forCh.map((p) => p.start))).toBeLessThanOrEqual(start);
      expect(Math.max(...forCh.map((p) => p.end))).toBeGreaterThanOrEqual(end);
    }
  });
});
