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
    expect(browser.sent).toContain(JSON.stringify({ type: 'auth_ok', ha_version: '2025.1' }));
  });

  it('queues browser commands until upstream is authed, then relays both ways', () => {
    const browser = fakeSocket();
    const upstream = fakeSocket();
    bridge(browser, upstream, 'REAL');
    upstream.emit('message', JSON.stringify({ type: 'auth_required', ha_version: '1' }));
    browser.emit('message', JSON.stringify({ type: 'auth' }));

    const sub = JSON.stringify({ id: 1, type: 'subscribe_entities' });
    browser.emit('message', sub);
    expect(upstream.sent).not.toContain(sub); // queued, upstream not authed yet

    upstream.emit('message', JSON.stringify({ type: 'auth_ok', ha_version: '1' }));
    expect(upstream.sent).toContain(sub); // flushed

    const evt = JSON.stringify({ id: 1, type: 'event' });
    upstream.emit('message', evt);
    expect(browser.sent).toContain(evt); // relayed downstream
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
