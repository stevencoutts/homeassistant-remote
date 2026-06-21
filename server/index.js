import { createServer } from 'node:http';
import sirv from 'sirv';
import { WebSocketServer, WebSocket } from 'ws';
import { bridge } from './bridge.js';

const PORT = Number(process.env.PORT) || 8080;
const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;
const proxyEnabled = Boolean(HA_URL && HA_TOKEN);

const serve = sirv('build', { single: true, etag: true });

const server = createServer((req, res) => {
  if (req.url === '/config.json') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-cache');
    res.end(JSON.stringify({ proxy: proxyEnabled }));
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

server.listen(PORT, () => console.log(`room-remote listening on :${PORT} (proxy ${proxyEnabled ? 'on' : 'off'})`));
