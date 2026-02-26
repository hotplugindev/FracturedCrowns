// ============================================================
// Fractured Crowns — Main Server Entry Point
// Express health routes + Socket.IO WebSocket server
// ============================================================

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { SocketHandler } from './network/SocketHandler';

// ---- Configuration ----

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---- Express App ----

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
}));

app.use(express.json());

// ---- Health & Info Routes ----

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: NODE_ENV,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

app.get('/api/stats', (_req, res) => {
  if (!socketHandler) {
    res.json({ error: 'Server not ready' });
    return;
  }

  const gameManager = socketHandler.getGameManager();
  const lobbyManager = socketHandler.getLobbyManager();
  const stats = gameManager.getStats();

  res.json({
    server: {
      uptime: Math.round(process.uptime()),
      connections: socketHandler.getConnectedCount(),
      environment: NODE_ENV,
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    },
    game: {
      activeMatches: stats.activeMatches,
      totalPlayers: stats.totalPlayers,
      totalMatchesCreated: stats.totalMatchesCreated,
      totalMatchesCompleted: stats.totalMatchesCompleted,
      queueSize: lobbyManager.getQueueSize(),
      lobbyPlayers: lobbyManager.getActiveLobbyPlayerCount(),
    },
  });
});

app.get('/api/info', (_req, res) => {
  res.json({
    name: 'Fractured Crowns',
    version: '1.0.0',
    description: 'Real-time multiplayer browser strategy game',
    maxPlayers: 20,
    matchDuration: '20-30 minutes',
    features: [
      'Real-time strategy gameplay',
      'Territory capture & supply lines',
      'Economy with expansion penalty',
      'Multiple unit types',
      'Building construction',
      'Bot AI opponents',
      'Fog of war',
      'WebSocket networking',
    ],
  });
});

// ---- HTTP Server ----

const httpServer = createServer(app);

// ---- Socket.IO Handler ----

let socketHandler: SocketHandler;

try {
  socketHandler = new SocketHandler(httpServer);
} catch (err) {
  console.error('[Server] Failed to initialize SocketHandler:', err);
  process.exit(1);
}

// ---- Start Listening ----

httpServer.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║                                                      ║');
  console.log('║            ⚔️  FRACTURED CROWNS  ⚔️                  ║');
  console.log('║          Real-Time Multiplayer Strategy               ║');
  console.log('║                                                      ║');
  console.log(`║  Server running on http://${HOST}:${PORT}              `);
  console.log(`║  Environment: ${NODE_ENV}                              `);
  console.log(`║  WebSocket: ready                                     `);
  console.log('║                                                      ║');
  console.log('║  Health:  GET /api/health                             ║');
  console.log('║  Stats:   GET /api/stats                              ║');
  console.log('║  Info:    GET /api/info                               ║');
  console.log('║                                                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

// ---- Graceful Shutdown ----

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  try {
    // Shut down socket handler (which shuts down game manager and lobby manager)
    if (socketHandler) {
      await socketHandler.shutdown();
    }

    // Close HTTP server
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('[Server] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  // Don't crash on uncaught exceptions in production
  if (NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
});

export { app, httpServer, socketHandler };
