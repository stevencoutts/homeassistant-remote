import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  lightToggleCall,
  brightnessCall,
  temperatureCall,
  hvacModeCall,
  volumeCall,
  coverPositionCall,
  sceneCall,
  setLightBrightness,
  setVolume,
  setCoverPosition,
  lightsCall,
  anyLightOn
} from './services';
import { entities } from './stores';

// --- Pure builder tests ---

describe('service-call builders', () => {
  it('builds the correct HA service calls', () => {
    expect(lightToggleCall('light.x')).toEqual({
      domain: 'light', service: 'toggle', data: {}, target: { entity_id: 'light.x' }
    });
    expect(brightnessCall('light.x', 50)).toEqual({
      domain: 'light', service: 'turn_on', data: { brightness_pct: 50 }, target: { entity_id: 'light.x' }
    });
    expect(temperatureCall('climate.x', 21.5)).toEqual({
      domain: 'climate', service: 'set_temperature', data: { temperature: 21.5 }, target: { entity_id: 'climate.x' }
    });
    expect(hvacModeCall('climate.x', 'heat')).toEqual({
      domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'heat' }, target: { entity_id: 'climate.x' }
    });
    expect(volumeCall('media_player.x', 40)).toEqual({
      domain: 'media_player', service: 'volume_set', data: { volume_level: 0.4 }, target: { entity_id: 'media_player.x' }
    });
    expect(coverPositionCall('cover.x', 60)).toEqual({
      domain: 'cover', service: 'set_cover_position', data: { position: 60 }, target: { entity_id: 'cover.x' }
    });
    expect(sceneCall('scene.x')).toEqual({
      domain: 'scene', service: 'turn_on', data: {}, target: { entity_id: 'scene.x' }
    });
  });

  it('builds a multi-entity light call', () => {
    expect(lightsCall(['light.a', 'light.b'], true)).toEqual({
      domain: 'light', service: 'turn_on', data: {}, target: { entity_id: ['light.a', 'light.b'] }
    });
    expect(lightsCall(['light.a'], false)).toEqual({
      domain: 'light', service: 'turn_off', data: {}, target: { entity_id: ['light.a'] }
    });
  });
});

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

// --- Optimistic slider tracking tests ---
// Verifies that setLightBrightness / setVolume / setCoverPosition update the
// entities store immediately (synchronously) in BOTH offline and connected modes,
// so the on-screen slider value tracks live during a drag.

vi.mock('./ha/connection', () => ({ getConnection: vi.fn() }));
vi.mock('home-assistant-js-websocket', () => ({
  callService: vi.fn(() => Promise.resolve())
}));

describe('slider optimistic store updates', () => {
  let mockGetConnection: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const connModule = await import('./ha/connection');
    mockGetConnection = connModule.getConnection as ReturnType<typeof vi.fn>;

    // Seed the store with known entity states.
    entities.set({
      'light.x': { entity_id: 'light.x', state: 'on', attributes: { brightness: 128 } },
      'media_player.x': { entity_id: 'media_player.x', state: 'playing', attributes: { volume_level: 0.5 } },
      'cover.x': { entity_id: 'cover.x', state: 'open', attributes: { current_position: 50 } }
    });
  });

  it('setLightBrightness updates the store immediately when offline', () => {
    mockGetConnection.mockReturnValue(null);
    setLightBrightness('light.x', 50);
    const map = get(entities);
    expect(map['light.x'].attributes.brightness).toBe(Math.round((50 / 100) * 255));
  });

  it('setLightBrightness updates the store immediately when connected', () => {
    mockGetConnection.mockReturnValue({} as object);
    setLightBrightness('light.x', 75);
    const map = get(entities);
    expect(map['light.x'].attributes.brightness).toBe(Math.round((75 / 100) * 255));
  });

  it('setVolume updates the store immediately when offline', () => {
    mockGetConnection.mockReturnValue(null);
    setVolume('media_player.x', 30);
    expect(get(entities)['media_player.x'].attributes.volume_level).toBeCloseTo(0.3);
  });

  it('setVolume updates the store immediately when connected', () => {
    mockGetConnection.mockReturnValue({} as object);
    setVolume('media_player.x', 60);
    expect(get(entities)['media_player.x'].attributes.volume_level).toBeCloseTo(0.6);
  });

  it('setCoverPosition updates the store immediately when offline', () => {
    mockGetConnection.mockReturnValue(null);
    setCoverPosition('cover.x', 25);
    const e = get(entities)['cover.x'];
    expect(e.attributes.current_position).toBe(25);
    expect(e.state).toBe('open');
  });

  it('setCoverPosition updates the store immediately when connected', () => {
    mockGetConnection.mockReturnValue({} as object);
    setCoverPosition('cover.x', 0);
    const e = get(entities)['cover.x'];
    expect(e.attributes.current_position).toBe(0);
    expect(e.state).toBe('closed');
  });
});
