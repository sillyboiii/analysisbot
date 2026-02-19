import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { getSnapshot, getHistory } from './store';

const DEFAULT_PORT = 3000;

export interface WebServer {
  io: SocketIOServer;
  start: () => void;
}

/**
 * Creates and configures the Express + Socket.IO web server.
 *
 * Serves the dashboard from /public and exposes:
 *   GET  /api/latest    → latest scan snapshot
 *   GET  /api/history   → last 20 runs
 *
 * Emits via Socket.IO:
 *   'scan:start'        → scan started
 *   'scan:complete'     → new results ready (payload: snapshot)
 *   'scan:error'        → scan failed (payload: { message })
 */
export function createWebServer(): WebServer {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));

  // ── REST API ──────────────────────────────────────────────────────────────

  app.get('/api/latest', (_req, res) => {
    res.json(getSnapshot());
  });

  app.get('/api/history', (_req, res) => {
    res.json(getHistory());
  });

  // Fallback → serve index.html (SPA)
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    // Send current state immediately on connect
    socket.emit('init', getSnapshot());
  });

  // ── Start ─────────────────────────────────────────────────────────────────

  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  function start() {
    httpServer.listen(port, () => {
      console.log(`  Dashboard → http://localhost:${port}`);
    });
  }

  return { io, start };
}
