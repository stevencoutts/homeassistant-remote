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
  return conn.sendMessagePromise<BrowseResult>({
    type: 'media_player/browse_media',
    entity_id,
    ...(media_content_id ? { media_content_id, media_content_type } : {})
  });
}

// Sonos exposes saved radio stations / playlists under a "Favorites" node.
// Browse the root, descend into it if present, and return the playable items.
export async function loadFavourites(entity_id: string): Promise<Favourite[]> {
  if (!getConnection()) return [];
  try {
    const root = await browse(entity_id);
    // ponytail: temporary diagnostic — remove once the favourites path is confirmed.
    console.log(
      '[favourites] root children:',
      (root.children ?? []).map((c) => ({
        title: c.title,
        type: c.media_content_type,
        id: c.media_content_id,
        can_play: c.can_play,
        can_expand: c.can_expand
      }))
    );
    const favNode = root.children?.find(
      (c) => /favorit/i.test(c.title) || /favorit/i.test(c.media_content_type)
    );
    const node = favNode
      ? await browse(entity_id, favNode.media_content_id, favNode.media_content_type)
      : root;
    console.log(
      '[favourites] favNode:',
      favNode?.title,
      '→ children:',
      (node.children ?? []).map((c) => ({
        title: c.title,
        type: c.media_content_type,
        can_play: c.can_play,
        can_expand: c.can_expand
      }))
    );
    return (node.children ?? [])
      .filter((c) => c.can_play)
      .map((c) => ({
        title: c.title,
        contentId: c.media_content_id,
        contentType: c.media_content_type,
        thumbnail: c.thumbnail
      }));
  } catch (err) {
    console.error('Failed to load Sonos favourites', err);
    return [];
  }
}
