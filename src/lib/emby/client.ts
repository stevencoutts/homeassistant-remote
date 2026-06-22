import type { Channel, Programme, PlayTarget } from './types';
import { mockChannels, mockGuide } from './mock';

// Talks to Emby through the same-origin proxy (`/emby/...`); the server injects
// the API key. When the proxy is not configured (dev, or no EMBY_* env) the
// client serves mock data so the guide still renders.

// --- Pure helpers (unit-tested) ---

const iso = (ms: number) => new Date(ms).toISOString();

export function buildChannelsUrl(userId: string): string {
  const q = new URLSearchParams({
    UserId: userId,
    EnableImages: 'true',
    EnableUserData: 'false',
    // A high limit so every channel comes through (Emby otherwise pages).
    Limit: '1000',
    Fields: 'ChannelInfo'
  });
  return `/LiveTv/Channels?${q}`;
}

// Programmes are fetched with POST so the (potentially long) channel-id list
// goes in the body rather than a URL that could exceed length limits. The
// window is an overlap query: programmes that end after the window starts and
// start before it ends — which includes the one currently airing.
export function buildGuideBody(
  userId: string,
  channelIds: string[],
  startMs: number,
  endMs: number
): Record<string, unknown> {
  return {
    UserId: userId,
    ChannelIds: channelIds,
    MinEndDate: iso(startMs),
    MaxStartDate: iso(endMs),
    SortBy: ['StartDate'],
    EnableImages: false,
    EnableTotalRecordCount: false
  };
}

// Channel "number" can be like "101" or "101.5"; sort numerically, unknowns last.
export function channelSortKey(number?: string): number {
  const f = parseFloat(String(number ?? ''));
  return Number.isNaN(f) ? Number.MAX_SAFE_INTEGER : f;
}

interface EmbyUser {
  Id: string;
  Name?: string;
  Policy?: { IsAdministrator?: boolean };
}

// Pick the Emby user whose Live TV we show: prefer an administrator, else first.
export function pickUser(users: EmbyUser[]): string | null {
  if (!users.length) return null;
  const admin = users.find((u) => u.Policy?.IsAdministrator);
  return (admin ?? users[0]).Id;
}

interface EmbySession {
  Id: string;
  Client?: string;
  DeviceName?: string;
}

// Clients that represent a TV/streaming device capable of playing Live TV.
// Apple TV reports Client="Emby for Apple TV", DeviceName="<room> Apple TV".
// Google TV / Chromecast report Client="Android TV" or "Chromecast".
// Fire TV reports Client="Emby for Fire TV" or "Amazon Fire TV".
// Roku reports Client="Emby for Roku".
const VIDEO_CLIENT_RE = /apple\s*tv|appletv|android\s*tv|google\s*tv|chromecast|fire\s*tv|amazon\s*fire|roku|shield/i;
const isVideoClient = (s: EmbySession) =>
  VIDEO_CLIENT_RE.test(`${s.Client ?? ''} ${s.DeviceName ?? ''}`);

// Find the best Emby session to play Live TV to. When a hint is supplied
// (the HA friendly name of the room's player) we prefer a session whose
// DeviceName overlaps it so the right room's device wins; otherwise the
// first available video-client session is used.
export function matchAppleTvSession(sessions: EmbySession[], hint?: string): PlayTarget | null {
  const candidates = sessions.filter(isVideoClient);
  if (!candidates.length) return null;
  if (hint) {
    const h = hint.toLowerCase();
    const byHint = candidates.find((s) => {
      const d = (s.DeviceName ?? '').toLowerCase();
      return d && (d.includes(h) || h.includes(d));
    });
    if (byHint) return { sessionId: byHint.Id, name: byHint.DeviceName ?? byHint.Client ?? 'TV' };
  }
  const first = candidates[0];
  return { sessionId: first.Id, name: first.DeviceName ?? first.Client ?? 'TV' };
}

// Place a programme block in the grid track. Programmes that begin before the
// window are clamped to the left edge.
export function layout(
  p: Programme,
  windowStartMs: number,
  pxPerMin: number
): { left: number; width: number } {
  const rawLeft = ((p.start - windowStartMs) / 60_000) * pxPerMin;
  const rawRight = ((p.end - windowStartMs) / 60_000) * pxPerMin;
  const left = Math.max(0, rawLeft);
  return { left, width: Math.max(0, rawRight - left) };
}

// --- Response mapping ---

interface EmbyChannel {
  Id: string;
  Name: string;
  ChannelNumber?: string;
  Number?: string;
  ImageTags?: { Primary?: string };
}
interface EmbyProgramme {
  Id: string;
  ChannelId: string;
  Name: string;
  StartDate: string;
  EndDate: string;
  Overview?: string;
}

const mapChannel = (c: EmbyChannel): Channel => ({
  id: c.Id,
  name: c.Name,
  number: c.ChannelNumber ?? c.Number,
  logo: c.ImageTags?.Primary ? `/emby/Items/${c.Id}/Images/Primary?maxHeight=48&quality=80` : undefined
});

const mapProgramme = (p: EmbyProgramme): Programme => ({
  id: p.Id,
  channelId: p.ChannelId,
  title: p.Name,
  start: Date.parse(p.StartDate),
  end: Date.parse(p.EndDate),
  description: p.Overview
});

// --- Live calls (browser -> /emby proxy) ---

async function embyGet<T>(path: string): Promise<T> {
  const res = await fetch(`/emby${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Emby ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function embyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/emby${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Emby ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

let userIdCache: string | null = null;
async function getUserId(): Promise<string | null> {
  if (userIdCache) return userIdCache;
  const users = await embyGet<EmbyUser[]>('/Users');
  userIdCache = pickUser(users);
  return userIdCache;
}

let enabledCache: boolean | null = null;
async function enabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' });
    const cfg = res.ok ? await res.json() : {};
    enabledCache = cfg?.emby === true;
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export async function getChannels(): Promise<Channel[]> {
  if (!(await enabled())) return mockChannels();
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyChannel[] }>(buildChannelsUrl(uid));
  return (data.Items ?? [])
    .map(mapChannel)
    .sort((a, b) => channelSortKey(a.number) - channelSortKey(b.number));
}

export async function getGuide(
  channelIds: string[],
  startMs: number,
  endMs: number
): Promise<Programme[]> {
  if (!(await enabled())) return mockGuide(startMs, endMs);
  const uid = await getUserId();
  if (!uid || !channelIds.length) return [];
  const data = await embyPost<{ Items?: EmbyProgramme[] }>(
    '/LiveTv/Programs',
    buildGuideBody(uid, channelIds, startMs, endMs)
  );
  return (data.Items ?? []).map(mapProgramme);
}

export async function findPlayTarget(hint?: string): Promise<PlayTarget | null> {
  if (!(await enabled())) return { sessionId: 'mock', name: hint ?? 'TV' };
  const sessions = await embyGet<EmbySession[]>('/Sessions');
  return matchAppleTvSession(sessions, hint);
}

export async function playChannel(sessionId: string, channelId: string): Promise<void> {
  if (!(await enabled())) return; // mock: no-op
  const q = new URLSearchParams({ ItemIds: channelId, PlayCommand: 'PlayNow' });
  const res = await fetch(`/emby/Sessions/${sessionId}/Playing?${q}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Emby play -> ${res.status}`);
}
