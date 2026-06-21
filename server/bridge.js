// Bridges a browser WebSocket to an upstream Home Assistant WebSocket, doing
// HA's auth handshake upstream with the real token so the token never reaches
// the browser. `browser`/`upstream` are ws-like: .send(string), .close(),
// .on('message'|'close'|'error', cb). Messages arrive as Buffer or string.
//
// home-assistant-js-websocket sends its `auth` message as soon as the socket
// opens — it does NOT wait for `auth_required`. So the browser may auth before
// the upstream HA socket has even connected. We therefore hold the browser's
// `auth_ok` until upstream auth has completed, which also guarantees `ha_version`
// is known by then (the client throws if `auth_ok` arrives without it).
export function bridge(browser, upstream, token) {
  let upstreamAuthed = false;
  let browserAuthed = false;
  let browserAuthPending = false;
  let haVersion;

  function ackBrowserIfReady() {
    if (!browserAuthed && browserAuthPending && upstreamAuthed) {
      browserAuthed = true;
      browser.send(JSON.stringify({ type: 'auth_ok', ha_version: haVersion }));
    }
  }

  upstream.on('message', (raw) => {
    const text = raw.toString();
    if (!upstreamAuthed) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.type === 'auth_required') {
        haVersion = msg.ha_version;
        upstream.send(JSON.stringify({ type: 'auth', access_token: token }));
        browser.send(JSON.stringify({ type: 'auth_required', ha_version: haVersion }));
      } else if (msg.type === 'auth_ok') {
        upstreamAuthed = true;
        ackBrowserIfReady();
      } else if (msg.type === 'auth_invalid') {
        browser.close();
        upstream.close();
      }
      return;
    }
    browser.send(text);
  });

  browser.on('message', (raw) => {
    const text = raw.toString();
    if (!browserAuthed) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.type === 'auth') {
        // Accept any token from the browser; real auth happens upstream. Don't
        // acknowledge until upstream is authed (so ha_version is populated).
        browserAuthPending = true;
        ackBrowserIfReady();
      }
      return; // ignore non-auth messages until the browser is acknowledged
    }
    upstream.send(text); // upstream is authed: browser is only acked after upstreamAuthed
  });

  browser.on('close', () => upstream.close());
  upstream.on('close', () => browser.close());
  browser.on('error', () => upstream.close());
  upstream.on('error', () => browser.close());
}
