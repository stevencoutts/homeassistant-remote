# Design: Media browser — pick music from Plex to play on the Sonos card

Source: **Plex** (decided). The Sonos Music Library (NAS folder tree) is a
fallback if Plex cannot be reached through HA; Emby is out of scope.

**Date:** 2026-06-23
**Status:** Implemented behind the mock backend (2026-06-23). Live-HA root
resolution pending verification on the kiosk — see Open questions.
**Affects:** `src/lib/components/MediaCard.svelte`, `src/lib/ha/favourites.ts` (extend or add sibling `browse.ts`), `src/lib/services.ts`; new `MediaBrowser.svelte` component; `src/app.css`; new pure helpers + tests. Update `room-remote-spec.md` section 4.2 (Media) once approved.

## Problem

The Media card plays only Sonos *favourites*: `loadFavourites` flattens the
player's "Favorites" node into a preset row and `play_media` plays a chosen
leaf. There is no way to browse the wider music library and pick an
artist, album, playlist or track on demand. The user wants to start music from
their Plex library on the room's Sonos without leaving the remote.

## Background — what already exists

The browse-and-play primitive is already in the repo and is source-agnostic:

- `favourites.ts` calls HA's `media_player/browse_media` WebSocket command and
  walks the returned tree (`browse`, `collectPlayable`).
- `services.ts` plays a selected item with `playMediaCall` →
  `media_player.play_media` (`playFavourite`).
- `MediaCard.svelte` already resolves the correct Sonos play target, including
  the group-coordinator rule (`playTarget`: play must go to
  `group_members[0]`, not a grouped member), and identifies Sonos players by
  the `group_members` attribute (`sonosIds`).

So a media browser is a richer consumer of the *same* HA `browse_media` API,
reusing the existing play path. No new HA service is needed.

## Source: Plex (decided)

Plex is already configured on this system and presents a properly indexed music
catalogue, not a raw folder tree. Confirmed top-level Plex nodes (from the Sonos
Plex view): **Discover**, **Playlists**, **By Artist**, **By Album**, **Shuffle
All**, **Recently Played Music**, **Recently Added in Music**, and contextual
"More by / More in" rows, each with artwork. By Artist → albums → tracks, plus
playlists and the recents — a far better browse experience than folders.

**Route confirmed (2026-06-23): HA native Plex integration as a media source.**
HA's Media browser shows Plex → Music with full artwork, a "Recommended
(Music)" tile and a By-Artist grid of playable, expandable artist tiles. Plex
(and Emby) appear as media-source entities in HA. So:

1. ~~Sonos entity browse~~ — not the route used.
2. **HA Plex integration / media source (USE THIS).** Browse the Plex media
   source tree via HA and `play_media` the returned `media_content_id` /
   `media_content_type` to the room's Sonos entity (group coordinator). The
   browse root is the Plex Music node; the play target is the Sonos. The
   echo-the-id play pattern is unchanged from favourites.

Either way the browser is source-agnostic: it renders each node's
`title`/`thumbnail`/`can_expand`/`can_play` and passes the node's own
`media_content_id`/`media_content_type` straight to `play_media` (exactly as
`favourites.ts`/`playMediaCall` already do). No Plex-specific id construction.

**Fallback.** If neither route exposes Plex on this system, fall back to the
Sonos Music Library (the NAS share `//unas-pro.couttsnet.com/media/music`,
artist-folder tree), which the Sonos entity's `browse_media` does surface. Same
browser, less rich (folders, no indexes/artwork). Emby is out of scope.

**Design stance:** the browser renders whatever `browse_media` exposes on the
room's Sonos. It does not hard-code "Plex" or "Emby". If a source is in the
tree it is browsable and playable; if it is not, it does not appear. This keeps
the app config-driven (per the guardrails) and means Plex works on day one and
Emby works if and when it is reachable, with no source-specific code.

## Decision

### 1. Entry point on the Media card
- Add a "Browse" button to the card head, next to the existing "TV Guide"
  button, shown only when the room has a Sonos play target (reuse `sonosIds` /
  `playTarget`). Icon + "Music" label, same pill styling as `guide-btn`.
- Tapping opens a full-screen `MediaBrowser` overlay (same pattern as
  `EpgGuide`: mounted from `MediaCard`, `onClose` prop, closed on room change).

### 2. MediaBrowser component (new)
- Props: `entity` (the Sonos browse source), `playTarget` (the coordinator to
  play to), `onClose`.
- On open, browse the **Plex root** rather than the bare player root: resolve
  it once by browsing `browse(entity)` and selecting the child whose title/type
  matches Plex (a small `findPlexNode` helper, mirroring how `loadFavourites`
  finds the Favorites node). If route 2 (media source) is the live answer
  instead, the root is the Plex media-source node; the resolver abstracts this.
  Fall back to the full player root (Sonos Music Library) if no Plex node found.
