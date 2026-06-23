# Emby on-demand browser (films and TV series) — design

**Status:** Ready for implementation
**Companion:** extends the existing Emby Live TV integration (`src/lib/emby/`,
EPG guide, `/emby` proxy) and the media-browser pattern
(`src/lib/components/MediaBrowser.svelte`).

## 1. Goal

Add an on-demand browser to the Media card so a room can pick a film or TV
series from the Emby library and play it on that room's TV. It sits beside the
existing **TV Guide** (Live TV) button as a **Films & TV** button.

Scope chosen for v1 (browse only, no search):

- **Continue Watching** row: partially watched films and episodes, with a
  progress bar, resumed from where they were left.
- **Recently Added** row: newly added films and series for discovery.
- **Library browse**: the Movies and TV Series libraries, A to Z. A series
  drills into seasons, a season into episodes.
- No text search in v1 (kiosk tablet, no comfortable keyboard). The data layer
  leaves room to add it later.

Out of scope for v1 (note for later): Next Up row, search, genres/collections,
per-user profiles (we reuse the single picked Emby user, as Live TV does),
trailers, and any download/offline behaviour.

## 2. Why this is a small change

The hard parts already exist and are reused unchanged:

- **Proxy.** `server/index.js` already forwards any `/emby/*` path with the API
  key injected server-side. The new endpoints (`/Users/{id}/Items/Resume`,
  `/Users/{id}/Items/Latest`, `/Items`, `/Shows/...`) need **no** server change.
- **Enable flag.** `enabled()` already reads `/config.json` `emby === true` and
  falls back to mock data when off. The VOD calls use the same gate, so the
  browser renders offline against a fixture exactly like the EPG.
- **User selection.** `getUserId()` / `pickUser()` already choose the Emby user.
- **Playback + device routing.** Playing a film is the same POST as playing a
  channel: `/Sessions/{sessionId}/Playing?ItemIds={id}&PlayCommand=PlayNow`. The
  session-matching logic that sends playback to the right room's Apple TV (IP,
  DeviceId binding, hint, wake-and-retry, verify-and-correct) is reused.

So the work is: a few read functions and mappers in the Emby client, normalised
item types, a mock fixture, one new full-screen Svelte component, and a button.

## 3. Data model

New normalised shapes in `src/lib/emby/types.ts` (the UI never sees raw Emby
field names; `client.ts` maps onto these):

```ts
export type MediaKind = 'Movie' | 'Series' | 'Season' | 'Episode';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  poster?: string;        // proxied /emby image URL, or undefined
  year?: number;
  overview?: string;
  // Resume / progress
  resumePositionTicks?: number;  // Emby ticks (1e7 = 1s); for Continue Watching
  runtimeTicks?: number;
  progressPct?: number;          // 0..100, derived; drives the progress bar
  // Episode context
  seriesId?: string;
  seriesName?: string;
  parentIndexNumber?: number;    // season number
  indexNumber?: number;          // episode number within season
}

export interface MediaLibrary {
  id: string;        // Emby CollectionFolder Id
  name: string;
  kind: 'movies' | 'tvshows';
}
```

`PlayTarget` and the Live TV `Channel`/`Programme` shapes are unchanged.

## 4. Emby client additions (`src/lib/emby/client.ts`)

All gated by the existing `enabled()` and `getUserId()`; all return mock data
when Emby is off. Pure URL/body builders and response mappers are exported for
unit testing, mirroring the Live TV style (`buildChannelsUrl`, `mapChannel`).

| Function | Endpoint | Returns |
|---|---|---|
| `getLibraries()` | `GET /Users/{uid}/Views` | `MediaLibrary[]` (filter to `movies`/`tvshows` `CollectionType`) |
| `getContinueWatching()` | `GET /Users/{uid}/Items/Resume?MediaTypes=Video&Limit=24&Fields=...` | `MediaItem[]` with `progressPct` |
| `getRecentlyAdded()` | `GET /Users/{uid}/Items/Latest?Limit=24&Fields=...` | `MediaItem[]` |
| `getLibraryItems(libId, kind)` | `GET /Users/{uid}/Items?ParentId={libId}&SortBy=SortName&Recursive=false` | `MediaItem[]` (films, or series) |
| `getSeasons(seriesId)` | `GET /Shows/{seriesId}/Seasons?UserId={uid}` | `MediaItem[]` (`kind: 'Season'`) |
| `getEpisodes(seriesId, seasonId)` | `GET /Shows/{seriesId}/Episodes?SeasonId={seasonId}&UserId={uid}&Fields=...` | `MediaItem[]` (`kind: 'Episode'`, with `progressPct`) |
| `playItem(sessionId, itemId)` | `POST /Sessions/{id}/Playing?ItemIds={itemId}&PlayCommand=PlayNow` | void |

Helpers:

- `posterUrl(itemId, tag?)` -> `/emby/Items/{id}/Images/Primary?maxHeight=330&quality=85`
  (same proxied pattern as `mapChannel`). For episodes with no own image, fall
  back to the series poster id where Emby provides `SeriesPrimaryImageTag`.
- `progressPct(item)` -> from `UserData.PlaybackPositionTicks` / `RunTimeTicks`,
  clamped 0..100. Pure, unit-tested.
- `mapItem(EmbyItem)` -> `MediaItem`. Pure, unit-tested for each kind.

