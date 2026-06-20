# Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Climate and Media span both grid columns, and turn Lights and Scenes into overview-first cards that expand on tap (Lights' overview carries a master on/off toggle).

**Architecture:** Pure helpers + a `setLights` service back a master toggle; CSS adds a `.card.wide` span and a collapsible-header style; `LightsCard`/`ScenesCard` gain local collapse state; `ClimateCard`/`MediaCard` just get the `wide` class.

**Tech Stack:** SvelteKit + TypeScript, Svelte 5 (these card components use legacy `export let`/`$:`/`on:` syntax — keep that style), Vitest.

## Global Constraints

- TypeScript strict mode on; British English in UI copy/comments.
- Reuse existing CSS custom properties; 44px minimum touch targets; respect `prefers-reduced-motion` (already handled globally).
- Reflect HA-pushed state when connected; offline-mock mutates the local store.
- Keep the existing per-light row UI and scene chips unchanged when expanded.
- Covers stay single-width and non-collapsible. Don't change `deriveRooms` or other cards.
- Card components here use Svelte legacy syntax (`export let`, `$:`, `on:click`) — match it; do not convert to runes.

---

### Task 1: `anyLightOn` helper + `lightsCall`/`setLights` service

**Files:**
- Modify: `src/lib/services.ts`
- Modify: `src/lib/services.test.ts`

**Interfaces:**
- Consumes: `getConnection` (connection.ts), `entities` store, `EntityMap` type, `callService`.
- Produces:
  - `anyLightOn(states: EntityMap, ids: string[]): boolean` — true if any listed entity has `state === 'on'`.
  - `lightsCall(entityIds: string[], on: boolean): ServiceCall` — `{ domain:'light', service: on?'turn_on':'turn_off', data:{}, target:{ entity_id: entityIds } }`.
  - `setLights(entityIds: string[], on: boolean): void` — live: one `callService`; offline: set each entity's `state` in the store.
  - `ServiceCall.target.entity_id` widened to `string | string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services.test.ts` (inside the existing `describe('service-call builders', …)` block add the `lightsCall` case, and add a new `describe` for `anyLightOn`). Add the import names `lightsCall, anyLightOn` to the existing import from `./services`:
```ts
  it('builds a multi-entity light call', () => {
    expect(lightsCall(['light.a', 'light.b'], true)).toEqual({
      domain: 'light', service: 'turn_on', data: {}, target: { entity_id: ['light.a', 'light.b'] }
    });
    expect(lightsCall(['light.a'], false)).toEqual({
      domain: 'light', service: 'turn_off', data: {}, target: { entity_id: ['light.a'] }
    });
  });
```
And a new top-level describe:
```ts
describe('anyLightOn', () => {
  const states = {
    'light.a': { entity_id: 'light.a', state: 'on', attributes: {} },
    'light.b': { entity_id: 'light.b', state: 'off', attributes: {} }
  };
  it('is true when at least one is on', () => {
    expect(anyLightOn(states, ['light.a', 'light.b'])).toBe(true);
  });
  it('is false when all off or missing', () => {
    expect(anyLightOn(states, ['light.b'])).toBe(false);
    expect(anyLightOn(states, ['light.x'])).toBe(false);
    expect(anyLightOn(states, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- services`
Expected: FAIL — `lightsCall`/`anyLightOn` not exported.

- [ ] **Step 3: Implement in `src/lib/services.ts`**

