// ============================================================
// Fractured Crowns — Socket.IO Network Handler
// Manages all client-server WebSocket communication
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  PlayerId,
  MatchId,
  MatchPhase,
  GameCommand,
  GameStateSnapshot,
  LobbyState,
  MatchResult,
  CommandType,
  MATCH_CONFIG,
} from '../types/game';
import { GameManager, GameManagerCallbacks } from '../game/GameManager';
import { LobbyManager, LobbyManagerCallbacks } from '../lobby/LobbyManager';

// ---- Client-to-Server Events ----

interface ClientToServerEvents {
  join_queue: (data: { username: string }) => void;
  leave_queue: () => void;
  game_command: (data: { command: GameCommand }) => void;
  request_map: () => void;
  ping: (callback: (timestamp: number) => void) => void;
}

// ---- Server-to-Client Events ----

interface ServerToClientEvents {
  queue_joined: (data: { playerId: PlayerId; lobbyState: LobbyState }) => void;
  lobby_update: (state: LobbyState) => void;
  match_starting: (data: { matchId: MatchId; playerId: PlayerId }) => void;
  phase_change: (data: { matchId: MatchId; phase: MatchPhase; data?: any }) => void;
  game_state: (snapshot: GameStateSnapshot) => void;
  match_ended: (result: MatchResult) => void;
  map_data: (data: { width: number; height: number; terrain: string[][] }) => void;
  error: (data: { message: string; code?: string }) => void;
  server_info: (data: { activeMatches: number; queueSize: number; totalPlayers: number }) => void;
}

// ---- Socket Data ----

interface SocketData {
  playerId: PlayerId;
  username: string;
  matchId: MatchId | null;
  inQueue: boolean;
}

export class SocketHandler {
  private io: Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
  private gameManager: GameManager;
  private lobbyManager: LobbyManager;

  // Map socket IDs to player IDs for reverse lookups
  private socketToPlayer: Map<string, PlayerId> = new Map();
  private playerToSocket: Map<PlayerId, string> = new Map();

