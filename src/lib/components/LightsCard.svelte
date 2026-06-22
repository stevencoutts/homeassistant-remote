<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { toggleLight, setLightBrightness, toggleSwitch } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let lights: NamedEntity[] = [];
  export let power: NamedEntity[] = [];

  let lightsOpen = false;
  let powerOpen = false;

  $: lightsOn = lights.filter((l) => $entities[l.entity]?.state === 'on').length;
  $: powerOn  = power.filter((p) => $entities[p.entity]?.state === 'on').length;

  const pct = (b: number | undefined) => (b ? Math.round((b / 255) * 100) : 0);
  const togglePower = (entity: string) =>
    entity.startsWith('light.') ? toggleLight(entity) : toggleSwitch(entity);
</script>

<div class="card lp-card">
  <!-- When only one type exists, show it full-width; otherwise two columns. -->
  {#if lights.length && power.length}
    <div class="cols">
      <!-- Left: Lights -->
      <div class="col">
        <button class="col-head" aria-expanded={lightsOpen} on:click={() => (lightsOpen = !lightsOpen)}>
          <span class="col-label"><span class="icon">{@html icons.bulb}</span>Lights</span>
          <span class="col-meta">
            <span class="status">{lightsOn} on</span>
            <span class="chev {lightsOpen ? 'open' : ''}">{@html icons.chevron}</span>
          </span>
        </button>
        {#if lightsOpen}
          <div class="col-items">
            {#each lights as l (l.entity)}
              {@const e = $entities[l.entity]}
              {@const on = e?.state === 'on'}
              {@const level = pct(e?.attributes.brightness)}
              <div class="item">
                <div class="item-top">
                  <span class="nm">{l.name}</span>
                  <div class="item-right">
                    <span class="pct">{on ? level + '%' : 'off'}</span>
                    <button class="switch warm {on ? 'on' : ''}" role="switch" aria-checked={on}
                      aria-label="Toggle {l.name}" on:click={() => toggleLight(l.entity)}></button>
                  </div>
                </div>
                <input type="range" min="1" max="100" value={level} disabled={!on}
                  aria-label="{l.name} brightness"
                  on:input={(ev) => setLightBrightness(l.entity, +ev.currentTarget.value)} />
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="col-divider"></div>

      <!-- Right: Power -->
      <div class="col">
        <button class="col-head" aria-expanded={powerOpen} on:click={() => (powerOpen = !powerOpen)}>
          <span class="col-label"><span class="icon">{@html icons.power}</span>Power</span>
          <span class="col-meta">
            <span class="status">{powerOn} on</span>
            <span class="chev {powerOpen ? 'open' : ''}">{@html icons.chevron}</span>
          </span>
        </button>
        {#if powerOpen}
          <div class="col-items">
            {#each power as p (p.entity)}
              {@const e = $entities[p.entity]}
              {@const on = e?.state === 'on'}
              <div class="item">
                <div class="item-top">
                  <span class="nm">{p.name}</span>
                  <div class="item-right">
                    <span class="pct">{on ? 'on' : 'off'}</span>
                    <button class="switch {on ? 'on' : ''}" role="switch" aria-checked={on}
                      aria-label="Toggle {p.name}" on:click={() => togglePower(p.entity)}></button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

  {:else if lights.length}
    <!-- Lights only — full width -->
    <button class="head-main" aria-expanded={lightsOpen} on:click={() => (lightsOpen = !lightsOpen)}>
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
        <div class="item">
          <div class="item-top">
            <span class="nm">{l.name}</span>
            <div class="item-right">
              <span class="pct">{on ? level + '%' : 'off'}</span>
              <button class="switch warm {on ? 'on' : ''}" role="switch" aria-checked={on}
                aria-label="Toggle {l.name}" on:click={() => toggleLight(l.entity)}></button>
            </div>
          </div>
          <input type="range" min="1" max="100" value={level} disabled={!on}
            aria-label="{l.name} brightness"
            on:input={(ev) => setLightBrightness(l.entity, +ev.currentTarget.value)} />
        </div>
      {/each}
    {/if}

  {:else}
    <!-- Power only — full width -->
    <button class="head-main" aria-expanded={powerOpen} on:click={() => (powerOpen = !powerOpen)}>
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
        <div class="item">
          <div class="item-top">
            <span class="nm">{p.name}</span>
            <div class="item-right">
              <span class="pct">{on ? 'on' : 'off'}</span>
              <button class="switch {on ? 'on' : ''}" role="switch" aria-checked={on}
                aria-label="Toggle {p.name}" on:click={() => togglePower(p.entity)}></button>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .lp-card {
    padding: 0;
    overflow: hidden;
  }
  /* Two-column layout */
  .cols {
    display: flex;
    align-items: stretch;
  }
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .col-divider {
    width: 1px;
    background: var(--line);
    flex: none;
  }
  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .col-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .col-label .icon {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    opacity: 0.8;
  }
  .col-label .icon :global(svg) { width: 18px; height: 18px; }
  .col-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .col-items {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 16px 14px;
  }
  /* Full-width fallback (single type) reuses global card head styles */
  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .item-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
</style>
