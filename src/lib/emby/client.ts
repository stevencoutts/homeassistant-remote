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
    SortBy: 'SortName',
    Fields: 'ChannelInfo'
  });
  return `/LiveTv/Channels?${q}`;
}

export function buildGuideUrl(
  userId: string,
  channelIds: string[],
  startMs: number,
  endMs: number
): string {
  const q = new URLSearchParams({
    UserId: userId,
    ChannelIds: channelIds.join(','),
    MinStartDate: iso(startMs),
    MaxStartDate: iso(endMs),
    MaxEndDate: iso(endMs),
    SortBy: 'StartDate',
    EnableImages: 'false'
  });
  return `/LiveTv/Programs?${q}`;
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

const isAppleTv = (s: EmbySession) => /apple\s*tv|appletv/i.test(`${s.Client ?? ''} ${s.DeviceName ?? ''}`);

// Find the Apple TV Emby session to play to. With a hint (e.g. the room's Apple
// TV name) prefer a session whose device name overlaps it; else the first
// Apple TV session that is present.
export function matchAppleTvSession(sessions: EmbySession[], hint?: string): PlayTarget | null {
  const atv = sessions.filter(isAppleTv);
  if (!atv.length) return null;
  if (hint) {
    const h = hint.toLowerCase();
    const byHint = atv.find((s) => {
      const d = (s.DeviceName ?? '').toLowerCase();
      return d && (d.includes(h) || h.includes(d));
    });
    if (byHint) return { sessionId: byHint.Id, name: byHint.DeviceName ?? 'Apple TV' };
  }
  return { sessionId: atv[0].Id, name: atv[0].DeviceName ?? 'Apple TV' };
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
  return (data.Items ?? []).map(mapChannel);
}

export async function getGuide(
  channelIds: string[],
  startMs: number,
  endMs: number
): Promise<Programme[]> {
  if (!(await enabled())) return mockGuide(startMs, endMs);
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyProgramme[] }>(
    buildGuideUrl(uid, channelIds, startMs, endMs)
  );
  return (data.Items ?? []).map(mapProgramme);
}

export async function findPlayTarget(hint?: string): Promise<PlayTarget | null> {
  if (!(await enabled())) return { sessionId: 'mock', name: hint ?? 'Apple TV' };
  const sessions = await embyGet<EmbySession[]>('/Sessions');
  return matchAppleTvSession(sessions, hint);
}

export async function playChannel(sessionId: string, channelId: string): Promise<void> {
  if (!(await enabled())) return; // mock: no-op
  const q = new URLSearchParams({ ItemIds: channelId, PlayCommand: 'PlayNow' });
  const res = await fetch(`/emby/Sessions/${sessionId}/Playing?${q}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Emby play -> ${res.status}`);
}
