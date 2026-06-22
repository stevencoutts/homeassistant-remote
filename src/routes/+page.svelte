<script lang="ts">
  import { onMount } from 'svelte';
  import { connectLive, connectViaProxy, disconnect, loadAppConfig } from '$lib/ha/connection';
  import { loadCredentials } from '$lib/ha/auth';
  import { showSettings } from '$lib/stores';
  import Settings from '$lib/components/Settings.svelte';
  import { icons } from '$lib/icons';
  import { entities, currentRoomId, rooms, visibleRooms, status } from '$lib/stores';
  import { battery } from '$lib/device/battery';
  import RoomNav from '$lib/components/RoomNav.svelte';
  import LightsCard from '$lib/components/LightsCard.svelte';
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

  // Logo: prefer a bundled static/couttsnet-logo.png (works offline on a
  // VLAN-locked kiosk); fall back to the hosted copy; hide if neither loads.
  let triedRemote = false;
  function logoError(ev: Event) {
    const img = ev.currentTarget as HTMLImageElement;
    if (!triedRemote) {
      triedRemote = true;
      img.src = 'https://couttsnet.com/couttsnet-logo.png';
    } else {
      img.style.display = 'none';
    }
  }

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
    if (room.media?.length) {
      if (room.media.some((m) => $entities[m.entity]?.state === 'playing')) bits.push('playing');
      else if (room.media.some((m) => $entities[m.entity]?.state === 'paused')) bits.push('paused');
    }
    return bits.join(' · ');
  }
</script>

<div class="app">
  <header class="topbar">
    <div class="header-left">
      <img
        class="brand-logo"
        src="/couttsnet-logo.png"
        alt="couttsnet"
        onerror={logoError}
      />
      <div class="room-title">
        <div class="name">{room?.name ?? 'Room Remote'}</div>
        <div class="sub">{sub}</div>
      </div>
    </div>
    <div class="header-right">
      {#if $battery.available}
        <div
          class="battery"
          class:low={$battery.level != null && $battery.level <= 20 && !$battery.charging}
          class:charging={$battery.charging}
          title="Battery {$battery.level ?? '?'}%{$battery.charging ? ' · charging' : ''}"
        >
          <span class="batt-shell"><span class="batt-fill" style="width:{$battery.level ?? 0}%"></span></span>
          <span class="batt-pct">{$battery.level ?? '–'}%</span>
          {#if $battery.charging}<span class="batt-bolt" aria-hidden="true">⚡</span>{/if}
        </div>
      {/if}
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
        {#if room.climate || room.weather}
          <ClimateCard entity={room.climate?.entity ?? null} weather={room.weather ?? null} />
        {/if}
        {#if room.media?.length}<MediaCard players={room.media} soundModes={room.soundModes ?? []} />{/if}
        {#if room.lights?.length || room.power?.length}
          <LightsCard lights={room.lights ?? []} power={room.power ?? []} />
        {/if}
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
