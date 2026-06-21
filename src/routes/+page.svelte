<script lang="ts">
  import { onMount } from 'svelte';
  import { connectLive, connectViaProxy, disconnect, loadAppConfig } from '$lib/ha/connection';
  import { loadCredentials } from '$lib/ha/auth';
  import { showSettings } from '$lib/stores';
  import Settings from '$lib/components/Settings.svelte';
  import { icons } from '$lib/icons';
  import { entities, currentRoomId, rooms, visibleRooms, status } from '$lib/stores';
  import RoomNav from '$lib/components/RoomNav.svelte';
  import LightsCard from '$lib/components/LightsCard.svelte';
  import ScenesCard from '$lib/components/ScenesCard.svelte';
  import ClimateCard from '$lib/components/ClimateCard.svelte';
  import MediaCard from '$lib/components/MediaCard.svelte';
  import CoverCard from '$lib/components/CoverCard.svelte';

  let clock = '';

  // Per-device room-lock: ?lock=<area_id> pins this device to one room and hides the nav.
  const lock =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lock') : null;

  onMount(async () => {
    // 1) Per-device credentials override everything.
    if (loadCredentials()) {
      try {
        await connectLive();
      } catch {
        disconnect();
        showSettings.set(true);
      }
      return;
    }
    // 2) Otherwise use the container's central proxy if it offers one.
    const cfg = await loadAppConfig();
    if (cfg.proxy) {
      try {
        await connectViaProxy();
      } catch {
        disconnect();
        showSettings.set(true);
      }
      return;
    }
    // 3) Otherwise ask for credentials.
    showSettings.set(true);
  });

  onMount(() => {
    const tick = () =>
      (clock = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  });

  // Keep selection valid as rooms arrive; honour the lock.
  $: if (lock) {
    currentRoomId.set(lock);
  } else if ($visibleRooms.length && !$visibleRooms.some((r) => r.id === $currentRoomId)) {
    currentRoomId.set($visibleRooms[0].id);
  }

  $: room = $rooms.find((r) => r.id === $currentRoomId) ?? null;

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
    <div class="header-right">
      <div class="clock">
        <div class="time">{clock || '--:--'}</div>
        {#if $status === 'disconnected'}<div class="meta" style="color:var(--red)">Disconnected</div>
        {:else if $status === 'connecting'}<div class="meta">Connecting…</div>{/if}
      </div>
      <button class="gear" aria-label="Settings" onclick={() => showSettings.set(true)}>
        {@html icons.cog}
      </button>
    </div>
  </header>

  <main class="cards">
    {#if room}
      <!-- Re-create the cards per room so collapse state starts at the overview each time. -->
      {#key room.id}
        {#if room.lights?.length}<LightsCard lights={room.lights} />{/if}
        {#if room.scenes?.length}<ScenesCard roomId={room.id} scenes={room.scenes} />{/if}
        {#if room.climate}<ClimateCard entity={room.climate.entity} />{/if}
        {#if room.media}<MediaCard entity={room.media.entity} />{/if}
        {#each room.covers ?? [] as cover (cover.entity)}<CoverCard {cover} />{/each}
      {/key}
    {/if}
  </main>

  {#if $visibleRooms.length && !lock}
    <RoomNav rooms={$visibleRooms} />
  {/if}
</div>

{#if $showSettings}
  <Settings />
{/if}
