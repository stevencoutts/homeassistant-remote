<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { setTemperature, setHvacMode } from '$lib/services';

  export let entity: string;

  // Only show modes the entity supports (TRV vs full thermostat).
  const MODES: [string, string][] = [
    ['heat', 'Heat'],
    ['cool', 'Cool'],
    ['auto', 'Auto'],
    ['off', 'Off']
  ];

  $: e = $entities[entity];
  $: attrs = e?.attributes ?? {};
  $: target = attrs.temperature ?? 0;
  $: current = attrs.current_temperature;
  $: step = attrs.target_temp_step ?? 0.5;
  $: min = attrs.min_temp ?? 5;
  $: max = attrs.max_temp ?? 30;
  $: modes = (attrs.hvac_modes ?? ['heat', 'off']) as string[];

  function bump(d: number) {
    setTemperature(entity, Math.max(min, Math.min(max, +(target + d * step).toFixed(1))));
  }
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.thermo}</span>Climate</div>
    <div class="status">{current != null ? `now ${current.toFixed(1)}°C` : ''}</div>
  </div>

  <div class="climate-main">
    <div>
      <div class="temp-big">{target}<span>°C</span></div>
      <div class="climate-now">Target temperature</div>
    </div>
    <div class="setpoint">
      <button class="round-btn" aria-label="Decrease temperature" on:click={() => bump(-1)}>−</button>
      <button class="round-btn" aria-label="Increase temperature" on:click={() => bump(1)}>+</button>
    </div>
  </div>

  <div class="mode-row">
    {#each MODES.filter(([m]) => modes.includes(m)) as [m, label] (m)}
      <button class="mode {m} {e?.state === m ? 'active' : ''}" on:click={() => setHvacMode(entity, m)}>
        {label}
      </button>
    {/each}
  </div>
</div>
