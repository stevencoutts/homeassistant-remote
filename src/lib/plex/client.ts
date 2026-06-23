// Talks to Plex through the same-origin proxy (`/plex/...`); the server injects
// the X-Plex-Token. Used to read and set a track's star rating so the media card
// can offer thumbs up/down. When the proxy is not configured (dev, or no PLEX_*
// env) the client serves a tiny in-memory mock so the buttons still work.
//
// Plex has no "love" concept for library music; it uses a 0-10 star rating
// (`userRating`). We map: thumbs up = 10 (5 stars), thumbs down = 2 (1 star),
// and tapping the active thumb again clears it (0).

export type Thumb = 'up' | 'down' | 'none';
export const RATING_UP = 10;
export const RATING_DOWN = 2;

export interface TrackRating {
  ratingKey: string;
  userRating: number; // 0-10 (0 = unrated)
}

export interface NowPlaying {
  title?: string;
  artist?: string;
  album?: string;
  contentId?: string;
}

// --- Pure helpers (unit-tested) ---

// Map a 0-10 Plex userRating to a thumb state. 6+ is "up", 1-5 is "down".
export function thumbState(userRating?: number): Thumb {
  const r = userRating ?? 0;
  if (r >= 6) return 'up';
  if (r > 0) return 'down';
  return 'none';
}

// The rating to write when a thumb is tapped: tapping the active thumb clears
// (0); otherwise it sets that thumb's rating.
export function nextRating(current: number | undefined, action: 'up' | 'down'): number {
  const state = thumbState(current);
  if (action === 'up') return state === 'up' ? 0 : RATING_UP;
  return state === 'down' ? 0 : RATING_DOWN;
}

// Best-effort extraction of a Plex metadata ratingKey from a media_content_id.
// Handles `/library/metadata/12345`, `plex://track/12345` and bare numeric ids.
export function parseRatingKey(contentId?: string): string | null {
  if (!contentId) return null;
  const lib = contentId.match(/library\/metadata\/(\d+)/);
  if (lib) return lib[1];
  const tail = contentId.match(/(?:^|[/:])(\d{2,})$/);
  if (tail) return tail[1];
  return null;
}

interface PlexMeta {
  ratingKey: string;
  title?: string;
  grandparentTitle?: string; // artist
  parentTitle?: string; // album
  userRating?: number;
  type?: string;
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

// Choose the session whose track matches the HA now-playing metadata. Match on
// title; among title matches prefer one whose artist (grandparentTitle) agrees.
export function pickSession(sessions: PlexMeta[], np: NowPlaying): PlexMeta | null {
  const title = norm(np.title);
  if (!title) return null;
  const byTitle = sessions.filter((s) => norm(s.title) === title);
  if (!byTitle.length) return null;
  if (np.artist) {
    const a = norm(np.artist);
    const exact = byTitle.find((s) => norm(s.grandparentTitle) === a);
    if (exact) return exact;
  }
  return byTitle[0];
}

// --- Live calls (browser -> /plex proxy) ---

async function plexGet<T>(path: string): Promise<T> {
  const res = await fetch(`/plex${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Plex ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

let enabledCache: boolean | null = null;
async function enabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' });
    const cfg = res.ok ? await res.json() : {};
    enabledCache = cfg?.plex === true;
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

// In-memory rating store for the offline/dev mock.
const mockRatings = new Map<string, number>();

// Resolve the currently-playing track to its Plex ratingKey and current rating.
// Prefers the active Plex session (most reliable for "now playing"), then falls
// back to a ratingKey parsed from the HA media_content_id.
export async function resolveTrack(np: NowPlaying): Promise<TrackRating | null> {
  if (!(await enabled())) {
    const key = parseRatingKey(np.contentId) ?? 'mock';
    return { ratingKey: key, userRating: mockRatings.get(key) ?? 0 };
  }
  try {
    const data = await plexGet<{ MediaContainer?: { Metadata?: PlexMeta[] } }>('/status/sessions');
    const sess = pickSession(data.MediaContainer?.Metadata ?? [], np);
    if (sess) return { ratingKey: sess.ratingKey, userRating: sess.userRating ?? 0 };
  } catch (err) {
    console.error('Plex sessions lookup failed', err);
  }
  const key = parseRatingKey(np.contentId);
  if (!key) return null;
  try {
    const data = await plexGet<{ MediaContainer?: { Metadata?: PlexMeta[] } }>(
      `/library/metadata/${key}`
    );
    const meta = data.MediaContainer?.Metadata?.[0];
    return { ratingKey: key, userRating: meta?.userRating ?? 0 };
  } catch (err) {
    console.error('Plex metadata lookup failed', err);
    return { ratingKey: key, userRating: 0 };
  }
}

// Write a rating (0-10) for a track. Returns the rating applied.
export async function setRating(ratingKey: string, rating: number): Promise<number> {
  if (!(await enabled())) {
    mockRatings.set(ratingKey, rating);
    return rating;
  }
  const q = new URLSearchParams({
    key: ratingKey,
    identifier: 'com.plexapp.plugins.library',
    rating: String(rating)
  });
  const res = await fetch(`/plex/:/rate?${q}`, { method: 'PUT', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Plex rate -> ${res.status}`);
  return rating;
}
