import type { BrowseItem, BrowseNode } from './browse';

// A small Plex-like music tree so the media browser renders and navigates with
// no live HA connection (offline-mock), mirroring the approach in emby/mock.ts.
// Shape: Music root -> By Artist / Playlists -> artists -> albums -> tracks.

interface MockNode {
  title: string;
  contentId: string;
  contentType: string;
  thumbnail?: string;
  children?: MockNode[];
}

const track = (album: string, n: number, title: string): MockNode => ({
  title,
  contentId: `track:${album}:${n}`,
  contentType: 'track'
  // tracks are leaves (can_play, not can_expand)
});

const album = (artist: string, title: string, tracks: string[]): MockNode => ({
  title,
  contentId: `album:${artist}:${title}`,
  contentType: 'album',
  children: tracks.map((t, i) => track(`${artist}:${title}`, i + 1, t))
});

const artist = (name: string, albums: MockNode[]): MockNode => ({
  title: name,
  contentId: `artist:${name}`,
  contentType: 'artist',
  children: albums
});

const artists: MockNode[] = [
  artist('808 State', [
    album('808 State', 'Ex:el', ['San Francisco', 'Spanish Heart', 'Cübik']),
    album('808 State', '90', ['Magical Dream', 'Ancodia', 'Pacific 202'])
  ]),
  artist('Aphex Twin', [
    album('Aphex Twin', 'Selected Ambient Works 85-92', ['Xtal', 'Tha', 'Pulsewidth']),
    album('Aphex Twin', 'Richard D. James Album', ['4', 'Cornish Acid', 'Peek 824545201'])
  ]),
  artist('Autechre', [
    album('Autechre', 'Amber', ['Foil', 'Montreal', 'Silverside']),
    album('Autechre', 'Tri Repetae', ['Dael', 'Clipper', 'Leterel'])
  ]),
  artist('Arctic Monkeys', [
    album('Arctic Monkeys', 'AM', ['Do I Wanna Know?', 'R U Mine?', 'Arabella'])
  ])
];

const playlists: MockNode = {
  title: 'Playlists',
  contentId: 'plex:playlists',
  contentType: 'playlists',
  children: [
    {
      title: 'Heart 90s',
      contentId: 'playlist:heart-90s',
      contentType: 'playlist',
      children: [
        track('heart-90s', 1, 'Britney Spears - Born To Make You Happy'),
        track('heart-90s', 2, 'Spice Girls - Wannabe')
      ]
    },
    {
      title: 'Electronic Essentials',
      contentId: 'playlist:electronic',
      contentType: 'playlist',
      children: [track('electronic', 1, 'Leftfield - Phat Planet')]
    }
  ]
};

const byArtist: MockNode = {
  title: 'By Artist',
  contentId: 'plex:artists',
  contentType: 'artists',
  children: artists
};

const root: MockNode = {
  title: 'Plex',
  contentId: 'plex:music',
  contentType: 'music',
  children: [byArtist, playlists]
};

function find(node: MockNode, contentId: string): MockNode | null {
  if (node.contentId === contentId) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, contentId);
    if (hit) return hit;
  }
  return null;
}

function toItem(n: MockNode): BrowseItem {
  return {
    title: n.title,
    contentId: n.contentId,
    contentType: n.contentType,
    // A node can play if it has no children (track) or is an album/playlist.
    canPlay: !n.children || /album|playlist|track/.test(n.contentType),
    canExpand: !!n.children,
    thumbnail: n.thumbnail ?? null
  };
}

export function mockBrowse() {
  return {
    root: toItem(root),
    node(item?: BrowseItem): BrowseNode {
      const target = item ? find(root, item.contentId) ?? root : root;
      return {
        title: target.title,
        contentId: target.contentId,
        contentType: target.contentType,
        items: (target.children ?? []).map(toItem)
      };
    }
  };
}
