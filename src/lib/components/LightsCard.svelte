<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { toggleLight, setLightBrightness } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let lights: NamedEntity[];

  $: onCount = lights.filter((l) => $entities[l.entity]?.state === 'on').length;
  const pct = (b: number | undefined) => (b ? Math.round((b / 255) * 100) : 0);
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.bulb}</span>Lights</div>
    <div class="status">{onCount} on</div>
  </div>

  {#each lights as l (l.entity)}
    {@const e = $entities[l.entity]}
    {@const on = e?.state === 'on'}
    {@const level = pct(e?.attributes.brightness)}
    <div class="light-row">
      <div class="top">
        <span class="nm">{l.name}</span>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="pct">{on ? level + '%' : 'off'}</span>
          <button
            class="switch warm {on ? 'on' : ''}"
            aria-label="Toggle {l.name}"
            on:click={() => toggleLight(l.entity)}
          ></button>
        </div>
      </div>
      <input
        type="range"
        min="1"
        max="100"
        value={level}
        disabled={!on}
        aria-label="{l.name} brightness"
        on:input={(ev) => setLightBrightness(l.entity, +ev.currentTarget.value)}
      />
    </div>
  {/each}
</div>
