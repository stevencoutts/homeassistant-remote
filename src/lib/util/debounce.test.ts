import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  it('calls once with the last args after the delay', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 200);
    d(1); d(2); d(3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledExactlyOnceWith(3);
    vi.useRealTimers();
  });
});
