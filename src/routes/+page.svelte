<script lang="ts">
  import { onMount } from 'svelte';
  import { loadConfig } from '$lib/config';
  import { mockStates } from '$lib/mockStates';
  import { entities, currentRoomId } from '$lib/stores';
  import RoomNav from '$lib/components/RoomNav.svelte';
  import LightsCard from '$lib/components/LightsCard.svelte';
  import ScenesCard from '$lib/components/ScenesCard.svelte';
  import ClimateCard from '$lib/components/ClimateCard.svelte';
  import MediaCard from '$lib/components/MediaCard.svelte';
  import CoverCard from '$lib/components/CoverCard.svelte';
  import type { RoomsConfig } from '$lib/types';

  let config: RoomsConfig | null = null;
  let error = '';
  let clock = '';

  onMount(async () => {
    try {
      config = await loadConfig();
      entities.set(mockStates(config)); // phase 2: live HA subscription replaces this
      const lock = config.deviceRoomLock;
      if (lock) {
        currentRoomId.set(lock);
      } else if (!config.rooms.some((r) => r.id === $currentRoomId)) {
        currentRoomId.set(config.rooms[0].id);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  onMount(() => {
    const tick = () =>
      (clock = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  });

  $: room = config?.rooms.find((r) => r.id === $currentRoomId) ?? null;
  $: locked = !!config?.deviceRoomLock;
  $: outdoorId = config?.ha.outdoorTempEntity;
  $: outdoor = outdoorId && $entities[outdoorId] ? `Outside ${$entities[outdoorId].state}°C` : '';

  // Header subtitle: lights on / current temp / media state, mirroring the mockup.
  $: sub = room ? subtitle() : '';
  function subtitle(): string {
    if (!room) return '';
    const bits: string[] = [];
    if (room.lights?.length) {
      const on = room.lights.filter((l) => $entities[l.entity]?.state === 'on').length;
      bits.push(`${on}/${room.lights.length} lights`);
    }
    if (room.climate) {
      const t = $entities[room.climate.entity]?.attributes.current_temperature;
      if (t != null) bits.push(`${t.toFixed(1)}°C`);
    }
    if (room.media) {
      const s = $entities[room.media.entity]?.state;
      if (s === 'playing' || s === 'paused') bits.push(s);
    }
    return bits.join(' · ');
  }
</script>

<div class="app">
  <header class="topbar">
    <div class="room-title">
      <div class="name">{room?.name ?? 'Room Remote'}</div>
      <div class="sub">{sub}</div>
    </div>
    <div class="clock">
      <div class="time">{clock || '--:--'}</div>
      {#if outdoor}<div class="meta">{outdoor}</div>{/if}
    </div>
  </header>

  <main class="cards">
    {#if room}
      {#if room.lights?.length}<LightsCard lights={room.lights} />{/if}
      {#if room.scenes?.length}<ScenesCard roomId={room.id} scenes={room.scenes} />{/if}
      {#if room.climate}<ClimateCard entity={room.climate.entity} />{/if}
      {#if room.media}<MediaCard entity={room.media.entity} />{/if}
      {#each room.covers ?? [] as cover (cover.entity)}<CoverCard {cover} />{/each}
    {/if}
  </main>

  {#if config && !locked}
    <RoomNav rooms={config.rooms} />
  {/if}
</div>

{#if error}
  <div class="overlay">Config error: {error}<br />Check static/rooms.json.</div>
{/if}
