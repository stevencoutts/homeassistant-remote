import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drive the browse layer through a fake HA connection so we can assert how it
// maps and walks the browse_media tree without a live Home Assistant.
const sendMessagePromise = vi.fn();
let connected = true;
vi.mock('./connection', () => ({
  getConnection: () => (connected ? { sendMessagePromise } : null)
}));

import {
  mapChild,
  primaryAction,
  pickMusicRoot,
  findMusicRoot,
  browseNode,
  type BrowseItem
} from './browse';

beforeEach(() => {
  sendMessagePromise.mockReset();
  connected = true;
});

describe('mapChild', () => {
  it('maps a browse_media child to a BrowseItem', () => {
    expect(
      mapChild({
        title: 'AM',
        media_content_id: 'album:am',
        media_content_type: 'album',
        can_play: true,
        can_expand: true,
        thumbnail: 'http://art/am.jpg'
      })
    ).toEqual({
      title: 'AM',
      contentId: 'album:am',
      contentType: 'album',
      canPlay: true,
      canExpand: true,
      thumbnail: 'http://art/am.jpg'
    });
  });

  it('defaults a missing thumbnail to null', () => {
    expect(mapChild({
      title: 'Artist',
      media_content_id: 'artist:x',
      media_content_type: 'artist',
      can_play: false,
      can_expand: true
    }).thumbnail).toBeNull();
  });
});

describe('primaryAction', () => {
  const item = (canPlay: boolean, canExpand: boolean): BrowseItem => ({
    title: 't', contentId: 'c', contentType: 'x', canPlay, canExpand
  });
  it('plays a playable leaf (track)', () => {
    expect(primaryAction(item(true, false))).toBe('play');
  });
  it('plays a mixed node (album: play primary, expand secondary)', () => {
    expect(primaryAction(item(true, true))).toBe('play');
  });
  it('expands a folder-only node (artist)', () => {
    expect(primaryAction(item(false, true))).toBe('expand');
  });
});

describe('pickMusicRoot', () => {
  const node = (title: string, type = 'directory') => ({
    title, media_content_id: title, media_content_type: type,
    can_play: false, can_expand: true
  });
  it('prefers a Plex node', () => {
    expect(pickMusicRoot([node('Favorites'), node('Plex'), node('Music Library')])?.title)
      .toBe('Plex');
  });
  it('falls back to a Music Library node when no Plex', () => {
    expect(pickMusicRoot([node('Favorites'), node('Music Library')])?.title)
      .toBe('Music Library');
  });
  it('returns null when neither is present', () => {
    expect(pickMusicRoot([node('Favorites'), node('Apps')])).toBeNull();
  });
});

describe('findMusicRoot (live)', () => {
  it('resolves the Plex node from the player root', async () => {
    sendMessagePromise.mockResolvedValueOnce({
      title: 'Sonos',
      media_content_id: '',
      media_content_type: '',
      can_play: false,
      can_expand: true,
      children: [
        { title: 'Favorites', media_content_id: 'FV:2', media_content_type: 'favorites', can_play: false, can_expand: true },
        { title: 'Plex', media_content_id: 'plex://music', media_content_type: 'plex', can_play: false, can_expand: true }
      ]
    });
    const root = await findMusicRoot('media_player.kitchen_sonos');
    expect(root?.contentId).toBe('plex://music');
  });

  it('returns null (use bare root) when no music node is found', async () => {
    sendMessagePromise.mockResolvedValueOnce({
      title: 'Google TV', media_content_id: '', media_content_type: '',
      can_play: false, can_expand: true,
      children: [{ title: 'Netflix', media_content_id: 'app:n', media_content_type: 'app', can_play: true, can_expand: false }]
    });
    expect(await findMusicRoot('media_player.tv')).toBeNull();
  });
});

describe('browseNode (live)', () => {
  it('echoes the node ids to browse_media and maps the children', async () => {
    sendMessagePromise.mockResolvedValueOnce({
      title: 'By Artist',
      media_content_id: 'plex:artists',
      media_content_type: 'artists',
      can_play: false,
      can_expand: true,
      children: [
        { title: '808 State', media_content_id: 'artist:808', media_content_type: 'artist', can_play: false, can_expand: true }
      ]
    });
    const node: BrowseItem = { title: 'By Artist', contentId: 'plex:artists', contentType: 'artists', canPlay: false, canExpand: true };
    const res = await browseNode('media_player.kitchen_sonos', node);
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'media_player/browse_media',
      entity_id: 'media_player.kitchen_sonos',
      media_content_id: 'plex:artists',
      media_content_type: 'artists'
    });
    expect(res.items.map((i) => i.title)).toEqual(['808 State']);
  });
});

describe('browse (offline mock)', () => {
  beforeEach(() => { connected = false; });

  it('serves a synthetic Plex root with no connection', async () => {
    const root = await findMusicRoot('media_player.kitchen_sonos');
    expect(root?.title).toBe('Plex');
  });

  it('navigates the mock tree root -> By Artist -> artist -> album', async () => {
    const top = await browseNode('media_player.kitchen_sonos');
    expect(top.items.map((i) => i.title)).toContain('By Artist');

    const byArtist = top.items.find((i) => i.title === 'By Artist')!;
    const artists = await browseNode('media_player.kitchen_sonos', byArtist);
    expect(artists.items.length).toBeGreaterThan(0);
    expect(artists.items.every((i) => i.canExpand)).toBe(true);

    const firstArtist = artists.items[0];
    const albums = await browseNode('media_player.kitchen_sonos', firstArtist);
    expect(albums.items.length).toBeGreaterThan(0);
    // Albums are both playable and expandable.
    expect(albums.items[0].canPlay).toBe(true);
    expect(albums.items[0].canExpand).toBe(true);
  });
});
