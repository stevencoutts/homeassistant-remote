import { describe, it, expect, vi } from 'vitest';
import { bridge } from './bridge.js';

function fakeSocket() {
  const handlers = {};
  return {
    sent: [],
    send(s) { this.sent.push(s); },
    close: vi.fn(),
    on(ev, cb) { handlers[ev] = cb; },
    emit(ev, data) { handlers[ev] && handlers[ev](data); }
  };
}

describe('bridge', () => {
  it('auths upstream with the real token and accepts any browser token', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');

    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '2025.1' }));
    expect(upstream.sent).toContain(JSON.stringify({ type: 'auth', access_token: 'REAL' }));
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_required', ha_version: '2025.1' }));

    browser.emit('message', JSON.stringify({ type: 'auth', access_token: 'dummy' }));
    upstream.emit('message', JSON.stringify({ type: 'auth_ok', ha_version: '2025.1' }));
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_ok', ha_version: '2025.1' }));
    // Security invariant: the real token is never sent to the browser side.
    expect(JSON.stringify(browser.sent)).not.toContain('REAL');
  });

  it('holds browser auth_ok until upstream auth completes, even when the browser auths first', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');

    // The client library auths immediately on open, before upstream is ready.
    browser.emit('message', JSON.stringify({ type: 'auth', access_token: 'dummy' }));
    expect(browser.sent.some((m) => m.includes('auth_ok'))).toBe(false); // not yet

    // Upstream then connects and authenticates.
    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '9.9' }));
    upstream.emit('message', JSON.stringify({ type: 'auth_ok', ha_version: '9.9' }));

    // Now the browser is acknowledged, always with a real ha_version (never undefined).
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_ok', ha_version: '9.9' }));
  });

  it('relays messages both ways once authed', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');
    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '1' }));
    browser.emit('message', JSON.stringify({ type: 'auth' }));
    upstream.emit('message', JSON.stringify({ type: 'auth_ok', ha_version: '1' }));

    const sub = JSON.stringify({ id: 1, type: 'subscribe_entities' });
    browser.emit('message', sub);
    expect(upstream.sent).toContain(sub); // browser -> upstream

    const evt = JSON.stringify({ id: 1, type: 'event' });
    upstream.emit('message', evt);
    expect(browser.sent).toContain(evt); // upstream -> browser
  });

  it('closes both sides on auth_invalid', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'BAD');
    upstream.emit('message', JSON.stringify({ type: 'auth_required' }));
    upstream.emit('message', JSON.stringify({ type: 'auth_invalid', message: 'nope' }));
    expect(browser.close).toHaveBeenCalled();
    expect(upstream.close).toHaveBeenCalled();
  });
});
