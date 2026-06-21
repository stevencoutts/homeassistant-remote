import { getConnection } from './connection';

export interface Favourite {
  title: string;
  contentId: string;
  contentType: string;
  thumbnail?: string | null;
}

interface BrowseResult {
  title: string;
  media_content_id: string;
  media_content_type: string;
  can_play: boolean;
  can_expand: boolean;
  thumbnail?: string | null;
  children?: BrowseResult[];
}

function browse(entity_id: string, media_content_id?: string, media_content_type?: string) {
  const conn = getConnection();
  if (!conn) return Promise.reject(new Error('no connection'));
  // The favourites node uses an empty media_content_id, so key off the type:
  // when a type is given, send both (id may legitimately be '').
  return conn.sendMessagePromise<BrowseResult>({
    type: 'media_player/browse_media',
    entity_id,
    ...(media_content_type ? { media_content_id: media_content_id ?? '', media_content_type } : {})
  });
}

// Collect playable items under a node, descending into folders up to `depth`
// levels (Sonos nests favourites as Favorites → Radio/Playlists → stations).
async function collectPlayable(
  entity_id: string,
  node: BrowseResult,
  depth: number
): Promise<Favourite[]> {
  const out: Favourite[] = [];
  for (const c of node.children ?? []) {
    if (c.can_play) {
      out.push({
        title: c.title,
        contentId: c.media_content_id,
        contentType: c.media_content_type,
        thumbnail: c.thumbnail
      });
    } else if (c.can_expand && depth > 0) {
      const sub = await browse(entity_id, c.media_content_id, c.media_content_type);
      out.push(...(await collectPlayable(entity_id, sub, depth - 1)));
    }
  }
  return out;
}

// Sonos exposes saved radio stations / playlists under a "Favorites" node,
// itself split into folders. Browse in and gather the playable leaves.
export async function loadFavourites(entity_id: string): Promise<Favourite[]> {
  if (!getConnection()) return [];
  try {
    const root = await browse(entity_id);
    const favNode = root.children?.find(
      (c) => /favorit/i.test(c.title) || /favorit/i.test(c.media_content_type)
    );
    const node = favNode
      ? await browse(entity_id, favNode.media_content_id, favNode.media_content_type)
      : root;
    const favs = await collectPlayable(entity_id, node, 2);
    // ponytail: temporary — remove once favourites are confirmed showing.
    console.log('[favourites] collected:', favs.map((f) => f.title));
    return favs;
  } catch (err) {
    console.error('Failed to load Sonos favourites', err);
    return [];
  }
}
