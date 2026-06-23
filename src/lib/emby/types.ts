// Normalised shapes the UI uses. The Emby REST responses are mapped onto these
// in client.ts so the components never see raw Emby field names.

export interface Channel {
  id: string;
  name: string;
  number?: string;
  logo?: string; // proxied image URL, or undefined
}

export interface Programme {
  id: string;
  channelId: string;
  title: string;
  start: number; // epoch ms
  end: number; // epoch ms
  description?: string;
}

export interface PlayTarget {
  sessionId: string;
  name: string;
  // Emby's stable per-client UUID — survives app restarts unlike sessionId.
  // Stored in localStorage so we never have to guess which session is which again.
  deviceId?: string;
}

// --- On-demand (films and TV series) ---

export type MediaKind = 'Movie' | 'Series' | 'Season' | 'Episode';

// A normalised library item the VOD browser renders. Mapped from Emby's BaseItem
// in client.ts so components never see raw Emby field names.
export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  poster?: string; // proxied /emby image URL, or undefined
  year?: number;
  overview?: string;
  // Resume / progress
  runtimeTicks?: number; // Emby ticks (1e7 = 1 second)
  resumePositionTicks?: number;
  progressPct?: number; // 0..100, derived; drives the progress bar
  // Episode / season context
  seriesId?: string;
  seriesName?: string;
  parentIndexNumber?: number; // season number (for an episode)
  indexNumber?: number; // episode number within the season
}

// A top-level Emby library view we offer for browsing.
export interface MediaLibrary {
  id: string; // Emby CollectionFolder Id (ParentId for its items)
  name: string;
  kind: 'movies' | 'tvshows';
}
