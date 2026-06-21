<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import {
    mediaPlayPause,
    mediaPrevious,
    mediaNext,
    setVolume,
    mediaMute,
    toggleSoundMode,
    playFavourite
  } from '$lib/services';
  import { loadFavourites, type Favourite } from '$lib/ha/favourites';
  import type { NamedEntity } from '$lib/types';

  export let players: NamedEntity[];
  export let soundModes: NamedEntity[] = [];

  let selectedIdx = 0;
  let userPicked = false;

  // Until the user picks, show the actual source (e.g. Apple TV showing
  // "BBC 1") rather than the speaker relaying it (e.g. the Beam showing
  // "TV audio"). When audio is flowing, prefer a non-Sonos player that has a
  // media_title — the source often reports state 'on'/'paused' while only the
  // Beam reports 'playing', so we don't require the source's own state.
  $: if (!userPicked) {
    const anyPlaying = players.some((p) => $entities[p.entity]?.state === 'playing');
    let i = anyPlaying
      ? players.findIndex(
          (p) => $entities[p.entity]?.attributes.media_title && !/sonos/i.test(p.entity)
        )
      : -1;
    if (i < 0) i = players.findIndex((p) => $entities[p.entity]?.state === 'playing');
    selectedIdx = i >= 0 ? i : 0;
  }
  $: if (selectedIdx >= players.length) selectedIdx = 0;

  $: entity = players[selectedIdx]?.entity;
  $: e = entity ? $entities[entity] : undefined;
  $: attrs = e?.attributes ?? {};
  $: idle = !e || e.state === 'off' || e.state === 'unavailable' || e.state === 'standby';
  $: playing = e?.state === 'playing';
  // Volume/mute target the room's actual speaker: prefer a volume-capable Sonos,
  // else any volume-capable player, else the selected one. (VOLUME_SET = bit 4.)
  $: volumeEntity = (() => {
    const sv = (id: string) => (($entities[id]?.attributes.supported_features ?? 0) & 4) !== 0;
    return (
      players.find((p) => /sonos/i.test(p.entity) && sv(p.entity))?.entity ??
      players.find((p) => sv(p.entity))?.entity ??
      entity
    );
  })();
  $: ve = volumeEntity ? $entities[volumeEntity] : undefined;
  $: volIdle = !ve || ve.state === 'off' || ve.state === 'unavailable';
  $: muted = ve?.attributes.is_volume_muted === true;
  $: vol = Math.round((ve?.attributes.volume_level ?? 0) * 100);

  // Sonos favourites (saved radio stations) for the speaker, loaded once per entity.
  let favourites: Favourite[] = [];
  let favEntity = '';
  $: if (volumeEntity && volumeEntity !== favEntity) {
    favEntity = volumeEntity;
    favourites = [];
    loadFavourites(volumeEntity).then((f) => {
      if (favEntity === volumeEntity) favourites = f;
    });
  }
</script>

<div class="card wide media-card" class:has-art={!idle && attrs.entity_picture}>
  {#if !idle && attrs.entity_picture}
    <div class="art-bg" style="background-image:url({attrs.entity_picture})"></div>
  {/if}
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.media}</span>Media</div>
    <div class="status">{idle ? 'idle' : playing ? 'playing' : 'paused'}</div>
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
          {$entities[p.entity]?.state === 'playing' ? '● ' : ''}{p.name}
        </button>
      {/each}
    </div>
  {/if}

  <div class="media-now">
    <div class="art" style={attrs.entity_picture ? `background-image:url(${attrs.entity_picture})` : ''}>
      {attrs.entity_picture ? '' : '🎵'}
    </div>
    <div class="media-meta">
      <div class="t">{idle ? 'Nothing playing' : attrs.media_title ?? 'Unknown'}</div>
      <div class="a">{idle ? '' : attrs.media_artist ?? ''}</div>
      {#if attrs.source}<div class="src">{attrs.source}</div>{/if}
    </div>
  </div>

  <div class="transport">
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

  {#if favourites.length && entity === volumeEntity}
    <div class="presets">
      {#each favourites as f (f.contentId)}
        <button
          class="preset"
          title={f.title}
          on:click={() => playFavourite(volumeEntity, f.contentId, f.contentType)}
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

<style>
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
    gap: 8px;
    min-height: 44px;
    max-width: 11rem;
    padding: 6px 12px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .preset:active {
    background: rgba(255, 255, 255, 0.14);
  }
  .preset img {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: cover;
    flex: 0 0 auto;
  }
  .preset span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
