import type { Channel, Programme, PlayTarget, MediaItem, MediaLibrary, MediaKind } from './types';
import {
  mockChannels,
  mockGuide,
  mockLibraries,
  mockLibraryItems,
  mockSeasons,
  mockEpisodes,
  mockContinueWatching,
  mockRecentlyAdded
} from './mock';

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
  DeviceId?: string;                    // stable UUID per Emby client install
  Client?: string;
  DeviceName?: string;
  LastActivityDate?: string;            // ISO-8601
  RemoteEndPoint?: string;              // "192.168.1.x:port"
  NowPlayingItem?: { Name?: string };   // set only when actively playing
}

// Clients that represent a TV/streaming device capable of playing Live TV.
// Apple TV reports Client="Emby for Apple TV", DeviceName="<room> Apple TV".
// Google TV / Chromecast report Client="Android TV" or "Chromecast".
// Fire TV reports Client="Emby for Fire TV" or "Amazon Fire TV".
// Roku reports Client="Emby for Roku".
const VIDEO_CLIENT_RE = /apple\s*tv|appletv|android\s*tv|google\s*tv|chromecast|fire\s*tv|amazon\s*fire|roku|shield/i;
const isVideoClient = (s: EmbySession) =>
  VIDEO_CLIENT_RE.test(`${s.Client ?? ''} ${s.DeviceName ?? ''}`);

// Significant words for hint matching — strip filler so "Living Room Apple TV"
// matches an Emby session named "Apple TV Living Room" even with word reorder.
// Brand / client words appear in every Apple TV session's DeviceName and Client
// ("... Apple TV", "Emby for Apple TV"), so they must not count as a match —
// otherwise the Conservatory session "matches" a Living Room hint on "apple".
const FILLER = new Set([
  'the', 'a', 'an', 'room', 'tv', 'and', 'of', 'in', 'my',
  'apple', 'appletv', 'google', 'android', 'amazon', 'fire', 'chromecast',
  'roku', 'shield', 'emby', 'for'
]);
const sigWords = (s: string) =>
  s.toLowerCase().split(/\W+/).filter((w) => w.length > 1 && !FILLER.has(w));

// Score how well an Emby session matches a hint (HA friendly name).
// Tries full substring first, then word-level overlap.
function hintScore(s: EmbySession, hint: string): number {
  const combined = `${s.DeviceName ?? ''} ${s.Client ?? ''}`.toLowerCase();
  const h = hint.toLowerCase();
  // Exact substring match — strongest signal
  if (combined.includes(h) || h.includes(combined.trim())) return 100;
  // Word-level overlap
  const hw = sigWords(hint);
  const cw = sigWords(combined);
  const overlap = hw.filter((w) => cw.includes(w)).length;
  return overlap;
}

// Find the best Emby session to play Live TV to. When a hint is supplied
// (the HA friendly name of the room's player) we prefer a session whose
// DeviceName best matches it; otherwise the first video-client session is used.
function sessionIp(s: EmbySession): string {
  // RemoteEndPoint is "192.168.1.x:port" — strip the port.
  return (s.RemoteEndPoint ?? '').split(':')[0];
}

function toTarget(s: EmbySession): PlayTarget {
  return { sessionId: s.Id, name: s.DeviceName ?? s.Client ?? 'TV', deviceId: s.DeviceId };
}

