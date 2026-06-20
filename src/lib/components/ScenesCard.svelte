<script lang="ts">
  import { activeScene } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { activateScene } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let roomId: string;
  export let scenes: NamedEntity[];

  let expanded = false;
  $: activeName = scenes.find((s) => s.entity === $activeScene[roomId])?.name ?? '—';
</script>

<div class="card">
  <div class="card-head">
    <button class="head-main" aria-expanded={expanded} on:click={() => (expanded = !expanded)}>
      <span class="label"><span class="icon">{@html icons.scene}</span>Scenes</span>
      <span class="head-meta">
        <span class="status">{activeName}</span>
        <span class="chev {expanded ? 'open' : ''}">{@html icons.chevron}</span>
      </span>
    </button>
  </div>

  {#if expanded}
    <div class="chips">
      {#each scenes as s (s.entity)}
        <button
          class="chip {$activeScene[roomId] === s.entity ? 'active' : ''}"
          on:click={() => activateScene(roomId, s.entity)}
        >
          {s.name}
        </button>
      {/each}
    </div>
  {/if}
</div>
