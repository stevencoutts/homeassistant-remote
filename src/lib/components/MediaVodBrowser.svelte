<script lang="ts">
  import { onMount } from 'svelte';
  import { icons } from '$lib/icons';
  import { entities } from '$lib/stores';
  import {
    getLibraries,
    getContinueWatching,
    getRecentlyAdded,
    getLibraryItems,
    getSeasons,
    getEpisodes
  } from '$lib/emby/client';
  import { createPlaybackController, type EntitySnap } from '$lib/emby/playback';
  import { mediaTurnOn, mediaSelectSource } from '$lib/services';
  import type { MediaItem, MediaLibrary } from '$lib/emby/types';

  // Same props as the EPG guide so the card passes identical values.
  export let appleTvHint = '';
  export let appleTvIp = '';
  export let appleTvEntity = '';
  export let embySource = 'Emby';
  export let onClose: () => void = () => {};

  // --- Device targeting (shared controller) ---
  $: nowPlayingTitle = (() => {
    if (!appleTvEntity) return undefined;
    const e = $entities[appleTvEntity];
    if (!e || e.state !== 'playing') return undefined;
    const src = String(e.attributes.source ?? '').toLowerCase();
    if (!src.includes('emby')) return undefined;
    return e.attributes.media_title as string | undefined;
  })();

  function snapshot(): EntitySnap | null {
    const e = $entities[appleTvEntity];
    if (!e) return null;
    return {
      state: e.state,
      source: String(e.attributes.source ?? ''),
      title: String(e.attributes.media_title ?? ''),
      art: String(e.attributes.entity_picture ?? '')
    };
  }

  const controller = createPlaybackController({
    appleTvHint,
    appleTvIp,
    appleTvEntity,
    flash,
    wake: () => {
      if (!appleTvEntity) return;
      mediaTurnOn(appleTvEntity);
      if (embySource) mediaSelectSource(appleTvEntity, embySource);
    },
    snapshot,
    nowPlayingTitle: () => nowPlayingTitle
  });

  // --- Navigation ---
  type Frame =
    | { type: 'library'; lib: MediaLibrary }
    | { type: 'series'; series: MediaItem }
    | { type: 'season'; series: MediaItem; season: MediaItem };

  let stack: Frame[] = [];
  $: frame = stack.length ? stack[stack.length - 1] : null;

  // Home data (loaded once).
  let libraries: MediaLibrary[] = [];
  let continueWatching: MediaItem[] = [];
  let recentlyAdded: MediaItem[] = [];
  // Current grid/list for a drilled-in frame.
  let items: MediaItem[] = [];

  let loading = true;
  let error = '';
  let toast = '';
  let toastTimer: ReturnType<typeof setTimeout>;
  // Mirrored from the controller so the header updates reactively.
  let targetName = '';

  onMount(async () => {
    // Resolve the target in the background so the header can show it.
    controller
      .ensureTarget()
      .then((t) => { if (t) targetName = t.name; })
      .catch(() => {});
    try {
      [libraries, continueWatching, recentlyAdded] = await Promise.all([
        getLibraries(),
        getContinueWatching(),
        getRecentlyAdded()
      ]);
    } catch (e) {
      error = `Could not open the library: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  });

  async function loadFrame(f: Frame) {
    loading = true;
    error = '';
    items = [];
    try {
      if (f.type === 'library') items = await getLibraryItems(f.lib.id, f.lib.kind);
      else if (f.type === 'series') items = await getSeasons(f.series.id);
      else items = await getEpisodes(f.season.seriesId ?? f.series.id, f.season.id);
    } catch (e) {
      error = `Could not load this: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  async function push(f: Frame) {
    stack = [...stack, f];
    await loadFrame(f);
  }

  async function back() {
    if (!stack.length) return;
    stack = stack.slice(0, -1);
    if (stack.length) await loadFrame(stack[stack.length - 1]);
  }

  function openLibrary(lib: MediaLibrary) {
    push({ type: 'library', lib });
  }

  async function openItem(item: MediaItem) {
    if (item.kind === 'Movie' || item.kind === 'Episode') {
      await play(item);
    } else if (item.kind === 'Series') {
      await push({ type: 'series', series: item });
    } else if (item.kind === 'Season') {
      const series = frame && frame.type === 'series' ? frame.series : item;
      await push({ type: 'season', series, season: item });
    }
  }

  function label(item: MediaItem): string {
    if (item.kind === 'Episode' && item.seriesName) {
      const s = item.parentIndexNumber ?? 1;
      const e = item.indexNumber ?? 1;
      return `${item.seriesName} S${s}E${e}`;
    }
    return item.name;
  }

  let busy = false;
  async function play(item: MediaItem) {
    if (busy) return;
    busy = true;
    flash(`Playing ${label(item)}…`);
    try {
      await controller.play(item.id, label(item));
      if (controller.target) targetName = controller.target.name;
      setTimeout(onClose, 800);
    } finally {
      busy = false;
    }
  }

  function flash(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 4000);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (stack.length) back();
      else onClose();
    }
  }

  $: title =
    frame === null
      ? 'Films & TV'
      : frame.type === 'library'
        ? frame.lib.name
        : frame.type === 'series'
          ? frame.series.name
          : `${frame.series.name} — ${frame.season.name}`;

  // Tile subtitle: year for films/series, S/E for episodes.
  function subtitle(item: MediaItem): string {
    if (item.kind === 'Episode') {
      const s = item.parentIndexNumber;
      const e = item.indexNumber;
      if (s != null && e != null) return `S${s} · E${e}`;
    }
    return item.year ? String(item.year) : '';
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="vod" role="dialog" aria-label="Films and TV browser">
  <header class="vod-head">
    <div class="vod-title">
      {#if stack.length}
        <button class="vod-icon-btn" aria-label="Back" on:click={back}>{@html icons.back}</button>
      {:else}
        <span class="icon">{@html icons.film}</span>
      {/if}
      <span class="vod-title-text">{title}</span>
      {#if targetName}<span class="vod-target">→ {targetName}</span>{/if}
    </div>
    <button class="vod-icon-btn" aria-label="Close" on:click={onClose}>{@html icons.close}</button>
  </header>

  {#if loading}
    <div class="vod-state">Loading…</div>
  {:else if error}
    <div class="vod-state">{error}</div>
  {:else if frame === null}
    <!-- Home: rows + libraries -->
    <div class="vod-scroll">
      {#if continueWatching.length}
        <section class="vod-section">
          <h2>Continue Watching</h2>
          <div class="vod-row">
            {#each continueWatching as item (item.id)}
              {@const sub = subtitle(item)}
              <button class="vod-card" title={label(item)} on:click={() => openItem(item)}>
                <div class="vod-art">
                  {#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<span class="icon ph">{@html icons.film}</span>{/if}
                  <span class="vod-playmark" aria-hidden="true">{@html icons.play}</span>
                  {#if item.progressPct != null}
                    <span class="vod-progress"><span style="width:{item.progressPct}%"></span></span>
                  {/if}
                </div>
                <span class="vod-name">{item.kind === 'Episode' ? item.seriesName ?? item.name : item.name}</span>
                {#if item.kind === 'Episode'}<span class="vod-sub">{sub} · {item.name}</span>{:else if sub}<span class="vod-sub">{sub}</span>{/if}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if recentlyAdded.length}
        <section class="vod-section">
          <h2>Recently Added</h2>
          <div class="vod-row">
            {#each recentlyAdded as item (item.id)}
              {@const sub = subtitle(item)}
              <button class="vod-card" title={item.name} on:click={() => openItem(item)}>
                <div class="vod-art">
                  {#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<span class="icon ph">{@html item.kind === 'Series' ? icons.tv : icons.film}</span>{/if}
                  {#if item.kind === 'Movie'}<span class="vod-playmark" aria-hidden="true">{@html icons.play}</span>{/if}
                </div>
                <span class="vod-name">{item.name}</span>
                {#if sub}<span class="vod-sub">{sub}</span>{/if}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if libraries.length}
        <section class="vod-section">
          <h2>Libraries</h2>
          <div class="vod-libs">
            {#each libraries as lib (lib.id)}
              <button class="vod-lib" on:click={() => openLibrary(lib)}>
                <span class="icon">{@html lib.kind === 'tvshows' ? icons.tv : icons.film}</span>
                <span>{lib.name}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if !continueWatching.length && !recentlyAdded.length && !libraries.length}
        <div class="vod-state">Nothing to show.</div>
      {/if}
    </div>
  {:else}
    <!-- Drilled-in grid / list -->
    <div class="vod-scroll">
      {#if !items.length}
        <div class="vod-state">Nothing here.</div>
      {:else}
        <div class="vod-grid">
          {#each items as item (item.id)}
            {@const sub = subtitle(item)}
            <button class="vod-card" title={label(item)} on:click={() => openItem(item)}>
              <div class="vod-art" class:wide={item.kind === 'Episode'}>
                {#if item.poster}
                  <img src={item.poster} alt="" loading="lazy" />
                {:else}
                  <span class="icon ph">{@html item.kind === 'Series' ? icons.tv : item.kind === 'Season' ? icons.folder : icons.film}</span>
                {/if}
                {#if item.kind === 'Movie' || item.kind === 'Episode'}
                  <span class="vod-playmark" aria-hidden="true">{@html icons.play}</span>
                {/if}
                {#if item.progressPct != null}
                  <span class="vod-progress"><span style="width:{item.progressPct}%"></span></span>
                {/if}
              </div>
              <span class="vod-name">{item.name}</span>
              {#if sub}<span class="vod-sub">{sub}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if toast}<div class="vod-toast">{toast}</div>{/if}
</div>

<style>
  .vod {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .vod-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .vod-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 620;
    font-size: 1.1rem;
    min-width: 0;
  }
  .vod-title .icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
  }
  .vod-title .icon :global(svg) {
    width: 22px;
    height: 22px;
  }
  .vod-title-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vod-target {
    color: var(--muted);
    font-weight: 500;
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .vod-icon-btn {
    width: 44px;
    height: 44px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
  }
  .vod-icon-btn :global(svg) {
    width: 22px;
    height: 22px;
  }
  .vod-state {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--muted);
    padding: 24px;
  }
  .vod-scroll {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px;
  }
  .vod-section {
    margin-bottom: 22px;
  }
  .vod-section h2 {
    margin: 0 0 10px;
    font-size: 0.95rem;
    font-weight: 620;
    color: var(--muted);
  }
  /* Horizontal rows for Continue Watching / Recently Added */
  .vod-row {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 4px;
  }
  .vod-row::-webkit-scrollbar {
    display: none;
  }
  .vod-row .vod-card {
    flex: 0 0 132px;
    width: 132px;
  }
  /* Grid for drilled-in libraries / seasons / episodes */
  .vod-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 16px;
  }
  .vod-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .vod-card:active {
    transform: scale(0.98);
  }
  .vod-art {
    position: relative;
    aspect-ratio: 2 / 3;
    border-radius: 12px;
    overflow: hidden;
    background: var(--panel-2);
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
  }
  .vod-art.wide {
    aspect-ratio: 16 / 9;
  }
  .vod-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .vod-art .ph :global(svg) {
    width: 34px;
    height: 34px;
    opacity: 0.5;
  }
  .vod-playmark {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .vod-playmark :global(svg) {
    width: 16px;
    height: 16px;
  }
  .vod-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
  }
  .vod-progress > span {
    display: block;
    height: 100%;
    background: var(--accent, #4aa3ff);
  }
  .vod-name {
    font-size: 0.9rem;
    font-weight: 560;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .vod-sub {
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vod-libs {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .vod-lib {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 20px;
    border-radius: 14px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 560;
    font-size: 1rem;
    cursor: pointer;
  }
  .vod-lib .icon :global(svg) {
    width: 22px;
    height: 22px;
  }
  .vod-toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 10px 18px;
    border-radius: 999px;
    font-size: 0.9rem;
    z-index: 60;
    max-width: 90vw;
    text-align: center;
  }
</style>