// Pick the best hint match and say whether it is *confident*. A match is
// confident when it is an exact substring match (score 100) or a strict, unique
// word-overlap winner (top score beats the runner-up). A tie — e.g. two Apple
// TVs that share the word "apple" against a generic HA name — is NOT confident,
// because choosing between them by recency is exactly what sent the Living Room
// guide to the Conservatory.
function bestHintMatch(
  candidates: EmbySession[],
  hint: string
): { session: EmbySession; score: number; confident: boolean } | null {
  const scored = candidates
    .map((s) => ({ s, score: hintScore(s, hint) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.s.LastActivityDate ?? '0') - Date.parse(a.s.LastActivityDate ?? '0')
    );
  const top = scored[0];
  if (!top) return null;
  const second = scored[1];
  // Confident only when there is a single unique winner. Two sessions that both
  // contain the hit term (e.g. both ".../Apple TV") tie and are NOT confident —
  // breaking that tie by recency is what mis-routed the guide between rooms.
  const confident = !second || top.score > second.score;
  return { session: top.s, score: top.score, confident };
}

// True when a session's name positively names a DIFFERENT room than the hint:
// it has significant (non-brand) words and none of them overlap the hint. Used
// to reject a stale stored binding whose device is plainly the wrong room (e.g.
// a binding pointing at "Conservatory Apple TV" while we want the Living Room).
// A session with no significant words (a generic "Apple TV") does not conflict.
function conflictsWithHint(s: EmbySession, hint?: string): boolean {
  if (!hint) return false;
  const hw = sigWords(hint);
  const cw = sigWords(`${s.DeviceName ?? ''} ${s.Client ?? ''}`);
  if (!hw.length || !cw.length) return false;
  if (hintScore(s, hint) >= 100) return false; // exact substring — not a conflict
  return cw.every((w) => !hw.includes(w));
}

// Match priority (highest → lowest):
//   1. DeviceId  — Emby's stable per-install UUID; stored after first play, but
//                  ignored if a confident name match points at a different device
//                  (repairs a binding saved wrong by an earlier build).
//   2. IP        — exact RemoteEndPoint match when HA provides configuration_url
//   3. NowPlaying — HA reports the title playing via Emby; match to session's NowPlayingItem
//   4. Hint      — confident name match between HA friendly name and Emby DeviceName
//   5. Single    — one video session only: unambiguous, use it.
// With several candidates and no confident signal we return null on purpose, so
// the caller wakes THIS room's device instead of hijacking another room's TV.
export function matchAppleTvSession(
  sessions: EmbySession[],
  hint?: string,
  ip?: string,
  storedDeviceId?: string,
  nowPlayingTitle?: string
): PlayTarget | null {
  const candidates = sessions.filter(isVideoClient);
  if (!candidates.length) return null;

  // Resolve the hint up front so it can override a stale stored binding.
  const hintMatch = hint ? bestHintMatch(candidates, hint) : null;

  if (storedDeviceId) {
    const m = candidates.find((s) => s.DeviceId === storedDeviceId);
    // Trust the binding unless (a) a confident name match disagrees with it, or
    // (b) the bound device's own name clearly names a different room than the
    // hint. (b) matters when this room's TV is asleep and the only session awake
    // is another room's — without it a stale binding keeps hijacking that room.
    const disagrees = hintMatch?.confident && hintMatch.session.DeviceId !== storedDeviceId;
    if (m && !disagrees && !conflictsWithHint(m, hint)) {
      return toTarget(m);
    }
  }

  if (ip) {
    const m = candidates.find((s) => sessionIp(s) === ip);
    if (m) return toTarget(m);
  }

  if (nowPlayingTitle) {
    const title = nowPlayingTitle.toLowerCase();
    const m = candidates.find((s) => (s.NowPlayingItem?.Name ?? '').toLowerCase() === title);
    if (m) return toTarget(m);
  }

  if (hintMatch?.confident) return toTarget(hintMatch.session);

  // No confident signal. If we were given a hint we know which room we want, so
  // a non-matching session (even the only one awake) is the WRONG room — refuse
  // and let the caller wake this room's own Apple TV. Only fall back to a lone
  // candidate when we have no hint at all to go on.
  if (hint) return null;
  if (candidates.length === 1) return toTarget(candidates[0]);
  return null;
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

export async function findPlayTarget(
  hint?: string,
  ip?: string,
  storedDeviceId?: string,
  nowPlayingTitle?: string
): Promise<PlayTarget | null> {
  if (!(await enabled())) return { sessionId: 'mock', name: hint ?? 'TV', deviceId: 'mock' };
  const sessions = await embyGet<EmbySession[]>('/Sessions');
  return matchAppleTvSession(sessions, hint, ip, storedDeviceId, nowPlayingTitle);
}

// Return all active video-client sessions (used for self-correction after play).
export async function listPlayTargets(): Promise<PlayTarget[]> {
  if (!(await enabled())) return [{ sessionId: 'mock', name: 'TV (mock)', deviceId: 'mock' }];
  const sessions = await embyGet<EmbySession[]>('/Sessions');
  return sessions.filter(isVideoClient).map(toTarget);
}

export async function playChannel(sessionId: string, channelId: string): Promise<void> {
  if (!(await enabled())) return; // mock: no-op
  const q = new URLSearchParams({ ItemIds: channelId, PlayCommand: 'PlayNow' });
  const res = await fetch(`/emby/Sessions/${sessionId}/Playing?${q}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Emby play -> ${res.status}`);
}

// =====================================================================
// On-demand (films and TV series)
// =====================================================================

// Fields we request on library items so the UI has posters, runtime and resume.
const ITEM_FIELDS = 'Overview,ProductionYear,PrimaryImageAspectRatio';

// --- Pure helpers (unit-tested) ---

// Build a proxied poster URL. Items with their own Primary image use it; an
// episode that lacks one but belongs to a series falls back to the series art.
export function posterUrl(itemId: string, maxHeight = 330): string {
  const q = new URLSearchParams({ maxHeight: String(maxHeight), quality: '85' });
  return `/emby/Items/${itemId}/Images/Primary?${q}`;
}

// Resume progress as a 0..100 percentage. Returns undefined when we cannot tell
// (no runtime) so the UI can omit the bar rather than draw a misleading 0/NaN.
export function progressPct(positionTicks?: number, runtimeTicks?: number): number | undefined {
  if (!runtimeTicks || runtimeTicks <= 0 || positionTicks == null) return undefined;
  const pct = (positionTicks / runtimeTicks) * 100;
  return Math.max(0, Math.min(100, pct));
}

interface EmbyUserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
}
interface EmbyBaseItem {
  Id: string;
  Name?: string;
  Type?: string; // Movie | Series | Season | Episode
  ProductionYear?: number;
  Overview?: string;
  RunTimeTicks?: number;
  UserData?: EmbyUserData;
  SeriesId?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ImageTags?: { Primary?: string };
  SeriesPrimaryImageTag?: string;
  CollectionType?: string; // on a Views/CollectionFolder item
}

const KINDS = new Set<MediaKind>(['Movie', 'Series', 'Season', 'Episode']);
const asKind = (t?: string): MediaKind => (KINDS.has(t as MediaKind) ? (t as MediaKind) : 'Movie');

// Map an Emby BaseItem onto the normalised MediaItem. The poster prefers the
// item's own Primary image; an episode without one falls back to its series art.
export function mapItem(it: EmbyBaseItem): MediaItem {
  const kind = asKind(it.Type);
  const hasOwnPoster = Boolean(it.ImageTags?.Primary);
  let poster: string | undefined;
  if (hasOwnPoster) poster = posterUrl(it.Id);
  else if (kind === 'Episode' && it.SeriesId && it.SeriesPrimaryImageTag) poster = posterUrl(it.SeriesId);

  const pos = it.UserData?.PlaybackPositionTicks;
  return {
    id: it.Id,
    kind,
    name: it.Name ?? '',
    poster,
    year: it.ProductionYear,
    overview: it.Overview,
    runtimeTicks: it.RunTimeTicks,
    resumePositionTicks: pos,
    progressPct: progressPct(pos, it.RunTimeTicks),
    seriesId: it.SeriesId,
    seriesName: it.SeriesName,
    parentIndexNumber: it.ParentIndexNumber,
    indexNumber: it.IndexNumber
  };
}

const collectionKind = (c?: string): MediaLibrary['kind'] | null =>
  c === 'movies' ? 'movies' : c === 'tvshows' ? 'tvshows' : null;

export function buildResumeUrl(userId: string): string {
  const q = new URLSearchParams({
    UserId: userId,
    MediaTypes: 'Video',
    Limit: '24',
    Recursive: 'true',
    Fields: ITEM_FIELDS
  });
  return `/Users/${userId}/Items/Resume?${q}`;
}

export function buildLatestUrl(userId: string): string {
  const q = new URLSearchParams({ Limit: '24', Fields: ITEM_FIELDS });
  return `/Users/${userId}/Items/Latest?${q}`;
}

export function buildLibraryItemsUrl(userId: string, parentId: string): string {
  const q = new URLSearchParams({
    ParentId: parentId,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Recursive: 'false',
    Fields: ITEM_FIELDS
  });
  return `/Users/${userId}/Items?${q}`;
}

export function buildSeasonsUrl(userId: string, seriesId: string): string {
  const q = new URLSearchParams({ UserId: userId });
  return `/Shows/${seriesId}/Seasons?${q}`;
}

export function buildEpisodesUrl(userId: string, seriesId: string, seasonId: string): string {
  const q = new URLSearchParams({ UserId: userId, SeasonId: seasonId, Fields: ITEM_FIELDS });
  return `/Shows/${seriesId}/Episodes?${q}`;
}

// --- Live calls ---

export async function getLibraries(): Promise<MediaLibrary[]> {
  if (!(await enabled())) return mockLibraries();
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyBaseItem[] }>(`/Users/${uid}/Views`);
  const out: MediaLibrary[] = [];
  for (const it of data.Items ?? []) {
    const k = collectionKind(it.CollectionType);
    if (k) out.push({ id: it.Id, name: it.Name ?? k, kind: k });
  }
  return out;
}

