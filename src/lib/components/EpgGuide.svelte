<script lang="ts">
  import { onMount } from 'svelte';
  import { icons } from '$lib/icons';
  import { getChannels, getGuide, findPlayTarget, listPlayTargets, playChannel } from '$lib/emby/client';
  import { mediaTurnOn, mediaSelectSource } from '$lib/services';
  import type { Channel, Programme, PlayTarget } from '$lib/emby/types';

  // The room's Apple TV display name, used to target the right Emby session.
  export let appleTvHint = '';
  // The Apple TV's HA media_player entity, used to wake it and launch Emby when
  // no Emby session exists yet.
  export let appleTvEntity = '';
  // The Emby app's name in the Apple TV source list (for select_source).
  export let embySource = 'Emby';
  export let onClose: () => void = () => {};

  const HALF = 30 * 60_000;
  const PX_PER_MIN = 5;
  const HOURS = 5;
  const COL = 132; // channel-label column width
  const ROW = 64;

  // Window starts at the current half-hour and spans HOURS hours.
  const now = Date.now();
  const windowStart = Math.floor(now / HALF) * HALF;
  const windowEnd = windowStart + HOURS * 60 * 60_000;
  const totalWidth = ((windowEnd - windowStart) / 60_000) * PX_PER_MIN;
  const nowLeft = COL + ((now - windowStart) / 60_000) * PX_PER_MIN;

  const ticks: number[] = [];
  for (let t = windowStart; t <= windowEnd; t += HALF) ticks.push(t);
  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  let channels: Channel[] = [];
  let guide: Programme[] = [];
  let target: PlayTarget | null = null;
  let loading = true;
  let error = '';
  let toast = '';
  let toastTimer: ReturnType<typeof setTimeout>;

  // Per-room device preference stored in localStorage so the user only picks once.
  const storageKey = `emby_device:${appleTvHint}`;
  let allTargets: PlayTarget[] = [];
  let showPicker = false;
  let pendingProgramme: Programme | null = null;

  function loadStoredTarget(): PlayTarget | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as PlayTarget;
    } catch { return null; }
  }
  function storeTarget(t: PlayTarget) {
    try { localStorage.setItem(storageKey, JSON.stringify(t)); } catch {}
  }

  onMount(async () => {
    // Load stored device preference for this room (best-effort; non-blocking).
    const stored = loadStoredTarget();
    if (stored) target = stored;

    // Refresh the session list in the background to show the live device name.
    findPlayTarget(appleTvHint)
      .then((t) => { if (t) target = t; })
      .catch((e) => console.error('Emby session lookup failed', e));

    try {
      channels = await getChannels();
    } catch (e) {
      console.error('Emby channels load failed', e);
      error = `Could not load channels: ${(e as Error).message}`;
      loading = false;
      return;
    }
    try {
      // Fetch a little before the window so currently-airing programmes appear.
      guide = await getGuide(
        channels.map((c) => c.id),
        windowStart - 3 * 60 * 60_000,
        windowEnd
      );
    } catch (e) {
      // Channels still render; programmes just stay empty.
      console.error('Emby guide load failed', e);
    }
    loading = false;
  });

  function progsFor(channelId: string): Programme[] {
    return guide.filter(
      (p) => p.channelId === channelId && p.end > windowStart && p.start < windowEnd
    );
  }
  function pos(p: Programme) {
    const rawLeft = ((p.start - windowStart) / 60_000) * PX_PER_MIN;
    const rawRight = ((p.end - windowStart) / 60_000) * PX_PER_MIN;
    const left = Math.max(0, rawLeft);
    return { left, width: Math.max(0, rawRight - left) };
  }
  const isLive = (p: Programme) => p.start <= now && now < p.end;
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? 'channel';

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let waking = false;

  // Get a confirmed fresh session for the stored/preferred device, or wake it.
  async function resolveTarget(preferredName?: string): Promise<PlayTarget | null> {
    const sessions = await listPlayTargets();
    if (!sessions.length) return null;

    // If we have a preferred device name, find that session by exact name.
    if (preferredName) {
      const match = sessions.find((s) => s.name === preferredName);
      if (match) return match;
    }

    // One candidate — no ambiguity, use it.
    if (sessions.length === 1) return sessions[0];

    return null; // ambiguous — caller will show picker
  }

  async function ensureTarget(): Promise<PlayTarget | null> {
    const stored = loadStoredTarget();
    const fresh = await resolveTarget(stored?.name);
    if (fresh) { target = fresh; storeTarget(fresh); return fresh; }

    // Multiple sessions with no stored preference — need the user to pick.
    const sessions = await listPlayTargets();
    if (sessions.length > 1) {
      allTargets = sessions;
      return null; // play() will show the picker
    }

    // No sessions at all — try to wake the device.
    if (!appleTvEntity) return null;
    waking = true;
    flash('Starting Emby on the device…');
    mediaTurnOn(appleTvEntity);
    if (embySource) mediaSelectSource(appleTvEntity, embySource);
    try {
      for (let i = 0; i < 12; i++) {
        await delay(1500);
        const t = await resolveTarget(stored?.name);
        if (t) { target = t; storeTarget(t); return t; }
      }
      return null;
    } finally {
      waking = false;
    }
  }

  async function play(p: Programme) {
    const t = await ensureTarget();
    if (!t && allTargets.length > 1) {
      // Show picker — resume play after the user selects a device.
      pendingProgramme = p;
      showPicker = true;
      return;
    }
    if (!t) {
      flash('Could not reach the device. Open Emby on it and try again.');
      return;
    }
    await doPlay(t, p);
  }

  async function pickDevice(t: PlayTarget) {
    storeTarget(t);
    target = t;
    showPicker = false;
    if (pendingProgramme) {
      const p = pendingProgramme;
      pendingProgramme = null;
      await doPlay(t, p);
    }
  }

  async function doPlay(t: PlayTarget, p: Programme) {
    try {
      await playChannel(t.sessionId, p.channelId);
      flash(`Playing ${channelName(p.channelId)} on ${t.name}`);
    } catch (err) {
      flash(`Could not start playback${err instanceof Error ? ': ' + err.message : ''}.`);
    }
  }
  function flash(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 4000);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="epg" role="dialog" aria-label="TV guide" aria-busy={waking}>
  <header class="epg-head">
    <div class="epg-title">
      <span class="icon">{@html icons.tv}</span>
      <span>TV Guide</span>
      {#if target}<span class="epg-target">→ {target.name}</span>{/if}
    </div>
    <button class="epg-close" aria-label="Close guide" on:click={onClose}>{@html icons.close}</button>
  </header>

  {#if loading}
    <div class="epg-state">Loading guide…</div>
  {:else if error}
    <div class="epg-state">{error}</div>
  {:else if !channels.length}
    <div class="epg-state">No Live TV channels found.</div>
  {:else}
    <div class="epg-scroll">
      <div class="epg-grid" style="width:{COL + totalWidth}px">
        <div class="epg-axis" style="height:34px">
          <div class="epg-corner" style="width:{COL}px">{hhmm(now)}</div>
          <div class="epg-axis-track" style="width:{totalWidth}px">
            {#each ticks as t (t)}
              <div class="epg-tick" style="left:{((t - windowStart) / 60_000) * PX_PER_MIN}px">
                {hhmm(t)}
              </div>
            {/each}
          </div>
        </div>

        {#each channels as ch (ch.id)}
          <div class="epg-row" style="height:{ROW}px">
            <div class="epg-chan" style="width:{COL}px">
              {#if ch.logo}<img src={ch.logo} alt="" />{/if}
              <div class="epg-chan-text">
                {#if ch.number}<span class="epg-num">{ch.number}</span>{/if}
                <span class="epg-name">{ch.name}</span>
              </div>
            </div>
            <div class="epg-track" style="width:{totalWidth}px">
              {#each progsFor(ch.id) as p (p.id)}
                {@const l = pos(p)}
                <button
                  class="epg-prog {isLive(p) ? 'live' : ''}"
                  style="left:{l.left}px;width:{l.width}px"
                  title={p.title}
                  on:click={() => play(p)}
                >
                  <span class="epg-prog-title">{p.title}</span>
                  <span class="epg-prog-time">{hhmm(p.start)}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}

        <div class="epg-nowline" style="left:{nowLeft}px"></div>
      </div>
    </div>
  {/if}

  {#if toast}<div class="epg-toast">{toast}</div>{/if}

  {#if showPicker}
    <div class="epg-picker-overlay">
      <div class="epg-picker">
        <div class="epg-picker-title">Which device for {appleTvHint || 'this room'}?</div>
        <div class="epg-picker-sub">This choice is saved — you won't be asked again.</div>
        {#each allTargets as t (t.sessionId)}
          <button class="epg-picker-btn" on:click={() => pickDevice(t)}>{t.name}</button>
        {/each}
        <button class="epg-picker-cancel" on:click={() => { showPicker = false; pendingProgramme = null; }}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .epg {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .epg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .epg-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 620;
    font-size: 1.1rem;
  }
  .epg-title .icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
  }
  .epg-title .icon :global(svg) {
    width: 22px;
    height: 22px;
  }
  .epg-target {
    color: var(--muted);
    font-weight: 500;
    font-size: 0.9rem;
  }
  .epg-close {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
  }
  .epg-close :global(svg) {
    width: 22px;
    height: 22px;
  }
  .epg-state {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  /* Single scroll container so the time axis and channel column stay aligned. */
  .epg-scroll {
    flex: 1;
    overflow: auto;
    scrollbar-width: none;
  }
  .epg-scroll::-webkit-scrollbar {
    display: none;
  }
  .epg-grid {
    position: relative;
  }
  .epg-axis {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .epg-corner {
    position: sticky;
    left: 0;
    z-index: 4;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--panel);
    border-right: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .epg-axis-track {
    position: relative;
    flex: none;
  }
  .epg-tick {
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .epg-row {
    display: flex;
    border-bottom: 1px solid var(--line);
  }
  .epg-chan {
    position: sticky;
    left: 0;
    z-index: 2;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    background: var(--panel-2);
    border-right: 1px solid var(--line);
  }
  .epg-chan img {
    width: 34px;
    height: 34px;
    object-fit: contain;
    flex: none;
  }
  .epg-chan-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .epg-num {
    font-size: 0.7rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .epg-name {
    font-size: 0.86rem;
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .epg-track {
    position: relative;
    flex: none;
  }
  .epg-prog {
    position: absolute;
    top: 6px;
    bottom: 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 4px 8px;
    margin: 0;
    text-align: left;
    background: var(--panel-3);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--text);
    cursor: pointer;
    overflow: hidden;
  }
  .epg-prog:active {
    transform: scale(0.99);
  }
  .epg-prog.live {
    background: rgba(255, 182, 72, 0.16);
    border-color: var(--accent);
  }
  .epg-prog-title {
    font-size: 0.82rem;
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .epg-prog-time {
    font-size: 0.7rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .epg-nowline {
    position: absolute;
    top: 34px;
    bottom: 0;
    width: 2px;
    background: var(--red);
    z-index: 1;
    pointer-events: none;
  }
  .epg-toast {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    background: var(--panel-3);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 0.9rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .epg-picker-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
  }
  .epg-picker {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 24px 20px;
    width: min(320px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  .epg-picker-title {
    font-weight: 640;
    font-size: 1rem;
    text-align: center;
  }
  .epg-picker-sub {
    font-size: 0.78rem;
    color: var(--muted);
    text-align: center;
    margin-bottom: 4px;
  }
  .epg-picker-btn {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 560;
    cursor: pointer;
    text-align: left;
  }
  .epg-picker-btn:active {
    background: var(--panel-3);
  }
  .epg-picker-cancel {
    padding: 10px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 0.88rem;
    cursor: pointer;
    text-align: center;
    margin-top: 2px;
  }
</style>