  constructor(httpServer: HttpServer) {
    // Initialize Socket.IO
    this.io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      pingInterval: 10000,
      pingTimeout: 20000,
      maxHttpBufferSize: 1e6, // 1MB max message size
      transports: ['websocket', 'polling'],
    });

    // Initialize GameManager
    const gameManagerCallbacks: GameManagerCallbacks = {
      onStateUpdate: (playerId, snapshot) => this.sendGameState(playerId, snapshot),
      onMatchEnd: (matchId, result) => this.handleMatchEnd(matchId, result),
      onPhaseChange: (matchId, phase, data) => this.handlePhaseChange(matchId, phase, data),
    };
    this.gameManager = new GameManager(gameManagerCallbacks);

    // Initialize LobbyManager
    const lobbyManagerCallbacks: LobbyManagerCallbacks = {
      onMatchReady: (players, lobbyId) => this.handleMatchReady(players, lobbyId),
      onLobbyUpdate: (socketIds, state) => this.broadcastLobbyUpdate(socketIds, state),
    };
    this.lobbyManager = new LobbyManager(lobbyManagerCallbacks);

    // Set up connection handling
    this.setupConnectionHandlers();

    // Periodic server info broadcast
    setInterval(() => {
      this.broadcastServerInfo();
    }, 5000);

    console.log('[SocketHandler] Initialized');
  }

  // ============================================================
  // Connection Handlers
  // ============================================================

  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`[SocketHandler] Client connected: ${socket.id}`);

      // Initialize socket data
      socket.data.playerId = '';
      socket.data.username = '';
      socket.data.matchId = null;
      socket.data.inQueue = false;

      // ---- Join Queue ----
      socket.on('join_queue', (data) => {
        this.handleJoinQueue(socket, data);
      });

      // ---- Leave Queue ----
      socket.on('leave_queue', () => {
        this.handleLeaveQueue(socket);
      });

      // ---- Game Command ----
      socket.on('game_command', (data) => {
        this.handleGameCommand(socket, data);
      });

      // ---- Request Map ----
      socket.on('request_map', () => {
        this.handleRequestMap(socket);
      });

      // ---- Ping ----
      socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
          callback(Date.now());
        }
      });

      // ---- Disconnect ----
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });

      // ---- Error ----
      socket.on('error', (err) => {
        console.error(`[SocketHandler] Socket error for ${socket.id}:`, err);
      });
    });
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  private handleJoinQueue(socket: Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>, data: { username: string }): void {
    try {
      const { username } = data;

      // Validate username
      if (!username || typeof username !== 'string') {
        socket.emit('error', { message: 'Username is required', code: 'INVALID_USERNAME' });
        return;
      }

      const trimmedUsername = username.trim().substring(0, 20);
      if (trimmedUsername.length < 1) {
        socket.emit('error', { message: 'Username must be at least 1 character', code: 'INVALID_USERNAME' });
        return;
      }

      // Check if player is already in a match
      const existingPlayerId = this.socketToPlayer.get(socket.id);
      if (existingPlayerId && this.gameManager.isPlayerInMatch(existingPlayerId)) {
        // Try to reconnect
        const matchId = this.gameManager.handlePlayerReconnect(existingPlayerId);
        if (matchId) {
          socket.data.playerId = existingPlayerId;
          socket.data.matchId = matchId;
          socket.join(`match:${matchId}`);
          socket.emit('match_starting', { matchId, playerId: existingPlayerId });
          return;
        }
      }

      // Generate new player ID
      const playerId = existingPlayerId || uuidv4();
      socket.data.playerId = playerId;
      socket.data.username = trimmedUsername;
      socket.data.inQueue = true;

      // Register socket mapping
      this.socketToPlayer.set(socket.id, playerId);
      this.playerToSocket.set(playerId, socket.id);

      // Join the queue
      const lobbyState = this.lobbyManager.joinQueue(playerId, trimmedUsername, socket.id);

      // Send confirmation
      socket.emit('queue_joined', {
        playerId,
        lobbyState: lobbyState || {
          playerCount: 0,
          maxPlayers: MATCH_CONFIG.MAX_PLAYERS,
          timeUntilStart: MATCH_CONFIG.QUEUE_WAIT_TIME,
        },
      });

      console.log(`[SocketHandler] ${trimmedUsername} (${playerId}) joined queue via socket ${socket.id}`);
    } catch (err) {
      console.error('[SocketHandler] Error in handleJoinQueue:', err);
      socket.emit('error', { message: 'Failed to join queue', code: 'QUEUE_ERROR' });
    }
  }

  private handleLeaveQueue(socket: Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) return;

      this.lobbyManager.leaveQueue(playerId, socket.id);
      socket.data.inQueue = false;

      console.log(`[SocketHandler] ${playerId} left queue`);
    } catch (err) {
      console.error('[SocketHandler] Error in handleLeaveQueue:', err);
    }
  }

  private handleGameCommand(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>,
    data: { command: GameCommand }
  ): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        socket.emit('error', { message: 'Not authenticated', code: 'NOT_AUTH' });
        return;
      }

      const { command } = data;
      if (!command || !command.type) {
        socket.emit('error', { message: 'Invalid command', code: 'INVALID_COMMAND' });
        return;
      }

      // Validate command type
      const validTypes = Object.values(CommandType);
      if (!validTypes.includes(command.type)) {
        socket.emit('error', { message: 'Unknown command type', code: 'INVALID_COMMAND' });
        return;
      }

      // Route to game manager
      const handled = this.gameManager.handlePlayerCommand(playerId, command);
      if (!handled) {
        socket.emit('error', { message: 'Not in an active match', code: 'NO_MATCH' });
      }
    } catch (err) {
      console.error('[SocketHandler] Error in handleGameCommand:', err);
    }
  }

  private handleRequestMap(socket: Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) return;

      const match = this.gameManager.getPlayerMatch(playerId);
      if (!match) return;

      const mapData = match.getFullMapForSpawn();
      socket.emit('map_data', {
        width: mapData.width,
        height: mapData.height,
        terrain: mapData.terrain,
      });
    } catch (err) {
      console.error('[SocketHandler] Error in handleRequestMap:', err);
    }
  }

  private handleDisconnect(socket: Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>, reason: string): void {
    try {
      const playerId = socket.data.playerId;
      console.log(`[SocketHandler] Client disconnected: ${socket.id} (${playerId || 'unknown'}), reason: ${reason}`);

      if (!playerId) return;

      // Remove from queue if in queue
      if (socket.data.inQueue) {
        this.lobbyManager.handleDisconnect(socket.id);
      }

      // Notify game manager of disconnect
      this.gameManager.handlePlayerDisconnect(playerId);

      // Clean up socket mappings
      this.socketToPlayer.delete(socket.id);
      // Don't immediately remove playerToSocket — player might reconnect
      // We'll clean it up when the match ends or after a timeout
      setTimeout(() => {
        const currentSocketId = this.playerToSocket.get(playerId);
        if (currentSocketId === socket.id) {
          this.playerToSocket.delete(playerId);
          this.gameManager.removePlayerMapping(playerId);
        }
      }, 120_000); // 2 minute grace period for reconnection
    } catch (err) {
      console.error('[SocketHandler] Error in handleDisconnect:', err);
    }
  }

  // ============================================================
  // Lobby → Match Transition
  // ============================================================

  private handleMatchReady(
    players: Array<{ id: PlayerId; username: string; socketId: string }>,
    lobbyId: string
  ): void {
    try {
      console.log(`[SocketHandler] Match ready from lobby ${lobbyId} with ${players.length} players`);

      // Create the match
      const matchId = this.gameManager.createMatch(
        players.map(p => ({ id: p.id, username: p.username })),
        true, // fill with bots
        MATCH_CONFIG.MAX_PLAYERS
      );

      // Notify all human players
      for (const player of players) {
        const socketId = this.playerToSocket.get(player.id) ?? player.socketId;
        const socket = this.io.sockets.sockets.get(socketId);

        if (socket) {
          socket.data.matchId = matchId;
          socket.data.inQueue = false;
          socket.join(`match:${matchId}`);

          socket.emit('match_starting', {
            matchId,
            playerId: player.id,
          });
        }
      }

      // Start the match
      this.gameManager.startMatch(matchId);
    } catch (err) {
      console.error('[SocketHandler] Error in handleMatchReady:', err);
    }
  }

  // ============================================================
  // Game State Broadcasting
  // ============================================================

  private sendGameState(playerId: PlayerId, snapshot: GameStateSnapshot): void {
    const socketId = this.playerToSocket.get(playerId);
    if (!socketId) return;

    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return;

    socket.emit('game_state', snapshot);
  }

  private handlePhaseChange(matchId: MatchId, phase: MatchPhase, data?: any): void {
    this.io.to(`match:${matchId}`).emit('phase_change', {
      matchId,
      phase,
      data,
    });

    console.log(`[SocketHandler] Match ${matchId} phase changed to ${phase}`);
  }

  private handleMatchEnd(matchId: MatchId, result: MatchResult): void {
    this.io.to(`match:${matchId}`).emit('match_ended', result);

    console.log(`[SocketHandler] Match ${matchId} ended. Broadcasting results.`);

    // Clean up room after a delay
    setTimeout(() => {
      const room = this.io.sockets.adapter.rooms.get(`match:${matchId}`);
      if (room) {
        for (const socketId of room) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.leave(`match:${matchId}`);
            socket.data.matchId = null;
          }
        }
      }
    }, 35_000);
  }

  // ============================================================
  // Lobby Broadcasting
  // ============================================================

  private broadcastLobbyUpdate(socketIds: string[], state: LobbyState): void {
    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('lobby_update', state);
      }
    }
  }

  // ============================================================
  // Server Info Broadcasting
  // ============================================================

  private broadcastServerInfo(): void {
    const stats = this.gameManager.getStats();
    const queueSize = this.lobbyManager.getQueueSize();

    // Only emit to sockets not in a match
    for (const [, socket] of this.io.sockets.sockets) {
      if (!socket.data.matchId) {
        socket.emit('server_info', {
          activeMatches: stats.activeMatches,
          queueSize,
          totalPlayers: stats.totalPlayers,
        });
      }
    }
  }

  // ============================================================
  // Accessors
  // ============================================================

  getIO(): Server {
    return this.io;
  }

  getGameManager(): GameManager {
    return this.gameManager;
  }

  getLobbyManager(): LobbyManager {
    return this.lobbyManager;
  }

  getConnectedCount(): number {
    return this.io.sockets.sockets.size;
  }

  // ============================================================
  // Shutdown
  // ============================================================

  async shutdown(): Promise<void> {
    console.log('[SocketHandler] Shutting down...');

    this.lobbyManager.shutdown();
    this.gameManager.shutdown();

    // Close all connections
    this.io.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      this.io.close(() => resolve());
    });

    this.socketToPlayer.clear();
    this.playerToSocket.clear();

    console.log('[SocketHandler] Shut down complete');
  }
}