- Show the current node's children as a grid of tap targets: thumbnail (if
  `thumbnail`), title, and a folder/track affordance derived from
  `can_expand` / `can_play`.
- **Navigation.** Tapping an expandable node (`can_expand`) browses into it and
  pushes onto a breadcrumb stack; a Back control pops it. Tapping a playable
  node (`can_play`) calls `play_media` against `playTarget` and closes (or shows
  a brief "Playing…" confirmation, then closes).
- **Mixed nodes.** Some nodes are both expandable and playable (e.g. an album).
  Primary tap = play; a separate chevron/secondary affordance = expand. Keep
  the 44 px target rule.
- Loading and empty states: spinner while a browse is in flight; "Nothing
  here" for an empty node; an error row if a browse/play call rejects.

### 3. Browse layer (extend `favourites.ts` or add `browse.ts`)
- Reuse the existing `browse(entity_id, media_content_id?, media_content_type?)`
  call. Factor it out of `favourites.ts` into a shared module if cleaner; keep
  `loadFavourites` working unchanged.
- New: `browseNode(entity_id, node?)` returning the node's direct children as a
  typed list (no recursive flattening — the browser paginates by user
  navigation, unlike favourites which pre-flattens). Reuse the existing
  `BrowseResult` shape.
- No debounced/continuous writes here; browsing is request/response on tap.

### 4. Play path (reuse)
- Play via the existing `playFavourite(playTarget, contentId, contentType)` /
  `playMediaCall`. Target is `playTarget` (group coordinator), already computed
  in `MediaCard`. No change to `services.ts` beyond possibly renaming
  `playFavourite` to a neutral `playMedia` (keep a thin alias to avoid churn).

### 5. Offline-mock behaviour
- With no HA connection, `browse` rejects. The browser must show mock nodes so
  the UI runs offline (per "build behind a mock backend first"). Add a small
  mock tree (artists → albums → tracks) mirroring the `emby/mock.ts` pattern,
  selected when `getConnection()` is null.

## Components & responsibilities
- `MediaCard.svelte`: "Browse" button + overlay mount (mirrors `showGuide`).
- `MediaBrowser.svelte` (new): navigation, grid, breadcrumb, play-on-tap.
- `favourites.ts`/`browse.ts`: shared `browse`, new `browseNode`, mock tree.
- `services.ts`: reuse `playMediaCall`; optional neutral `playMedia` alias.
- `app.css`: browser grid, breadcrumb, row styles (derive from mockup tokens).

## Out of scope (YAGNI)
- Source-specific code or branding for Plex/Emby.
- Search within a library (browse only for v1).
- Queue management, add-to-queue, shuffle/repeat, multi-room grouping.
- Casting Emby music via any path other than what `browse_media` already
  exposes — if Emby music is not in the tree, do not build a bespoke bridge in
  this change.
- Persisting browse position across reloads or room switches.

## Open questions (verify against live HA before building)
1. **The decisive one — how Plex reaches HA `browse_media`.** Call
   `media_player/browse_media` on the room's Sonos entity and inspect the root
   children: is there a Plex node (route 1)? If not, does HA expose Plex as a
   media source (route 2, native Plex integration installed)? This sets the
   browse root resolver and confirms the play target. Quick to check from HA
   Developer Tools or a one-off WS call.
2. Confirm that `play_media` of a Plex node returned by browse plays on the
   Sonos coordinator (the `playTarget` rule) without extra arguments — i.e. the
   echoed `media_content_id`/`media_content_type` is sufficient.
3. Plex album/artist/playlist nodes: which set `can_play` (play the whole
   thing) vs only `can_expand`? Drives the primary-tap rule. Plex usually marks
   albums and playlists playable, which is ideal.

## Testing

Done (`src/lib/ha/browse.test.ts`, 13 tests):
- `mapChild` maps a `browse_media` child to a `BrowseItem` (incl. null thumbnail).
- `primaryAction` resolves play vs expand across `can_play`/`can_expand` combos.
- `pickMusicRoot` prefers Plex, falls back to Music Library, else null.
- `findMusicRoot` (live) resolves the Plex node from the player root; returns
  null when none found.
- `browseNode` (live) echoes the node ids to `media_player/browse_media` and
  maps the children.
- Offline mock: synthetic Plex root; navigates root → By Artist → artist →
  album, with album nodes both playable and expandable.

Verified: full suite 82 passing, `svelte-check` clean, `vite build` succeeds.

Deferred to phase 6 (no Playwright harness in the repo yet): e2e walk of the
mock browse flow in a browser, and play-on-tap asserting a single
`media_player.play_media` to the coordinator. The play path reuses
`playMediaCall`, already covered by `services.test.ts`.
