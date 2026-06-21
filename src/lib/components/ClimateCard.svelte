<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { setTemperature, setHvacMode } from '$lib/services';

  // The thermostat entity and an optional home-level weather.* entity. At least
  // one is supplied. When a weather entity is given its current condition paints
  // the card background; when a climate entity is given the thermostat controls
  // render below. The card degrades gracefully to either half on its own.
  export let entity: string | null = null;
  export let weather: string | null = null;

  // Only show modes the entity supports (TRV vs full thermostat).
  const MODES: [string, string][] = [
    ['heat', 'Heat'],
    ['cool', 'Cool'],
    ['auto', 'Auto'],
    ['off', 'Off']
  ];

  // HA weather entity: state is the condition; attributes carry temperature etc.
  const EMOJI: Record<string, string> = {
    'clear-night': '🌙',
    cloudy: '☁️',
    fog: '🌫️',
    hail: '🧊',
    lightning: '⛈️',
    'lightning-rainy': '⛈️',
    partlycloudy: '⛅',
    pouring: '🌧️',
    rainy: '🌧️',
    snowy: '❄️',
    'snowy-rainy': '🌨️',
    sunny: '☀️',
    windy: '💨',
    'windy-variant': '💨',
    exceptional: '⚠️'
  };

  // Group every condition into a small set of background "scenes". Each scene is a
  // self-contained CSS gradient so the card works fully offline on the tablet.
  function scene(c: string): string {
    switch (c) {
      case 'sunny':
        return 'sunny';
      case 'clear-night':
        return 'night';
      case 'partlycloudy':
        return 'partly';
      case 'cloudy':
      case 'fog':
      case 'windy':
      case 'windy-variant':
        return 'cloudy';
      case 'rainy':
      case 'pouring':
      case 'lightning-rainy':
        return 'rainy';
      case 'lightning':
      case 'exceptional':
        return 'storm';
      case 'snowy':
      case 'snowy-rainy':
      case 'hail':
        return 'snow';
      default:
        return 'cloudy';
    }
  }

  // Climate entity.
  $: e = entity ? $entities[entity] : undefined;
  $: attrs = e?.attributes ?? {};
  $: target = attrs.temperature ?? 0;
  $: current = attrs.current_temperature;
  $: step = attrs.target_temp_step ?? 0.5;
  $: min = attrs.min_temp ?? 5;
  $: max = attrs.max_temp ?? 30;
  $: modes = (attrs.hvac_modes ?? ['heat', 'off']) as string[];

  // Weather entity (optional).
  $: w = weather ? $entities[weather] : undefined;
  $: wAttrs = w?.attributes ?? {};
  $: condition = w?.state ?? null;
  $: emoji = condition ? EMOJI[condition] ?? '🌡️' : '';
  $: wUnit = wAttrs.temperature_unit ?? '°C';
  $: wTemp = wAttrs.temperature;
  $: wLabel = condition ? condition.replace(/-/g, ' ') : '';
  $: bg = condition ? scene(condition) : 'plain';

  $: hasClimate = !!e;

  function bump(d: number) {
    if (!entity) return;
    setTemperature(entity, Math.max(min, Math.min(max, +(target + d * step).toFixed(1))));
  }
</script>

