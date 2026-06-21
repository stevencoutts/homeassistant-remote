<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';

  export let entity: string;

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

  $: e = $entities[entity];
  $: attrs = e?.attributes ?? {};
  $: condition = e?.state ?? 'unknown';
  $: emoji = EMOJI[condition] ?? '🌡️';
  $: unit = attrs.temperature_unit ?? '°C';
  $: temp = attrs.temperature;
  $: label = condition.replace(/-/g, ' ');
</script>

<div class="card">
  <div class="card-head">
    <div class="label"><span class="icon">{@html icons.thermo}</span>Weather</div>
    {#if attrs.humidity != null}<div class="status">{attrs.humidity}% humidity</div>{/if}
  </div>

  <div class="climate-main">
    <div>
      <div class="temp-big">{temp != null ? temp : '–'}<span>{unit}</span></div>
      <div class="climate-now" style="text-transform:capitalize">{label}</div>
    </div>
    <div class="weather-emoji">{emoji}</div>
  </div>
</div>

<style>
  .weather-emoji {
    font-size: 2rem;
    line-height: 1;
  }
</style>
