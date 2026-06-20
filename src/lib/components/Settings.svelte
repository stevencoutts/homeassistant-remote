<script lang="ts">
  import { showSettings } from '$lib/stores';
  import { loadCredentials, saveCredentials, credentialsValid, clearCredentials } from '$lib/ha/auth';
  import { connectLive, startMock, disconnect } from '$lib/ha/connection';

  const existing = loadCredentials();
  let url = $state(existing?.url ?? '');
  let token = $state(''); // never pre-fill the stored token
  let showToken = $state(false);
  let connecting = $state(false);
  let errorMsg = $state('');
  const hasCreds = existing !== null;

  async function connect() {
    if (!credentialsValid(url, token)) {
      errorMsg = 'Enter both the URL and the token.';
      return;
    }
    errorMsg = '';
    connecting = true;
    saveCredentials(url, token);
    try {
      await connectLive();
      showSettings.set(false);
    } catch {
      errorMsg = "Couldn't connect — check the URL and token.";
    } finally {
      connecting = false;
    }
  }

  function demo() {
    startMock();
    showSettings.set(false);
  }

  function clear() {
    disconnect();
    clearCredentials();
    url = '';
    token = '';
    errorMsg = '';
  }
</script>

<div class="settings-overlay">
  <div class="settings-card">
    <h1>Room Remote — Setup</h1>

    <label for="ha-url">Home Assistant URL</label>
    <input
      id="ha-url"
      type="url"
      inputmode="url"
      autocomplete="off"
      placeholder="http://homeassistant.local:8123"
      bind:value={url}
      disabled={connecting}
    />

    <label for="ha-token">Long-lived access token</label>
    <div class="token-row">
      {#if showToken}
        <input id="ha-token" type="text" autocomplete="off" bind:value={token} disabled={connecting} />
      {:else}
        <input id="ha-token" type="password" autocomplete="off" bind:value={token} disabled={connecting} />
      {/if}
      <button type="button" class="ghost" onclick={() => (showToken = !showToken)} disabled={connecting}>
        {showToken ? 'Hide' : 'Show'}
      </button>
    </div>

    {#if errorMsg}<p class="err">{errorMsg}</p>{/if}

    <button class="primary" onclick={connect} disabled={connecting}>
      {connecting ? 'Connecting…' : 'Connect'}
    </button>
    <button class="secondary" onclick={demo} disabled={connecting}>Try demo</button>

    {#if hasCreds}
      <button class="danger" onclick={clear} disabled={connecting}>Disconnect &amp; clear</button>
    {/if}
  </div>
</div>

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
  }
  .settings-card {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 24px;
  }
  h1 {
    font-size: 1.2rem;
    font-weight: 680;
    margin: 0 0 6px;
  }
  label {
    font-size: 0.82rem;
    color: var(--muted);
    margin-top: 6px;
  }
  input {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel-3);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 1rem;
  }
  input:focus {
    outline: none;
    border-color: var(--blue);
  }
  .token-row {
    display: flex;
    gap: 8px;
  }
  .token-row input {
    flex: 1;
  }
  button {
    min-height: 44px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    font-size: 0.95rem;
    cursor: pointer;
    color: var(--text);
    background: var(--panel-3);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    background: var(--blue);
    border-color: var(--blue);
    color: #06121f;
    font-weight: 600;
    margin-top: 8px;
  }
  .ghost {
    min-height: 44px;
    flex: none;
  }
  .danger {
    color: var(--red);
    border-color: var(--red);
    background: transparent;
    margin-top: 6px;
  }
  .err {
    color: var(--red);
    font-size: 0.85rem;
    margin: 2px 0 0;
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
