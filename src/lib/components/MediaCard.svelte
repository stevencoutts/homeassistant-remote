<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { entities, embyEnabled, plexEnabled } from '$lib/stores';
  import { resolveTrack, setRating, thumbState, nextRating, type TrackRating } from '$lib/plex/client';
  import { formatTime, livePosition, progressPct } from '$lib/util/progress';
  import { icons } from '$lib/icons';
  import {
    mediaPlayPause,
    mediaPrevious,
    mediaNext,
    setVolume,
    mediaMute,
    toggleSoundMode,
    playFavourite,
    toggleShuffle
  } from '$lib/services';
  import { loadFavourites, type Favourite } from '$lib/ha/favourites';
  import EpgGuide from './EpgGuide.svelte';
  import MediaBrowser from './MediaBrowser.svelte';
  import type { NamedEntity } from '$lib/types';

  export let players: NamedEntity[];
  export let soundModes: NamedEntity[] = [];

  // When Emby is enabled, any video player in the room can be the guide target.
  // We prefer a player whose entity or friendly name hints at a TV/AV device,
  // but fall back to the first player so rooms with generic entity IDs still work.
  $: appleTv = players.find((p) =>
    /apple.?tv|google.?tv|chromecast|fire.?tv|android.?tv|shield|roku/i.test(p.entity) ||
    /apple.?tv|google.?tv|chromecast|fire.?tv|android.?tv|shield|roku/i.test(p.name)
  ) ?? undefined;
  // The Emby app's name as the player lists it, used to launch it via HA.
  $: embySource = (() => {
    const list = appleTv ? $entities[appleTv.entity]?.attributes.source_list : undefined;
    if (Array.isArray(list)) {
      const m = list.find((s) => /emby/i.test(String(s)));
      if (m) return String(m);
    }
    return 'Emby';
  })();
  let showGuide = false;
  let showBrowser = false;

  // Close overlays whenever the room changes (players come from a different room).
  // MediaCard is not keyed so the same instance receives new props on room switch;
  // without this, showGuide would stay true and the guide would linger with a
  // stale/incorrect appleTvHint for a brief period.
  let _prevPlayersKey = '';
  $: {
    const key = players.map((p) => p.entity).join(',');
    if (_prevPlayersKey !== '' && key !== _prevPlayersKey) {
      showGuide = false;
      showBrowser = false;
    }
    _prevPlayersKey = key;
  }

  let selectedIdx = 0;
  let userPicked = false;

  // Until the user picks, prefer a non-Sonos player that is actively doing
  // something (playing, paused, on, standby-with-title) — Google TV often
  // reports 'standby' when the screen dims while content is paused, and 'on'
  // when a native app is running but hasn't pushed metadata yet.
  $: if (!userPicked) {
    const ACTIVE = new Set(['playing', 'paused', 'on', 'standby']);
    let i = players.findIndex(
      (p) => !(/sonos/i.test(p.entity)) && ACTIVE.has($entities[p.entity]?.state ?? '')
    );
    if (i < 0) i = players.findIndex(
      (p) => $entities[p.entity]?.attributes.media_title && !/sonos/i.test(p.entity)
    );
    if (i < 0) i = players.findIndex((p) => $entities[p.entity]?.state === 'playing');
    selectedIdx = i >= 0 ? i : 0;
  }
  $: if (selectedIdx >= players.length) selectedIdx = 0;

  $: entity = players[selectedIdx]?.entity;
  $: e = entity ? $entities[entity] : undefined;
  $: attrs = e?.attributes ?? {};
  // 'standby' is NOT idle for TV players — Google TV goes to standby when the
  // screen dims while paused; we still want to show state and enable controls.
  $: idle = !e || e.state === 'off' || e.state === 'unavailable';
  $: playing = e?.state === 'playing';
  // Volume/mute target the room's actual speaker: prefer a volume-capable Sonos,
  // else any volume-capable player, else the selected one. (VOLUME_SET = bit 4.)
  $: volumeEntity = (() => {
    const sv = (id: string) => (($entities[id]?.attributes.supported_features ?? 0) & 4) !== 0;
    // If the room has a Sonos speaker (identifiable by entity_id containing
    // "sonos"), route all volume through it — Apple TV sends audio via AirPlay
    // so the Beam is the real volume control (living room pattern).
    // Otherwise each player controls its own volume (conservatory pattern).
    const sonosPlayer = players.find((p) => /sonos/i.test(p.entity) && sv(p.entity));
    if (sonosPlayer) return sonosPlayer.entity;
    return (entity && sv(entity) ? entity : players.find((p) => sv(p.entity))?.entity ?? entity);
  })();
  // Sonos plays only via the group coordinator (group_members[0]); sending
  // play_media to a grouped member is rejected, so favourites must target it.
  $: playTarget = (() => {
    const src = favouritesOwner || volumeEntity || entity;
    const gm = src ? $entities[src]?.attributes.group_members : undefined;
    return Array.isArray(gm) && gm.length ? gm[0] : src;
  })();
  // Shuffle targets the now-playing entity's group coordinator (Sonos applies
  // shuffle to the live queue on the coordinator). SHUFFLE_SET is feature bit 5
  // (value 32); show the control only when the player supports it.
  $: shuffleTarget = (() => {
    const gm = entity ? $entities[entity]?.attributes.group_members : undefined;
    return Array.isArray(gm) && gm.length ? gm[0] : entity;
  })();
  $: canShuffle = shuffleTarget
    ? (($entities[shuffleTarget]?.attributes.supported_features ?? 0) & 32) !== 0
    : false;
  $: shuffled = !!(shuffleTarget && $entities[shuffleTarget]?.attributes.shuffle);

  // --- Plex track rating (thumbs up/down) ---
  // Resolve the now-playing track's Plex rating when the track changes; only
  // when the Plex proxy is enabled and something is actually playing. The look-up
  // is keyed on content id + title so it re-runs once per track, not per render.
  let track: TrackRating | null = null;
  let resolving = false;
  let busy = false;
  let rateToast = '';
  let rateTimer: ReturnType<typeof setTimeout>;
  let _ratingKey = '';
  $: np = {
    title: attrs.media_title as string | undefined,
    artist: attrs.media_artist as string | undefined,
    album: attrs.media_album_name as string | undefined,
    contentId: attrs.media_content_id as string | undefined
  };
  $: ratable = $plexEnabled && !idle && !!attrs.media_title;
  $: {
    const key = ratable ? `${np.contentId ?? ''}|${np.title ?? ''}` : '';
    if (key !== _ratingKey) {
      _ratingKey = key;
      track = null; // clear the highlight at once; keep the control visible via `resolving`
      if (ratable) {
        resolving = true;
        void resolveWithRetry(key, { ...np });
      } else {
        resolving = false;
      }
    }
  }
  $: thumb = thumbState(track?.userRating);

  // The Plex session for a freshly-started track registers a moment after
  // playback begins, so a single lookup often misses (then the thumbs only
  // appear after a refresh). Retry with backoff, bailing out if the track
  // changes underneath us.
  async function resolveWithRetry(key: string, snap: typeof np) {
    const delays = [0, 1000, 2000, 4000];
    for (const d of delays) {
      if (d) await new Promise((r) => setTimeout(r, d));
      if (_ratingKey !== key) return; // track changed; abandon this resolve
      const t = await resolveTrack(snap).catch(() => null);
      if (_ratingKey !== key) return;
      if (t) {
        track = t;
        resolving = false;
        return;
      }
    }
    resolving = false; // gave up: no rateable target for this track
  }

  function flashRate(msg: string) {
    rateToast = msg;
    clearTimeout(rateTimer);
    rateTimer = setTimeout(() => (rateToast = ''), 3500);
  }

  async function rate(action: 'up' | 'down') {
    if (!track || busy) return;
    busy = true;
    const target = nextRating(track.userRating, action);
    const prev = track.userRating;
    track = { ...track, userRating: target }; // optimistic
    try {
      // setRating writes then reads back from Plex; `actual` is what Plex holds.
      const actual = await setRating(track.ratingKey, target);
      track = { ...track, userRating: actual };
      if (actual === target) {
        flashRate(target === 0 ? 'Rating cleared' : target >= 6 ? 'Rated up (5★)' : 'Rated down (1★)');
      } else {
        flashRate(`Plex didn't save it (key ${track.ratingKey})`);
      }
    } catch (e) {
      track = { ...track, userRating: prev }; // revert on failure
      flashRate(`Rating failed: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  // --- Live track progress ---
  // HA samples media_position at media_position_updated_at; tick a 1s clock so
  // the bar advances between state pushes while playing.
  let nowTs = Date.now();
  let tick: ReturnType<typeof setInterval>;
  onMount(() => { tick = setInterval(() => (nowTs = Date.now()), 1000); });
  onDestroy(() => clearInterval(tick));
  $: duration = Number(attrs.media_duration) || 0;
  $: hasProgress = !idle && duration > 0;
  $: position = hasProgress
    ? livePosition({
        position: Number(attrs.media_position) || 0,
        updatedAt: attrs.media_position_updated_at ? Date.parse(attrs.media_position_updated_at) : 0,
        duration,
        playing,
        now: nowTs
      })
    : 0;
  $: pct = progressPct(position, duration);

  $: ve = volumeEntity ? $entities[volumeEntity] : undefined;
  $: volIdle = !ve || ve.state === 'off' || ve.state === 'unavailable';
  $: muted = ve?.attributes.is_volume_muted === true;
  $: vol = Math.round((ve?.attributes.volume_level ?? 0) * 100);

  // Favourites are a Sonos feature, so only Sonos players are queried for them.
  // A Sonos is identified by the group_members attribute, which the Sonos
  // integration always sets and other players (Google/Android TV, Chromecast,
  // Apple TV) never do — so a TV with its own "Favorites" node can't hijack the
  // presets. Re-runs when the set of Sonos players changes (e.g. one becomes
  // available).
  $: sonosIds = players
    .filter((p) => Array.isArray($entities[p.entity]?.attributes.group_members))
    .map((p) => p.entity);

  // The Sonos the music browser browses and plays to. Prefer the volume-routed
  // Sonos (the room's real speaker), else the first Sonos in the room. Playback
  // must target the group coordinator (group_members[0]); play_media to a
  // grouped member is rejected — the same rule as favourites' playTarget, but
  // resolved from a guaranteed-Sonos base so it can never fall back to a TV.
  $: browseSonos =
    (volumeEntity && /sonos/i.test(volumeEntity) ? volumeEntity : undefined) ?? sonosIds[0];
  $: browseTarget = (() => {
    const gm = browseSonos ? $entities[browseSonos]?.attributes.group_members : undefined;
    return Array.isArray(gm) && gm.length ? gm[0] : browseSonos;
  })();

  let favourites: Favourite[] = [];
  let favouritesOwner = '';
  let favKey = '';
  $: {
    const key = sonosIds.join(',');
    if (key !== favKey) {
      favKey = key;
      favourites = [];
      favouritesOwner = '';
      (async () => {
        for (const id of sonosIds) {
          const f = await loadFavourites(id);
          if (f.length > 0 && favKey === key) {
            favourites = f;
            favouritesOwner = id;
            break;
          }
        }
      })();
    }
  }
</script>

<div class="card wide media-card" class:has-art={!idle && attrs.entity_picture}>
  {#if !idle && attrs.entity_picture}
    <div class="art-bg" style="background-image:url({attrs.entity_picture})"></div>
  {/if}
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.media}</span>Media</div>
    <div class="head-right">
      {#if sonosIds.length}
        <button class="guide-btn" on:click={() => (showBrowser = true)}>
          <span class="icon">{@html icons.library}</span>Music
        </button>
      {/if}
      {#if $embyEnabled && appleTv}
        <button class="guide-btn" on:click={() => (showGuide = true)}>
          <span class="icon">{@html icons.tv}</span>TV Guide
        </button>
      {/if}
      <div class="status">{idle ? 'idle' : playing ? 'playing' : 'paused'}</div>
    </div>
  </div>

  {#if players.length > 1}
    <div class="chips">
      {#each players as p, i (p.entity)}
        <button
          class="chip {i === selectedIdx ? 'active' : ''}"
          on:click={() => {
            selectedIdx = i;
            userPicked = true;
          }}
        >
          {['playing','paused'].includes($entities[p.entity]?.state ?? '') ? '● ' : ''}{p.name}
        </button>
      {/each}
    </div>
  {/if}

  <div class="media-now">
    <div class="art" style={attrs.entity_picture ? `background-image:url(${attrs.entity_picture})` : ''}>
      {attrs.entity_picture ? '' : '🎵'}
    </div>
    <div class="media-meta">
      <div class="t">{idle ? 'Nothing playing' : attrs.media_title ?? attrs.app_name ?? (e?.state === 'standby' ? 'Standby' : 'Unknown')}</div>
      <div class="a">{idle ? '' : attrs.media_artist ?? attrs.media_series_title ?? ''}</div>
      {#if attrs.source}<div class="src">{attrs.source}</div>{/if}
    </div>
    {#if ratable && (resolving || track)}
      <div class="rate">
        <button
          class="rate-btn up"
          class:on={thumb === 'up'}
          disabled={!track || busy}
          aria-label="Thumbs up"
          aria-pressed={thumb === 'up'}
          title="Rate up in Plex"
          on:click={() => rate('up')}
        >
          {@html icons.thumb}
        </button>
        <button
          class="rate-btn down"
          class:on={thumb === 'down'}
          disabled={!track || busy}
          aria-label="Thumbs down"
          aria-pressed={thumb === 'down'}
          title="Rate down in Plex"
          on:click={() => rate('down')}
        >
          {@html icons.thumb}
        </button>
      </div>
    {/if}
  </div>

  {#if rateToast}<div class="rate-toast">{rateToast}</div>{/if}

  {#if hasProgress}
    <div class="progress">
      <span class="time">{formatTime(position)}</span>
      <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
      <span class="time">{formatTime(duration)}</span>
    </div>
  {/if}

  <div class="transport">
    {#if canShuffle}
      <button
        class="t-btn shuffle"
        class:on={shuffled}
        disabled={idle}
        aria-label="Shuffle"
        aria-pressed={shuffled}
        title={shuffled ? 'Shuffle on' : 'Shuffle off'}
        on:click={() => toggleShuffle(shuffleTarget, !shuffled)}
      >
        {@html icons.shuffle}
      </button>
    {/if}
    <button class="t-btn" disabled={idle} aria-label="Previous" on:click={() => mediaPrevious(entity)}>
      {@html icons.prev}
    </button>
    <button class="t-btn play" disabled={idle} aria-label="Play/Pause" on:click={() => mediaPlayPause(entity)}>
      {@html playing ? icons.pause : icons.play}
    </button>
    <button class="t-btn" disabled={idle} aria-label="Next" on:click={() => mediaNext(entity)}>
      {@html icons.next}
    </button>
  </div>

  <div class="vol-row">
    <button
      class="t-btn"
      aria-label="Mute"
      aria-pressed={muted}
      disabled={volIdle}
      on:click={() => mediaMute(volumeEntity, !muted)}
    >
      {@html muted ? icons.volMuted : icons.vol}
    </button>
    <input
      type="range"
      class="blue"
      min="0"
      max="100"
      value={vol}
      disabled={volIdle}
      aria-label="Volume"
      on:input={(ev) => setVolume(volumeEntity, +ev.currentTarget.value)}
    />
  </div>

  {#if favourites.length && entity === favouritesOwner}
    <div class="presets">
      {#each favourites as f (f.contentId)}
        <button
          class="preset"
          title={f.title}
          on:click={() => playFavourite(playTarget, f.contentId, f.contentType)}
        >
          {#if f.thumbnail}<img src={f.thumbnail} alt="" />{/if}
          <span>{f.title}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if soundModes.length}
    <div class="chips">
      {#each soundModes as s (s.entity)}
        <button
          class="chip {$entities[s.entity]?.state === 'on' ? 'active' : ''}"
          on:click={() => toggleSoundMode(s.entity)}
        >
          {s.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if showGuide}
  <EpgGuide
    appleTvHint={appleTv?.name ?? ''}
    appleTvEntity={appleTv?.entity ?? ''}
    appleTvIp={appleTv?.ip ?? ''}
    {embySource}
    onClose={() => (showGuide = false)}
  />
{/if}

{#if showBrowser && browseSonos}
  <MediaBrowser
    entity={browseSonos}
    playTarget={browseTarget ?? browseSonos}
    onClose={() => (showBrowser = false)}
  />
{/if}

<style>
  /* Keep prev/play/next centred while the shuffle toggle sits on the far left. */
  .transport {
    position: relative;
  }
  .t-btn.shuffle {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
  }
  .t-btn.shuffle :global(svg) {
    width: 22px;
    height: 22px;
  }
  .t-btn.on {
    color: var(--accent);
  }
  /* Plex thumbs up/down sit at the right of the now-playing row. */
  .media-meta {
    flex: 1 1 auto;
  }
  .rate {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .rate-btn {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--muted);
    cursor: pointer;
  }
  .rate-btn :global(svg) {
    width: 20px;
    height: 20px;
  }
  .rate-btn.down :global(svg) {
    transform: rotate(180deg);
  }
  .rate-btn.up.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .rate-btn.down.on {
    color: var(--red);
    border-color: var(--red);
  }
  .rate-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* Track progress: elapsed | bar | duration. */
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .progress .time {
    font-size: 0.72rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    flex: none;
    min-width: 2.4em;
    text-align: center;
  }
  .progress .bar {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: var(--panel-3, rgba(255, 255, 255, 0.12));
    overflow: hidden;
  }
  .progress .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--blue, #5aa0ff);
  }
  .rate-toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 2;
    background: var(--panel-3);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 0.82rem;
    white-space: nowrap;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .guide-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
    color: inherit;
    font-size: 0.82rem;
    font-weight: 560;
    cursor: pointer;
  }
  .guide-btn:active {
    background: rgba(255, 255, 255, 0.14);
  }
  .guide-btn .icon {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
  }
  .guide-btn .icon :global(svg) {
    width: 18px;
    height: 18px;
  }
  /* Now-playing artwork as a soft backdrop; content sits above it. */
  .media-card {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }
  .media-card.has-art > :global(*:not(.art-bg)) {
    position: relative;
    z-index: 1;
  }
  .art-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-size: cover;
    background-position: center;
    filter: blur(18px) brightness(0.45) saturate(1.1);
    transform: scale(1.2);
  }
  /* Saved-station presets: a horizontally scrollable row of tap targets. */
  .presets {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .presets::-webkit-scrollbar {
    display: none;
  }
  .preset {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    max-width: 8rem;
    padding: 3px 8px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .preset:active {
    background: rgba(255, 255, 255, 0.14);
  }
  .preset img {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    flex: 0 0 auto;
  }
  .preset span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