`playItem` is a thin alias of the existing channel-play POST (same shape); the
existing `playChannel` is left in place for Live TV.

## 5. Playback / device routing (shared)

Factor the device-resolution-and-play sequence the EPG guide uses into a small
framework-agnostic helper, `src/lib/emby/playback.ts`, so the new component does
not duplicate ~150 lines of session logic and the two cannot drift:

```ts
createPlaybackController({
  appleTvHint, appleTvIp, appleTvEntity, embySource,
  flash,                 // (msg: string) => void  — toast callback
  wake,                  // () => void             — mediaTurnOn + selectSource
}): {
  ensureTarget(): Promise<PlayTarget | null>;   // binding -> find -> wake -> retry
  play(itemId, label): Promise<void>;           // ensureTarget + playItem + verify
  target: PlayTarget | null;
}
```

It owns: the `emby_binding:{entity}` localStorage key, `loadDeviceId`/`saveDeviceId`,
stale-binding validation against `listPlayTargets()`, `findPlayTarget`, the
wake-and-retry loop, and the confident-target / verify-and-correct logic
(unchanged behaviour, just lifted out of `EpgGuide.svelte`). The EPG guide
keeps working as-is in v1; migrating it onto this helper is a low-risk
follow-up, not required for this feature.

## 6. Component: `MediaVodBrowser.svelte`

Full-screen overlay (`position: fixed; inset: 0; z-index: 50`), same chrome as
`EpgGuide`/`MediaBrowser`: header with title, optional `-> {target.name}`, a
back button when drilled in, and a close button. Reuses the existing CSS custom
properties; poster tiles reuse the `.mb-grid` / `.mb-tile` look.

Props mirror the EPG guide so the card can pass the same values:
`appleTvHint`, `appleTvIp`, `appleTvEntity`, `embySource`, `onClose`.

Views (a simple navigation stack, like `MediaBrowser`):

1. **Home** (stack empty): horizontal **Continue Watching** row (poster tiles
   with a thin progress bar across the bottom), horizontal **Recently Added**
   row, then a **Libraries** section listing Movies and TV Series. Films and
   episodes are playable on tap; a series opens.
2. **Library grid**: poster grid of films (playable) or series (open).
3. **Series**: season list (or seasons inline) -> **episodes** list, each
   episode playable, in-progress episodes showing a progress bar.

Tapping a playable tile calls `controller.play(item.id, item.name)`, shows a
toast, and closes on success, exactly as the EPG guide and music browser do.
`Escape` goes back one level, or closes at the top. Posters use `loading="lazy"`.

Kiosk hygiene carried over: 44px targets, no text selection, horizontal rows
scroll by touch with hidden scrollbars.

## 7. Wiring into `MediaCard.svelte`

Beside the existing **TV Guide** button, gated identically
(`{#if $embyEnabled && appleTv}`):

```svelte
<button class="guide-btn" on:click={() => (showVod = true)}>
  <span class="icon">{@html icons.film}</span>Films & TV
</button>
```

and at the bottom, alongside the `EpgGuide` block:

```svelte
{#if showVod}
  <MediaVodBrowser
    appleTvHint={appleTv?.name ?? ''}
    appleTvEntity={appleTv?.entity ?? ''}
    appleTvIp={appleTv?.ip ?? ''}
    {embySource}
    onClose={() => (showVod = false)}
  />
{/if}
```

`showVod` is reset in the existing room-change effect next to `showGuide`/`showBrowser`.
Add a `film` icon to `src/lib/icons.ts`.

## 8. Offline / mock (`src/lib/emby/mock.ts`)

Add fixtures mirroring the Live TV mocks so the browser renders and tests run
with no Emby: a handful of films, two or three series each with seasons and
episodes, a Continue Watching subset (some with `progressPct` set), and a
Recently Added subset. The client's VOD functions return these whenever
`enabled()` is false, identical to `getChannels`/`getGuide`.

## 9. Tests

Unit (Vitest), in `src/lib/emby/client.test.ts` and a new mock test:

- `mapItem` for Movie, Series, Season, Episode (field mapping, year, poster URL).
- `progressPct`: zero, partial, full, missing runtime (clamped, no NaN).
- URL/body builders for resume, latest, library items, seasons, episodes.
- `posterUrl` shape and episode -> series poster fallback.
- Mock fixtures: continue-watching items expose a 0..100 `progressPct`; series
  resolve to seasons resolve to episodes.

Playback helper (`playback.test.ts`): binding load/save, stale-binding clearing,
and that `play` calls `playItem` with the resolved session. The session-matching
core (`matchAppleTvSession`) already has coverage and is unchanged.

No live-Emby test; everything runs against mocks, matching the repo rule to
build behind a mock backend.

## 10. Acceptance criteria

- With Emby enabled, the Media card shows a **Films & TV** button for a room
  with a video player; tapping it opens the browser.
- Continue Watching lists in-progress films/episodes with a progress bar and
  resumes them on the room's TV; Recently Added lists new content; Movies and
  TV Series libraries browse A to Z; a series drills season -> episode.
- Playing any item routes to the correct room device using the same logic as the
  TV Guide (IP / DeviceId binding / hint / wake-and-retry / verify-and-correct).
- With Emby disabled, the browser renders the mock library and the rest of the
  app is unaffected.
- No Emby key reaches the browser (proxy injects it, unchanged).
- All existing tests still pass; new client/mapper/helper tests pass.