<div class="card cw cw-{bg}" class:has-weather={!!condition}>
  <div class="cw-scrim"></div>
  <div class="cw-body">
    <div class="card-head">
      <div class="label">
        <span class="icon">{@html icons.thermo}</span>{hasClimate ? 'Climate' : 'Weather'}
      </div>
      {#if hasClimate && current != null}<div class="status">room {current.toFixed(1)}°C</div>{/if}
    </div>

    {#if condition}
      <div class="cw-weather" class:no-climate={!hasClimate}>
        <div class="cw-weather-text">
          <div class="cw-weather-temp">
            {wTemp != null ? wTemp : '–'}<span>{wUnit}</span>
          </div>
          <div class="cw-weather-cond">
            <span class="cw-cond-label">{wLabel}</span>
            {#if wAttrs.humidity != null}<span class="cw-cond-sub">· {wAttrs.humidity}% humidity</span>{/if}
          </div>
        </div>
        <div class="cw-emoji">{emoji}</div>
      </div>
    {/if}

    {#if hasClimate}
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
          <button
            class="mode {m} {e?.state === m ? 'active' : ''} {m === 'heat' && attrs.hvac_action === 'heating' ? 'heating' : ''}"
            on:click={() => entity && setHvacMode(entity, m)}
          >
            {label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* The combined card stacks a weather "scene" behind a dark scrim so the
     thermostat controls stay legible whatever the condition. */
  .cw {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }
  .cw.has-weather {
    border-color: rgba(255, 255, 255, 0.14);
  }

  /* Scene backgrounds (offline, pure CSS). Layered radial "glow" for the
     sun/moon plus a sky gradient. */
  .cw::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -2;
    background: var(--panel-2);
  }
  .cw.has-weather::before {
    background-repeat: no-repeat;
    background-size: cover;
  }
  .cw-sunny.has-weather::before {
    background:
      radial-gradient(120px 120px at 82% 18%, rgba(255, 224, 130, 0.95), rgba(255, 196, 76, 0) 70%),
      linear-gradient(160deg, #3aa0e8 0%, #6fc0f0 45%, #cfe9f7 100%);
  }
  .cw-night.has-weather::before {
    background:
      radial-gradient(90px 90px at 80% 20%, rgba(226, 232, 255, 0.85), rgba(226, 232, 255, 0) 70%),
      linear-gradient(160deg, #0c1430 0%, #1b2550 55%, #2b2160 100%);
  }
  .cw-partly.has-weather::before {
    background:
      radial-gradient(110px 110px at 80% 16%, rgba(255, 224, 130, 0.8), rgba(255, 196, 76, 0) 68%),
      linear-gradient(160deg, #4a86c4 0%, #7fa7c8 50%, #b9c6d2 100%);
  }
  .cw-cloudy.has-weather::before {
    background: linear-gradient(160deg, #55636f 0%, #6e7b87 55%, #97a3ad 100%);
  }
  .cw-rainy.has-weather::before {
    background:
      repeating-linear-gradient(72deg, rgba(180, 205, 230, 0.18) 0 1px, transparent 1px 9px),
      linear-gradient(160deg, #38444f 0%, #4a5a68 55%, #66798a 100%);
  }
  .cw-storm.has-weather::before {
    background:
      radial-gradient(140px 100px at 30% 20%, rgba(255, 240, 170, 0.25), rgba(255, 240, 170, 0) 70%),
      linear-gradient(160deg, #232838 0%, #36304e 55%, #4a3f63 100%);
  }
  .cw-snow.has-weather::before {
    background:
      radial-gradient(2px 2px at 30% 30%, rgba(255, 255, 255, 0.9) 50%, transparent 51%),
      radial-gradient(2px 2px at 70% 50%, rgba(255, 255, 255, 0.8) 50%, transparent 51%),
      radial-gradient(2px 2px at 50% 75%, rgba(255, 255, 255, 0.85) 50%, transparent 51%),
      linear-gradient(160deg, #5b6b86 0%, #7d8eaa 55%, #aab9cf 100%);
  }

  /* Dark scrim weighted to the bottom so controls have contrast. */
  .cw-scrim {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .cw.has-weather .cw-scrim {
    background: linear-gradient(180deg, rgba(8, 12, 20, 0.12) 0%, rgba(8, 12, 20, 0.55) 58%, rgba(8, 12, 20, 0.82) 100%);
  }

  .cw-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* When a weather scene is present, lift text to white for contrast. */
  .cw.has-weather :global(.card-head .label),
  .cw.has-weather .temp-big,
  .cw.has-weather .cw-weather-temp {
    color: #fff;
  }
  .cw.has-weather :global(.card-head .status),
  .cw.has-weather .climate-now,
  .cw.has-weather .temp-big span,
  .cw.has-weather .cw-weather-temp span {
    color: rgba(255, 255, 255, 0.82);
  }
  .cw.has-weather :global(.card-head .icon svg) {
    stroke: #fff;
  }

  .cw-weather {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 2px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  }
  .cw-weather.no-climate {
    border-bottom: none;
    padding-bottom: 2px;
  }
  .cw-weather-temp {
    font-size: 1.7rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .cw-weather-temp span {
    font-size: 0.95rem;
    font-weight: 500;
  }
  .cw-weather-cond {
    margin-top: 4px;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.88);
  }
  .cw-cond-label {
    text-transform: capitalize;
  }
  .cw-cond-sub {
    color: rgba(255, 255, 255, 0.7);
  }
  .cw-emoji {
    font-size: 2.4rem;
    line-height: 1;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
  }
</style>
