import { describe, it, expect } from 'vitest';
import { formatTime, livePosition, progressPct } from './progress';

describe('formatTime', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });
  it('formats an hour or more as h:mm:ss', () => {
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(7325)).toBe('2:02:05');
  });
  it('clamps negatives to zero', () => {
    expect(formatTime(-10)).toBe('0:00');
  });
});

describe('livePosition', () => {
  it('extrapolates from the sample while playing', () => {
    expect(livePosition({ position: 30, updatedAt: 1000, duration: 200, playing: true, now: 6000 })).toBe(35);
  });
  it('freezes at the sample when paused', () => {
    expect(livePosition({ position: 30, updatedAt: 1000, duration: 200, playing: false, now: 60000 })).toBe(30);
  });
  it('clamps to the duration', () => {
    expect(livePosition({ position: 195, updatedAt: 1000, duration: 200, playing: true, now: 100000 })).toBe(200);
  });
  it('never goes negative', () => {
    expect(livePosition({ position: 0, updatedAt: 0, duration: 0, playing: true, now: 5000 })).toBe(0);
  });
});

describe('progressPct', () => {
  it('computes a percentage of duration', () => {
    expect(progressPct(50, 200)).toBe(25);
    expect(progressPct(0, 200)).toBe(0);
  });
  it('returns 0 for an unknown duration (e.g. live radio)', () => {
    expect(progressPct(50, 0)).toBe(0);
  });
  it('clamps to 100', () => {
    expect(progressPct(250, 200)).toBe(100);
  });
});
