<script lang="ts">
  import { currentRoomId } from '$lib/stores';
  import { icons } from '$lib/icons';
  import type { Room } from '$lib/types';

  export let rooms: Room[];
</script>

<nav class="roomnav">
  {#each rooms as r (r.id)}
    <button
      class="roomtab {$currentRoomId === r.id ? 'active' : ''}"
      on:click={() => currentRoomId.set(r.id)}
    >
      {@html icons[r.icon] ?? icons.sofa}
      <span>{r.name.split(' ')[0]}</span>
    </button>
  {/each}
</nav>
