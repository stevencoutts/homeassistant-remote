import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drive loadFavourites through a fake HA connection so we can assert how it
// walks the browse_media tree without a live Home Assistant.
const sendMessagePromise = vi.fn();
vi.mock('./connection', () => ({
  getConnection: () => ({ sendMessagePromise })
}));

import { loadFavourites } from './favourites';

beforeEach(() => sendMessagePromise.mockReset());

describe('loadFavourites', () => {
  it('returns the playable stations under a Sonos Favorites node', async () => {
    // Call 1: browse root -> has a Favorites folder. Call 2: browse that folder
    // -> playable stations.
    sendMessagePromise
      .mockResolvedValueOnce({
        title: 'Sonos',
        children: [
          { title: 'Favorites', media_content_id: 'FV:2', media_content_type: 'favorites', can_play: false, can_expand: true },
          { title: 'Radio', media_content_id: 'R:0', media_content_type: 'library', can_play: false, can_expand: true }
        ]
      })
      .mockResolvedValueOnce({
        title: 'Favorites',
        children: [
          { title: 'Radio 2', media_content_id: 'x-sonosapi:r2', media_content_type: 'radio', can_play: true, can_expand: false },
          { title: 'LBC', media_content_id: 'x-sonosapi:lbc', media_content_type: 'radio', can_play: true, can_expand: false }
        ]
      });
    const favs = await loadFavourites('media_player.kitchen_sonos_one');
    expect(favs.map((f) => f.title)).toEqual(['Radio 2', 'LBC']);
  });

  it('returns nothing for a player with no Favorites node (e.g. a Google TV)', async () => {
    // A Google TV exposes browsable apps at the root but no "Favorites" folder.
    sendMessagePromise.mockResolvedValue({
      title: 'Google TV',
      children: [
        { title: 'Netflix', media_content_id: 'app:netflix', media_content_type: 'app', can_play: true, can_expand: false },
        { title: 'YouTube', media_content_id: 'app:youtube', media_content_type: 'app', can_play: true, can_expand: false }
      ]
    });
    const favs = await loadFavourites('media_player.kitchen');
    expect(favs).toEqual([]);
    // It must not descend past the root once it sees there is no Favorites node.
    expect(sendMessagePromise).toHaveBeenCalledTimes(1);
  });
});
