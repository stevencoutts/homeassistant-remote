<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { toggleLight, setLightBrightness, toggleSwitch } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  // One card holding two independent drill-in groups: lights (with brightness)
  // and power switches. Neither group has a master toggle; you expand a group
  // and toggle items individually.
  export let lights: NamedEntity[] = [];
  export let power: NamedEntity[] = [];

  let lightsOpen = false;
  let powerOpen = false;

  $: lightsOn = lights.filter((l) => $entities[l.entity]?.state === 'on').length;
  $: powerOn = power.filter((p) => $entities[p.entity]?.state === 'on').length;
  const pct = (b: number | undefined) => (b ? Math.round((b / 255) * 100) : 0);
</script>

<div class="card">
  {#if lights.length}
    <div class="group" class:divider={power.length}>
      <button
        class="head-main"
        aria-expanded={lightsOpen}
        on:click={() => (lightsOpen = !lightsOpen)}
      >
        <span class="label"><span class="icon">{@html icons.bulb}</span>Lights</span>
        <span class="head-meta">
          <span class="status">{lightsOn} on</span>
          <span class="chev {lightsOpen ? 'open' : ''}">{@html icons.chevron}</span>
        </span>
      </button>

      {#if lightsOpen}
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
                  role="switch"
                  aria-checked={on}
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
      {/if}
    </div>
  {/if}

  {#if power.length}
    <div class="group">
      <button
        class="head-main"
        aria-expanded={powerOpen}
        on:click={() => (powerOpen = !powerOpen)}
      >
        <span class="label"><span class="icon">{@html icons.power}</span>Power</span>
        <span class="head-meta">
          <span class="status">{powerOn} on</span>
          <span class="chev {powerOpen ? 'open' : ''}">{@html icons.chevron}</span>
        </span>
      </button>

      {#if powerOpen}
        {#each power as p (p.entity)}
          {@const e = $entities[p.entity]}
          {@const on = e?.state === 'on'}
          <div class="light-row">
            <div class="top">
              <span class="nm">{p.name}</span>
              <div style="display:flex;align-items:center;gap:12px;">
                <span class="pct">{on ? 'on' : 'off'}</span>
                <button
                  class="switch {on ? 'on' : ''}"
                  role="switch"
                  aria-checked={on}
                  aria-label="Toggle {p.name}"
                  on:click={() => toggleSwitch(p.entity)}
                ></button>
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Separator between the lights group and the power group. */
  .group.divider {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
</style>
