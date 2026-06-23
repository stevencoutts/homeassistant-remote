import { getConnection } from './connection';
import { mockBrowse } from './browse.mock';

// On-demand media browser over HA's `media_player/browse_media` WebSocket
// command. Unlike `favourites.ts` (which pre-flattens the Sonos "Favorites"
// node into a preset row), this browses lazily one node at a time so the user
// can drill artist -> album -> track. The selected leaf is played with the
// existing `media_player.play_media` path (see services.ts `playMedia`).
//
// Source: Plex, reached through HA's native Plex integration (route 2 in the
// design spec). Plex appears in the player's browse tree as a node whose title
// matches /plex/i; we resolve that node as the browse root so the user lands in
// the music library rather than at the bare player root. When no Plex node is
// found we fall back to a Music Library node, then to the root itself.
//
// Offline (no HA connection) the client serves a small mock tree so the browser
// renders and navigates without a live backend, mirroring `emby/client.ts`.

export interface BrowseItem {
  title: string;
  contentId: string;
  contentType: string;
  canPlay: boolean;
  canExpand: boolean;
  thumbnail?: string | null;
}

export interface BrowseNode {
  title: string;
  contentId: string;
  contentType: string;
  items: BrowseItem[];
}

// The raw shape HA returns from media_player/browse_media.
interface BrowseResult {
  title: string;
  media_content_id: string;
  media_content_type: string;
  can_play: boolean;
  can_expand: boolean;
  thumbnail?: string | null;
  children?: BrowseResult[];
}

// --- Pure helpers (unit-tested) ---

export function mapChild(c: BrowseResult): BrowseItem {
  return {
    title: c.title,
    contentId: c.media_content_id,
    contentType: c.media_content_type,
    canPlay: c.can_play,
    canExpand: c.can_expand,
    thumbnail: c.thumbnail ?? null
  };
}

// Primary tap action for a node. A playable node plays (albums, playlists and
// tracks Plex marks can_play); a folder-only node expands. Mixed nodes expose
// expand as a secondary affordance in the UI, but the primary tap plays.
export function primaryAction(item: BrowseItem): 'play' | 'expand' {
  return item.canPlay ? 'play' : 'expand';
}

// Choose the music root from a player's top-level children: prefer a Plex node,
// then a Music Library node, else null (caller uses the root itself).
export function pickMusicRoot(children: BrowseResult[]): BrowseResult | null {
  const byTitle = (re: RegExp) =>
    children.find((c) => re.test(c.title) || re.test(c.media_content_type));
  return byTitle(/plex/i) ?? byTitle(/music\s*library|^library$|^music$/i) ?? null;
}

// --- Live calls (browser -> HA WebSocket) ---

function rawBrowse(
  entity_id: string,
  media_content_id?: string,
  media_content_type?: string
): Promise<BrowseResult> {
  const conn = getConnection();
  if (!conn) return Promise.reject(new Error('no connection'));
  return conn.sendMessagePromise<BrowseResult>({
    type: 'media_player/browse_media',
    entity_id,
    // The root browse sends no id/type; deeper browses echo the node's own ids.
    ...(media_content_type
      ? { media_content_id: media_content_id ?? '', media_content_type }
      : {})
  });
}

// Resolve the Plex (music) root node for a player. Returns the node to browse
// into, or null to browse the bare player root. Offline: a synthetic root.
export async function findMusicRoot(entity_id: string): Promise<BrowseItem | null> {
  if (!getConnection()) return mockBrowse().root;
  try {
    const root = await rawBrowse(entity_id);
    const node = pickMusicRoot(root.children ?? []);
    return node ? mapChild(node) : null;
  } catch (err) {
    console.error('Failed to resolve music root', err);
    return null;
  }
}

// Browse a node and return its direct children (no recursive flattening).
// `node` undefined browses the player root. Offline: serve the mock tree.
export async function browseNode(
  entity_id: string,
  node?: BrowseItem
): Promise<BrowseNode> {
  if (!getConnection()) return mockBrowse().node(node);
  const res = await rawBrowse(entity_id, node?.contentId, node?.contentType);
  return {
    title: res.title,
    contentId: res.media_content_id,
    contentType: res.media_content_type,
    items: (res.children ?? []).map(mapChild)
  };
}
