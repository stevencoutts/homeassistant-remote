<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { setCoverPosition, openCover, closeCover, stopCover } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let cover: NamedEntity;

  $: e = $entities[cover.entity];
  // Covers that only report open/closed have no current_position: hide the slider.
  $: pos = e?.attributes.current_position as number | undefined;
  $: hasPosition = pos != null;
  $: shown = hasPosition ? (pos as number) : e?.state === 'open' ? 100 : 0;
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.blind}</span>{cover.name}</div>
    <div class="status">{hasPosition ? `${pos}% open` : e?.state ?? ''}</div>
  </div>

  <div class="cover-vis">
    <div class="blind-frame">
      <div class="blind-slats" style="height:{100 - shown}%"></div>
    </div>
    <div style="flex:1;">
      {#if hasPosition}
        <input
          type="range"
          class="blue"
          min="0"
          max="100"
          value={pos}
          aria-label="{cover.name} position"
          on:input={(ev) => setCoverPosition(cover.entity, +ev.currentTarget.value)}
        />
      {/if}
      <div class="cover-btns" style={hasPosition ? 'margin-top:12px;' : ''}>
        <button class="round-btn" title="Open" aria-label="Open" on:click={() => openCover(cover.entity)}>▲</button>
        <button class="round-btn" title="Stop" aria-label="Stop" on:click={() => stopCover(cover.entity)}>■</button>
        <button class="round-btn" title="Close" aria-label="Close" on:click={() => closeCover(cover.entity)}>▼</button>
      </div>
    </div>
  </div>
</div>