Widen the `ServiceCall` interface target:
```ts
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target: { entity_id: string | string[] };
}
```
Append at the end of the file:
```ts
export function anyLightOn(states: EntityMap, ids: string[]): boolean {
  return ids.some((id) => states[id]?.state === 'on');
}

export function lightsCall(entityIds: string[], on: boolean): ServiceCall {
  return { domain: 'light', service: on ? 'turn_on' : 'turn_off', data: {}, target: { entity_id: entityIds } };
}

export function setLights(entityIds: string[], on: boolean) {
  const conn = getConnection();
  const c = lightsCall(entityIds, on);
  if (conn) {
    callService(conn, c.domain, c.service, c.data, c.target);
    return;
  }
  entities.update((m) => {
    const next = { ...m };
    for (const id of entityIds) {
      const e = next[id];
      if (e) next[id] = { ...e, state: on ? 'on' : 'off' };
    }
    return next;
  });
}
```
Add `EntityMap` to the existing `import type { ... } from './types';` line if not already imported (it currently imports `EntityState`; add `EntityMap`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- services`
Expected: PASS.

- [ ] **Step 5: Full suite + type-check**

Run: `npm test` → all pass. Run: `npm run check` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services.ts src/lib/services.test.ts
git commit -m "feat: anyLightOn helper + lightsCall/setLights for master toggle"
```

---

### Task 2: Layout CSS, chevron icon, wide Climate/Media

**Files:**
- Modify: `src/app.css`
- Modify: `src/lib/icons.ts`
- Modify: `src/lib/components/ClimateCard.svelte`
- Modify: `src/lib/components/MediaCard.svelte`

**Interfaces:**
- Produces: `.card.wide` (spans both columns), `.head-main`/`.head-meta`/`.chev` styles for collapsible headers, an `icons.chevron`. Consumed by Tasks 3–4.

- [ ] **Step 1: Add the chevron icon**

In `src/lib/icons.ts`, add to the `icons` object (after `cog`):
```ts
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>'
```

- [ ] **Step 2: Add layout CSS to `src/app.css`**

Append:
```css
/* Wide cards span both columns in the 2-col grid (no-op in 1-col). */
.card.wide {
  grid-column: 1 / -1;
}

/* Collapsible card header */
.head-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.head-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chev {
  width: 20px;
  height: 20px;
  color: var(--muted);
  flex: none;
  display: grid;
  place-items: center;
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}
```

- [ ] **Step 3: Make Climate & Media wide**

In `src/lib/components/ClimateCard.svelte`, change the root element opening tag (the first element after `</script>`) from:
```svelte
<div class="card">
```
to:
```svelte
<div class="card wide">
```

In `src/lib/components/MediaCard.svelte`, make the same change to its root element (line 16):
```svelte
<div class="card wide">
```

- [ ] **Step 4: Verify**

Run: `npm run check` → 0 errors. Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app.css src/lib/icons.ts src/lib/components/ClimateCard.svelte src/lib/components/MediaCard.svelte
git commit -m "feat: wide Climate/Media cards + collapsible-header CSS + chevron"
```

---

### Task 3: Collapsible Lights card with master toggle

**Files:**
- Rewrite: `src/lib/components/LightsCard.svelte`

**Interfaces:**
- Consumes: `entities` store; `toggleLight`, `setLightBrightness`, `setLights`, `anyLightOn` (services.ts, Task 1); `icons.bulb`/`icons.chevron`; `.head-main`/`.head-meta`/`.chev` CSS (Task 2).

- [ ] **Step 1: Replace `src/lib/components/LightsCard.svelte` with:**

```svelte
<script lang="ts">
  import { entities } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { toggleLight, setLightBrightness, setLights, anyLightOn } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let lights: NamedEntity[];

  let expanded = false;
  $: ids = lights.map((l) => l.entity);
  $: onCount = lights.filter((l) => $entities[l.entity]?.state === 'on').length;
  $: anyOn = anyLightOn($entities, ids);
  const pct = (b: number | undefined) => (b ? Math.round((b / 255) * 100) : 0);
</script>

<div class="card">
  <div class="card-head">
    <button class="head-main" aria-expanded={expanded} on:click={() => (expanded = !expanded)}>
      <span class="label"><span class="icon">{@html icons.bulb}</span>Lights</span>
      <span class="head-meta">
        <span class="status">{onCount} on</span>
        <span class="chev {expanded ? 'open' : ''}">{@html icons.chevron}</span>
      </span>
    </button>
    <button
      class="switch warm {anyOn ? 'on' : ''}"
      role="switch"
      aria-checked={anyOn}
      aria-label="All lights"
      on:click={() => setLights(ids, !anyOn)}
    ></button>
  </div>

  {#if expanded}
    {#each lights as l (l.entity)}
      {@const e = $entities[l.entity]}
      {@const on = e?.state === 'on'}
      {@const level = pct(e?.attributes.brightness)}
      <div class="light-row">
        <div class="top">
          <span class="nm">{l.name}</span>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="pct">{on ? level + '%' : 'off'}</span>
            <button
              class="switch warm {on ? 'on' : ''}"
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
  {/if}
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run check` → 0 errors. Run: `npm test` → all pass. Run: `npm run build` → succeeds.

- [ ] **Step 3: Manual smoke (offline)**

`npm run dev` → Try demo. Lights card shows collapsed: "Lights  N on  [master]  ⌄". Tapping the header expands the rows and flips the chevron; tapping the master toggle (not the header) flips all lights on/off and updates the count without expanding.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/LightsCard.svelte
git commit -m "feat: collapsible Lights card with master toggle"
```

---

### Task 4: Collapsible Scenes card

**Files:**
- Rewrite: `src/lib/components/ScenesCard.svelte`

**Interfaces:**
- Consumes: `activeScene` store; `activateScene` (services.ts); `icons.scene`/`icons.chevron`; `.head-main`/`.head-meta`/`.chev` CSS (Task 2).

- [ ] **Step 1: Replace `src/lib/components/ScenesCard.svelte` with:**

```svelte
<script lang="ts">
  import { activeScene } from '$lib/stores';
  import { icons } from '$lib/icons';
  import { activateScene } from '$lib/services';
  import type { NamedEntity } from '$lib/types';

  export let roomId: string;
  export let scenes: NamedEntity[];

  let expanded = false;
  $: activeName = scenes.find((s) => s.entity === $activeScene[roomId])?.name ?? '—';
</script>

<div class="card">
  <div class="card-head">
    <button class="head-main" aria-expanded={expanded} on:click={() => (expanded = !expanded)}>
      <span class="label"><span class="icon">{@html icons.scene}</span>Scenes</span>
      <span class="head-meta">
        <span class="status">{activeName}</span>
        <span class="chev {expanded ? 'open' : ''}">{@html icons.chevron}</span>
      </span>
    </button>
  </div>

  {#if expanded}
    <div class="chips">
      {#each scenes as s (s.entity)}
        <button
          class="chip {$activeScene[roomId] === s.entity ? 'active' : ''}"
          on:click={() => activateScene(roomId, s.entity)}
        >
          {s.name}
        </button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run check` → 0 errors. Run: `npm test` → all pass. Run: `npm run build` → succeeds.

- [ ] **Step 3: Manual smoke (offline)**

`npm run dev` → Try demo. Scenes card shows collapsed: "Scenes  <active scene or —>  ⌄". Tapping the header reveals the chips; tapping a chip sets it active and the collapsed summary then shows that scene's name.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ScenesCard.svelte
git commit -m "feat: collapsible Scenes card with active-scene summary"
```

---

## Self-Review

**Spec coverage (design doc 2026-06-20-card-layout-design.md):**
- Wide Climate & Media (`.card.wide`, root class) → Task 2. ✓
- Lights collapsed overview + master toggle (any-on; tap all-off/all-on) → Task 1 (`anyLightOn`/`setLights`) + Task 3 (UI). ✓
- Scenes collapsed overview (active scene name) + expand chips → Task 4. ✓
- Per-card local collapse state, collapsed by default, resets per room (cards re-keyed by room) → Tasks 3–4 (`let expanded = false`). ✓
- 44px header targets, aria-expanded, chevron respects reduced-motion → Task 2 CSS + Tasks 3–4 markup. ✓
- Covers unchanged; other cards untouched → only listed files change. ✓
- Testing: `anyLightOn` + `lightsCall` → Task 1. ✓

**Placeholder scan:** none — full code in every step.

**Type consistency:** `anyLightOn(states, ids)`, `lightsCall(ids, on)`, `setLights(ids, on)` defined Task 1, consumed Task 3; `ServiceCall.target.entity_id: string | string[]` widened once (existing single-entity builders/tests still valid); `icons.chevron` + `.head-main`/`.head-meta`/`.chev` defined Task 2, used Tasks 3–4. Components keep legacy Svelte syntax consistently.

**Deferred (not gaps):** expand/collapse + master-toggle click-through are Playwright (phase 6); no persistence of expansion (per design).
