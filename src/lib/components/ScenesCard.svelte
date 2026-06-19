<script lang="ts">
  import { activeScene } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { activateScene } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let roomId: string;
  export let scenes: NamedEntity[];
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.scene}</span>Scenes</div>
  </div>
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
</div>
