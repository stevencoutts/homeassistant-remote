export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// Leading + trailing throttle: fires immediately, then at most once per `ms`,
// with a final trailing call. Used for slider drags so the value tracks live
// instead of only landing on release.
export function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: any[] | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        if (pending) fn(...pending);
        pending = null;
      }, remaining);
    }
  }) as T;
}
