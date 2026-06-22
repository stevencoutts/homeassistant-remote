import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import sirv from 'sirv';
import { WebSocketServer, WebSocket } from 'ws';
import { bridge } from './bridge.js';

const PORT = Number(process.env.PORT) || 8080;
const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;
const proxyEnabled = Boolean(HA_URL && HA_TOKEN);

// Optional Emby Live TV proxy. The API key is injected server-side (as the
// X-Emby-Token header) so it never reaches a browser, mirroring the HA token.
const EMBY_URL = process.env.EMBY_URL;
const EMBY_API_KEY = process.env.EMBY_API_KEY;
const embyEnabled = Boolean(EMBY_URL && EMBY_API_KEY);

const serve = sirv('build', { single: true, etag: true });

const server = createServer((req, res) => {
  if (req.url === '/config.json') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-cache');
    res.end(JSON.stringify({ proxy: proxyEnabled, emby: embyEnabled }));
    return;
  }
  // Proxy Emby Live TV API. /emby/<path> -> EMBY_URL/<path> with the API key
  // added server-side. Forwards method, query and body (POST for play commands).
  if (embyEnabled && req.url?.startsWith('/emby/')) {
    const target = new URL(req.url.slice('/emby'.length), EMBY_URL);
    // Pass the key as both the header and the api_key query param. The query
    // form survives a reverse proxy that strips custom headers (a common cause
    // of 401s from the X-Emby-Token header alone).
    if (!target.searchParams.has('api_key')) target.searchParams.set('api_key', EMBY_API_KEY);
    const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = lib(
      target,
      {
        method: req.method,
        headers: {
          'X-Emby-Token': EMBY_API_KEY,
          accept: 'application/json',
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {})
        }
      },
      (r) => {
        res.writeHead(r.statusCode ?? 200, {
          'content-type': r.headers['content-type'] ?? 'application/json',
          'cache-control': 'no-cache'
        });
        r.pipe(res);
      }
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }
  // Proxy HA media thumbnail URLs (entity_picture is HA-relative).
  if (proxyEnabled && req.url?.startsWith('/api/')) {
    const target = new URL(req.url, HA_URL);
    const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = lib(target, { headers: { Authorization: `Bearer ${HA_TOKEN}` } }, (r) => {
      res.writeHead(r.statusCode ?? 200, {
        'content-type': r.headers['content-type'] ?? 'application/octet-stream',
        'cache-control': 'max-age=60'
      });
      r.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    upstream.end();
    return;
  }
  serve(req, res);
});

if (proxyEnabled) {
  // http(s)://host:port -> ws(s)://host:port/api/websocket
  const upstreamUrl = HA_URL.replace(/\/$/, '').replace(/^http/, 'ws') + '/api/websocket';
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/api/websocket') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (browser) => {
      bridge(browser, new WebSocket(upstreamUrl), HA_TOKEN);
    });
  });
  console.log(`room-remote: proxying /api/websocket -> ${upstreamUrl}`);
} else {
  console.log('room-remote: no HA_URL/HA_TOKEN — serving static only (devices use their own setup)');
}

server.listen(PORT, () =>
  console.log(
    `room-remote listening on :${PORT} (proxy ${proxyEnabled ? 'on' : 'off'}, emby ${embyEnabled ? 'on' : 'off'})`
  )
);
