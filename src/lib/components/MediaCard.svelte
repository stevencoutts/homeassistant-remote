<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { mediaPlayPause, mediaPrevious, mediaNext, setVolume } from '$lib/services';

  export let entity: string;

  $: e = $entities[entity];
  $: attrs = e?.attributes ?? {};
  // Gracefully handle off/unavailable players: idle state, transport disabled.
  $: idle = !e || e.state === 'off' || e.state === 'unavailable' || e.state === 'standby';
  $: playing = e?.state === 'playing';
  $: vol = Math.round((attrs.volume_level ?? 0) * 100);
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.media}</span>Media</div>
    <div class="status">{idle ? 'idle' : playing ? 'playing' : 'paused'}</div>
  </div>

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
    {@html icons.vol}
    <input
      type="range"
      class="blue"
      min="0"
      max="100"
      value={vol}
      disabled={idle}
      aria-label="Volume"
      on:input={(ev) => setVolume(entity, +ev.currentTarget.value)}
    />
  </div>
</div>
