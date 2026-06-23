// Pure helpers for the media-card progress bar. HA gives a position sampled at a
// timestamp (`media_position` at `media_position_updated_at`) plus a duration;
// while playing we extrapolate from that sample so the bar advances smoothly
// between state pushes. Kept pure so the maths is unit-tested.

// Format seconds as m:ss, or h:mm:ss for an hour or more.
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
}

export interface PositionInput {
  position: number; // media_position (seconds) at the sample time
  updatedAt: number; // media_position_updated_at as epoch ms (0 if unknown)
  duration: number; // media_duration (seconds)
  playing: boolean;
  now: number; // current epoch ms
}

// Current playback position in seconds, extrapolated while playing and clamped
// to [0, duration].
export function livePosition({ position, updatedAt, duration, playing, now }: PositionInput): number {
  let p = position;
  if (playing && updatedAt) p += (now - updatedAt) / 1000;
  if (duration > 0) p = Math.min(p, duration);
  return Math.max(0, p);
}

// Progress as a 0-100 percentage of the duration.
export function progressPct(position: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (position / duration) * 100));
}
