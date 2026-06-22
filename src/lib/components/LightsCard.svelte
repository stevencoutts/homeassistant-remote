<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { toggleLight, setLightBrightness, toggleSwitch } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let lights: NamedEntity[] = [];
  export let power: NamedEntity[] = [];

  let open = false;

  $: lightsOn = lights.filter((l) => $entities[l.entity]?.state === 'on').length;
  $: powerOn = power.filter((p) => $entities[p.entity]?.state === 'on').length;
  $: totalOn = lightsOn + powerOn;
  $: total = lights.length + power.length;

  const pct = (b: number | undefined) => (b ? Math.round((b / 255) * 100) : 0);
  const isLight = (entity: string) => entity.startsWith('light.');
  const togglePower = (entity: string) =>
    isLight(entity) ? toggleLight(entity) : toggleSwitch(entity);
</script>

<div class="card">
  <div class="group">
    <button class="head-main" aria-expanded={open} on:click={() => (open = !open)}>
      <span class="label">
        {#if lights.length && power.length}
          <span class="icon">{@html icons.bulb}</span>Lights &amp; Power
        {:else if power.length}
          <span class="icon">{@html icons.power}</span>Power
        {:else}
          <span class="icon">{@html icons.bulb}</span>Lights
        {/if}
      </span>
      <span class="head-meta">
        <span class="status">{totalOn} on</span>
        <span class="chev {open ? 'open' : ''}">{@html icons.chevron}</span>
      </span>
    </button>

    {#if open}
      {#each lights as l (l.entity)}
        {@const e = $entities[l.entity]}
        {@const on = e?.state === 'on'}
        {@const level = pct(e?.attributes.brightness)}
        <div class="item">
          <div class="top">
            <span class="nm">{l.name}</span>
            <div class="controls">
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

      {#if lights.length && power.length}
        <div class="section-divider"></div>
      {/if}

      {#each power as p (p.entity)}
        {@const e = $entities[p.entity]}
        {@const on = e?.state === 'on'}
        <div class="item">
          <div class="top">
            <span class="nm">{p.name}</span>
            <div class="controls">
              <span class="pct">{on ? 'on' : 'off'}</span>
              <button
                class="switch {on ? 'on' : ''}"
                role="switch"
                aria-checked={on}
                aria-label="Toggle {p.name}"
                on:click={() => togglePower(p.entity)}
              ></button>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .section-divider {
    border-top: 1px solid var(--line);
    margin: 2px 0;
  }
</style>
