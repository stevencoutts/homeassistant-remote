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
