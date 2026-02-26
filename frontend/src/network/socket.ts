// ============================================================
// Fractured Crowns — Socket.IO Client Wrapper
// Manages all WebSocket communication with the game server
// ============================================================

import { io, Socket } from 'socket.io-client';
import type {
  PlayerId,
  MatchId,
  MatchPhase,
  GameCommand,
  GameStateSnapshot,
  LobbyState,
  MatchResult,
  ServerInfo,
} from '../types/game';

// ---- Event Types ----

export interface SocketEvents {
  onQueueJoined: (data: { playerId: PlayerId; lobbyState: LobbyState }) => void;
  onLobbyUpdate: (state: LobbyState) => void;
  onMatchStarting: (data: { matchId: MatchId; playerId: PlayerId }) => void;
  onPhaseChange: (data: { matchId: MatchId; phase: MatchPhase; data?: any }) => void;
  onGameState: (snapshot: GameStateSnapshot) => void;
  onMatchEnded: (result: MatchResult) => void;
  onMapData: (data: { width: number; height: number; terrain: string[][] }) => void;
  onError: (data: { message: string; code?: string }) => void;
  onServerInfo: (data: ServerInfo) => void;
  onConnect: () => void;
  onDisconnect: (reason: string) => void;
}

// ---- Socket Client Singleton ----

class SocketClient {
  private socket: Socket | null = null;
  private listeners: Partial<SocketEvents> = {};
  private _connected: boolean = false;
  private _playerId: PlayerId | null = null;
  private _matchId: MatchId | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  /**
   * Connect to the game server.
   */
  connect(url?: string): void {
    if (this.socket?.connected) {
      console.log('[Socket] Already connected');
      return;
    }

    // Determine server URL
    const serverUrl = url || this.getServerUrl();

    console.log(`[Socket] Connecting to ${serverUrl}...`);

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: true,
    });

    this.setupEventHandlers();
  }

  /**
   * Determine the server URL based on the current environment.
   */
  private getServerUrl(): string {
    // In production, connect to the same host (nginx proxies /socket.io to backend)
    if (import.meta.env.PROD) {
      return window.location.origin;
    }

    // In development, connect to the backend directly
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    return backendUrl;
  }

  /**
   * Set up all Socket.IO event handlers.
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // ---- Connection Events ----

    this.socket.on('connect', () => {
      console.log('[Socket] Connected');
      this._connected = true;
      this.reconnectAttempts = 0;
      this.listeners.onConnect?.();
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log(`[Socket] Disconnected: ${reason}`);
      this._connected = false;
      this.listeners.onDisconnect?.(reason);
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('[Socket] Connection error:', error.message);
      this.reconnectAttempts++;
    });

    // ---- Queue/Lobby Events ----

    this.socket.on('queue_joined', (data: { playerId: PlayerId; lobbyState: LobbyState }) => {
      this._playerId = data.playerId;
      console.log(`[Socket] Joined queue as ${data.playerId}`);
      this.listeners.onQueueJoined?.(data);
    });

    this.socket.on('lobby_update', (state: LobbyState) => {
      this.listeners.onLobbyUpdate?.(state);
    });

    // ---- Match Events ----

    this.socket.on('match_starting', (data: { matchId: MatchId; playerId: PlayerId }) => {
      this._matchId = data.matchId;
      this._playerId = data.playerId;
      console.log(`[Socket] Match starting: ${data.matchId}`);
      this.listeners.onMatchStarting?.(data);
    });

    this.socket.on('phase_change', (data: { matchId: MatchId; phase: MatchPhase; data?: any }) => {
      console.log(`[Socket] Phase change: ${data.phase}`);
      this.listeners.onPhaseChange?.(data);
    });

    this.socket.on('game_state', (snapshot: GameStateSnapshot) => {
      this.listeners.onGameState?.(snapshot);
    });

    this.socket.on('match_ended', (result: MatchResult) => {
      console.log('[Socket] Match ended');
      this.listeners.onMatchEnded?.(result);
    });

    // ---- Map Data ----

    this.socket.on('map_data', (data: { width: number; height: number; terrain: string[][] }) => {
      console.log(`[Socket] Received map data: ${data.width}x${data.height}`);
      this.listeners.onMapData?.(data);
    });

    // ---- Errors ----

    this.socket.on('error', (data: { message: string; code?: string }) => {
      console.error(`[Socket] Server error: ${data.message} (${data.code})`);
      this.listeners.onError?.(data);
    });

    // ---- Server Info ----

    this.socket.on('server_info', (data: ServerInfo) => {
      this.listeners.onServerInfo?.(data);
    });
  }

  // ============================================================
  // Client-to-Server Actions
  // ============================================================

  /**
   * Join the matchmaking queue with a username.
   */
  joinQueue(username: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Not connected');
      return;
    }

    this.socket.emit('join_queue', { username });
  }

  /**
   * Leave the matchmaking queue.
   */
  leaveQueue(): void {
    if (!this.socket?.connected) return;
    this.socket.emit('leave_queue');
  }

  /**
   * Send a game command to the server.
   */
  sendCommand(command: GameCommand): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Not connected — cannot send command');
      return;
    }

    this.socket.emit('game_command', { command });
  }

  /**
   * Request full map data (used during spawn selection).
   */
  requestMap(): void {
    if (!this.socket?.connected) return;
    this.socket.emit('request_map');
  }

  /**
   * Ping the server and get latency.
   */
  ping(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const start = Date.now();
      this.socket.emit('ping', (serverTime: number) => {
        const latency = Date.now() - start;
        resolve(latency);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Ping timeout'));
      }, 5000);
    });
  }

  // ============================================================
  // Event Listener Management
  // ============================================================

  /**
   * Register event listeners. Can be called multiple times to update listeners.
   */
  on(events: Partial<SocketEvents>): void {
    this.listeners = { ...this.listeners, ...events };
  }

  /**
   * Remove specific event listeners.
   */
  off(eventNames: (keyof SocketEvents)[]): void {
    for (const name of eventNames) {
      delete this.listeners[name];
    }
  }

  /**
   * Remove all event listeners.
   */
  offAll(): void {
    this.listeners = {};
  }

  // ============================================================
  // State Accessors
  // ============================================================

  get connected(): boolean {
    return this._connected;
  }

  get playerId(): PlayerId | null {
    return this._playerId;
  }

  get matchId(): MatchId | null {
    return this._matchId;
  }

  get socketId(): string | null {
    return this.socket?.id ?? null;
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._connected = false;
    this._playerId = null;
    this._matchId = null;
    this.reconnectAttempts = 0;
    console.log('[Socket] Disconnected manually');
  }

  /**
   * Reset state (e.g., after match ends to go back to landing page).
   */
  resetMatchState(): void {
    this._matchId = null;
  }
}

// Export a singleton instance
export const socketClient = new SocketClient();
