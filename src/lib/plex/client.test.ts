import { describe, it, expect } from 'vitest';
import { thumbState, nextRating, parseRatingKey, pickSession, RATING_UP, RATING_DOWN } from './client';

describe('thumbState', () => {
  it('maps userRating to a thumb', () => {
    expect(thumbState(0)).toBe('none');
    expect(thumbState(undefined)).toBe('none');
    expect(thumbState(2)).toBe('down');
    expect(thumbState(5)).toBe('down');
    expect(thumbState(6)).toBe('up');
    expect(thumbState(10)).toBe('up');
  });
});

describe('nextRating', () => {
  it('sets the thumb rating from unrated', () => {
    expect(nextRating(0, 'up')).toBe(RATING_UP);
    expect(nextRating(0, 'down')).toBe(RATING_DOWN);
    expect(nextRating(undefined, 'up')).toBe(RATING_UP);
  });
  it('clears when tapping the active thumb again', () => {
    expect(nextRating(10, 'up')).toBe(0);
    expect(nextRating(2, 'down')).toBe(0);
  });
  it('switches from one thumb to the other', () => {
    expect(nextRating(2, 'up')).toBe(RATING_UP); // was down, now up
    expect(nextRating(10, 'down')).toBe(RATING_DOWN); // was up, now down
  });
});

describe('parseRatingKey', () => {
  it('reads a key from /library/metadata path', () => {
    expect(parseRatingKey('/library/metadata/54321')).toBe('54321');
  });
  it('reads a key from a plex:// id', () => {
    expect(parseRatingKey('plex://track/12345')).toBe('12345');
  });
  it('reads a bare trailing numeric id', () => {
    expect(parseRatingKey('server:98765')).toBe('98765');
  });
  it('returns null for a non-Plex / Sonos URI', () => {
    expect(parseRatingKey('x-sonos-http:track.mp3')).toBeNull();
    expect(parseRatingKey(undefined)).toBeNull();
  });
});

describe('pickSession', () => {
  const sessions = [
    { ratingKey: '1', title: 'Lovebombs', grandparentTitle: 'London Elektricity', parentTitle: 'Power Ballads', userRating: 0 },
    { ratingKey: '2', title: 'Lovebombs', grandparentTitle: 'Other Artist', parentTitle: 'Covers', userRating: 8 }
  ];
  it('matches by title and prefers the right artist', () => {
    expect(pickSession(sessions, { title: 'Lovebombs', artist: 'London Elektricity' })?.ratingKey).toBe('1');
    expect(pickSession(sessions, { title: 'Lovebombs', artist: 'Other Artist' })?.ratingKey).toBe('2');
  });
  it('falls back to the first title match when artist is unknown', () => {
    expect(pickSession(sessions, { title: 'Lovebombs' })?.ratingKey).toBe('1');
  });
  it('returns null when nothing matches', () => {
    expect(pickSession(sessions, { title: 'Nope' })).toBeNull();
    expect(pickSession(sessions, {})).toBeNull();
  });
});
