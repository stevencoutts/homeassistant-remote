// Bridges a browser WebSocket to an upstream Home Assistant WebSocket, doing
// HA's auth handshake upstream with the real token so the token never reaches
// the browser. `browser`/`upstream` are ws-like: .send(string), .close(),
// .on('message'|'close'|'error', cb). Messages arrive as Buffer or string.
export function bridge(browser, upstream, token) {
  let upstreamAuthed = false;
  let browserAuthed = false;
  let haVersion;
  const queue = []; // browser -> upstream messages awaiting upstream auth

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
        while (queue.length) upstream.send(queue.shift());
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
        browserAuthed = true;
        browser.send(JSON.stringify({ type: 'auth_ok', ha_version: haVersion }));
      }
      return;
    }
    if (upstreamAuthed) upstream.send(text);
    else queue.push(text);
  });

  browser.on('close', () => upstream.close());
  upstream.on('close', () => browser.close());
  browser.on('error', () => upstream.close());
  upstream.on('error', () => browser.close());
}
