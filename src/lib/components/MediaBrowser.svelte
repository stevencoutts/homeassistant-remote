<script lang="ts">
  import { onMount } from 'svelte';
  import { icons } from '$lib/icons';
  import { findMusicRoot, browseNode, primaryAction, type BrowseItem, type BrowseNode } from '$lib/ha/browse';
  import { playMediaResult, setShuffle } from '$lib/services';

  // The media_player to browse (the Sonos source).
  export let entity: string;
  // Where play_media is sent — the Sonos group coordinator (resolved by the card).
  export let playTarget: string;
  export let onClose: () => void = () => {};

  // Navigation stack of nodes we've descended into. The last entry is current;
  // an empty stack means the resolved music root.
  let stack: BrowseItem[] = [];
  let current: BrowseNode | null = null;
  let root: BrowseItem | null = null;
  let loading = true;
  let error = '';
  let toast = '';
  let toastTimer: ReturnType<typeof setTimeout>;
  // When on, anything played (a track, album or whole playlist) is shuffled.
  let shuffle = false;
  let busy = false;

  onMount(async () => {
    try {
      root = await findMusicRoot(entity);
      await load();
    } catch (e) {
      error = `Could not open the library: ${(e as Error).message}`;
      loading = false;
    }
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const node = stack.length ? stack[stack.length - 1] : root ?? undefined;
      current = await browseNode(entity, node);
    } catch (e) {
      error = `Could not load this folder: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  async function open(item: BrowseItem) {
    if (primaryAction(item) === 'play') {
      await play(item);
      return;
    }
    stack = [...stack, item];
    await load();
  }

  // Secondary affordance for mixed nodes (albums/playlists): expand instead of play.
  async function expand(item: BrowseItem) {
    stack = [...stack, item];
    await load();
  }

  async function back() {
    if (!stack.length) return;
    stack = stack.slice(0, -1);
    await load();
  }

  async function play(item: BrowseItem) {
    if (busy) return;
    busy = true;
    flash(`${shuffle ? 'Shuffling' : 'Playing'} ${item.title}…`);
    try {
      await playMediaResult(playTarget, item.contentId, item.contentType);
      // Apply shuffle after the queue has loaded; Sonos shuffles the live queue.
      await new Promise((r) => setTimeout(r, 300));
      await setShuffle(playTarget, shuffle);
      flash(`${shuffle ? 'Shuffling' : 'Playing'} ${item.title}`);
      setTimeout(onClose, 700);
    } catch (e) {
      // Surface the real HA error instead of silently failing.
      flash(`Could not play ${item.title}: ${(e as Error).message}`);
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

  $: title = stack.length ? stack[stack.length - 1].title : current?.title ?? 'Music';
  // The container we are inside (a playlist/album) when it is itself playable —
  // drives the "Play all" action so a whole playlist plays in one tap.
  $: container = stack.length ? stack[stack.length - 1] : null;
  $: containerPlayable = !!container?.canPlay;
</script>

<svelte:window on:keydown={onKey} />

<div class="mb" role="dialog" aria-label="Music browser">
  <header class="mb-head">
    <div class="mb-title">
      {#if stack.length}
        <button class="mb-icon-btn" aria-label="Back" on:click={back}>{@html icons.back}</button>
      {:else}
        <span class="icon">{@html icons.library}</span>
      {/if}
      <span class="mb-title-text">{title}</span>
    </div>
    <div class="mb-actions">
      {#if containerPlayable && container}
        <button class="mb-pill" on:click={() => play(container)}>
          <span class="icon">{@html icons.play}</span>Play all
        </button>
      {/if}
      <button
        class="mb-icon-btn"
        class:on={shuffle}
        aria-label="Shuffle"
        aria-pressed={shuffle}
        title={shuffle ? 'Shuffle on' : 'Shuffle off'}
        on:click={() => (shuffle = !shuffle)}
      >
        {@html icons.shuffle}
      </button>
      <button class="mb-icon-btn" aria-label="Close browser" on:click={onClose}>{@html icons.close}</button>
    </div>
  </header>

  {#if loading}
    <div class="mb-state">Loading…</div>
  {:else if error}
    <div class="mb-state">{error}</div>
  {:else if !current || current.items.length === 0}
    <div class="mb-state">Nothing here.</div>
  {:else}
    <div class="mb-grid">
      {#each current.items as item (item.contentId)}
        <div class="mb-cell">
          <button class="mb-tile" title={item.title} on:click={() => open(item)}>
            <div class="mb-art" class:folder={!item.thumbnail}>
              {#if item.thumbnail}
                <img src={item.thumbnail} alt="" loading="lazy" />
              {:else}
                <span class="icon">{@html item.canExpand ? icons.folder : icons.media}</span>
              {/if}
              {#if item.canPlay}
                <span class="mb-play" aria-hidden="true">{@html icons.play}</span>
              {/if}
            </div>
            <span class="mb-name">{item.title}</span>
          </button>
          {#if item.canPlay && item.canExpand}
            <button class="mb-expand" aria-label={`Open ${item.title}`} on:click|stopPropagation={() => expand(item)}>
              {@html icons.back}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if toast}<div class="mb-toast">{toast}</div>{/if}
</div>

<style>
  .mb {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .mb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .mb-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 620;
    font-size: 1.1rem;
    min-width: 0;
  }
  .mb-title .icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
  }
  .mb-title .icon :global(svg) {
    width: 22px;
    height: 22px;
  }
  .mb-title-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mb-icon-btn {
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
  .mb-icon-btn :global(svg) {
    width: 22px;
    height: 22px;
  }
  .mb-icon-btn.on {
    background: var(--accent, #ffb648);
    border-color: var(--accent, #ffb648);
    color: #14110a;
  }
  .mb-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
  .mb-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    background: var(--accent, #ffb648);
    border: none;
    color: #14110a;
    font-size: 0.9rem;
    font-weight: 620;
    cursor: pointer;
  }
  .mb-pill:active {
    transform: scale(0.98);
  }
  .mb-pill .icon {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
  }
  .mb-pill .icon :global(svg) {
    width: 16px;
    height: 16px;
  }
  .mb-state {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .mb-grid {
    flex: 1;
    overflow: auto;
    scrollbar-width: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 14px;
    padding: 16px;
    align-content: start;
  }
  .mb-grid::-webkit-scrollbar {
    display: none;
  }
  .mb-cell {
    position: relative;
    min-width: 0;
  }
  .mb-tile {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .mb-tile:active {
    transform: scale(0.99);
  }
  .mb-art {
    position: relative;
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    overflow: hidden;
    background: var(--panel-2);
    display: grid;
    place-items: center;
  }
  .mb-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .mb-art .icon {
    width: 40%;
    height: 40%;
    color: var(--muted);
  }
  .mb-art .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .mb-play {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .mb-play :global(svg) {
    width: 16px;
    height: 16px;
  }
  .mb-name {
    font-size: 0.85rem;
    font-weight: 560;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  /* Secondary "open" affordance for nodes that both play and expand. */
  .mb-expand {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    color: #fff;
    cursor: pointer;
    transform: scaleX(-1);
  }
  .mb-expand :global(svg) {
    width: 18px;
    height: 18px;
  }
  .mb-toast {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    background: var(--panel-3);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 0.9rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
</style>
