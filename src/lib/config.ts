import { base } from '$app/paths';
import type { RoomsConfig } from './types';

// Loads runtime config from /rooms.json (served from static/, gitignored, never bundled).
// ponytail: phase 3 adds full schema validation + a per-entity error overlay. This is the
// minimum guard so a missing or empty config fails loudly rather than rendering blank.
export async function loadConfig(): Promise<RoomsConfig> {
  const res = await fetch(`${base}/rooms.json`);
  if (!res.ok) throw new Error(`Could not load rooms.json (HTTP ${res.status})`);
  const cfg = (await res.json()) as RoomsConfig;
  if (!cfg?.rooms?.length) throw new Error('rooms.json has no rooms');
  return cfg;
}
