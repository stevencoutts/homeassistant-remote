import { describe, it, expect } from 'vitest';
import {
  lightToggleCall,
  brightnessCall,
  temperatureCall,
  hvacModeCall,
  volumeCall,
  coverPositionCall,
  sceneCall
} from './services';

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
});