export async function getContinueWatching(): Promise<MediaItem[]> {
  if (!(await enabled())) return mockContinueWatching();
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyBaseItem[] }>(buildResumeUrl(uid));
  return (data.Items ?? []).map(mapItem);
}

export async function getRecentlyAdded(): Promise<MediaItem[]> {
  if (!(await enabled())) return mockRecentlyAdded();
  const uid = await getUserId();
  if (!uid) return [];
  // /Items/Latest returns a bare array, not an { Items } envelope.
  const data = await embyGet<EmbyBaseItem[]>(buildLatestUrl(uid));
  return (Array.isArray(data) ? data : []).map(mapItem);
}

export async function getLibraryItems(
  parentId: string,
  kind: 'movies' | 'tvshows'
): Promise<MediaItem[]> {
  if (!(await enabled())) return mockLibraryItems(kind);
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyBaseItem[] }>(buildLibraryItemsUrl(uid, parentId));
  return (data.Items ?? []).map(mapItem);
}

export async function getSeasons(seriesId: string): Promise<MediaItem[]> {
  if (!(await enabled())) return mockSeasons(seriesId);
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyBaseItem[] }>(buildSeasonsUrl(uid, seriesId));
  return (data.Items ?? []).map(mapItem);
}

export async function getEpisodes(seriesId: string, seasonId: string): Promise<MediaItem[]> {
  if (!(await enabled())) return mockEpisodes(seriesId, seasonId);
  const uid = await getUserId();
  if (!uid) return [];
  const data = await embyGet<{ Items?: EmbyBaseItem[] }>(buildEpisodesUrl(uid, seriesId, seasonId));
  return (data.Items ?? []).map(mapItem);
}

// Play an on-demand item (film or episode) on a session. Same POST shape as
// playChannel; named separately for call-site clarity.
export async function playItem(sessionId: string, itemId: string): Promise<void> {
  return playChannel(sessionId, itemId);
}
