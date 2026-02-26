// ============================================================
// Fractured Crowns — Lobby / Queue Manager
// Handles matchmaking queue, lobby creation, and match launching
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  PlayerId,
  MatchId,
  QueueEntry,
  LobbyState,
  MATCH_CONFIG,
} from '../types/game';

export interface LobbyManagerCallbacks {
  onMatchReady: (
    players: Array<{ id: PlayerId; username: string; socketId: string }>,
    lobbyId: string
  ) => void;
  onLobbyUpdate: (socketIds: string[], state: LobbyState) => void;
}

interface Lobby {
  id: string;
  players: QueueEntry[];
  createdAt: number;
  countdownStarted: boolean;
  countdownEndTime: number;
}

export class LobbyManager {
  private queue: QueueEntry[] = [];
  private activeLobby: Lobby | null = null;
  private callbacks: LobbyManagerCallbacks;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  // Track which players are in queue (by socketId for fast lookup)
  private playerSocketMap: Map<string, PlayerId> = new Map(); // socketId -> playerId
  private playerInQueue: Set<PlayerId> = new Set();

  constructor(callbacks: LobbyManagerCallbacks) {
    this.callbacks = callbacks;

    // Start the lobby tick loop (checks every second)
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 1000);
  }

  // ============================================================
  // Queue Management
  // ============================================================

  /**
   * Add a player to the matchmaking queue.
   * Returns lobby state info for the client.
   */
  joinQueue(playerId: PlayerId, username: string, socketId: string): LobbyState | null {
    // Don't allow duplicate joins
    if (this.playerInQueue.has(playerId)) {
      // Already in queue — return current lobby state
      return this.getLobbyState();
    }

    const entry: QueueEntry = {
      playerId,
      username,
      joinedAt: Date.now(),
      socketId,
    };

    this.queue.push(entry);
    this.playerInQueue.add(playerId);
    this.playerSocketMap.set(socketId, playerId);

    console.log(
      `[LobbyManager] Player ${username} (${playerId}) joined queue. ` +
      `Queue size: ${this.queue.length}`
    );

    // Ensure we have an active lobby
    if (!this.activeLobby) {
      this.createLobby();
    }

    // Add player to active lobby
    if (this.activeLobby) {
      this.activeLobby.players.push(entry);

      // Check if lobby is full
      if (this.activeLobby.players.length >= MATCH_CONFIG.MAX_PLAYERS) {
        this.launchLobby();
        return this.getLobbyState();
      }

      // Start countdown if we have minimum players and countdown hasn't started
      if (
        this.activeLobby.players.length >= MATCH_CONFIG.QUEUE_MIN_PLAYERS &&
        !this.activeLobby.countdownStarted
      ) {
        this.startCountdown();
      }
    }

    // Broadcast updated lobby state
    this.broadcastLobbyState();

    return this.getLobbyState();
  }

  /**
   * Remove a player from the queue.
   */
  leaveQueue(playerId: PlayerId, socketId: string): void {
    // Remove from queue array
    this.queue = this.queue.filter(e => e.playerId !== playerId);
    this.playerInQueue.delete(playerId);
    this.playerSocketMap.delete(socketId);

    // Remove from active lobby
    if (this.activeLobby) {
      this.activeLobby.players = this.activeLobby.players.filter(
        e => e.playerId !== playerId
      );

      // If lobby is now empty, destroy it
      if (this.activeLobby.players.length === 0) {
        this.activeLobby = null;
      }
    }

    console.log(
      `[LobbyManager] Player ${playerId} left queue. Queue size: ${this.queue.length}`
    );

    // Broadcast updated state
    this.broadcastLobbyState();
  }

  /**
   * Handle a socket disconnecting — remove from queue.
   */
  handleDisconnect(socketId: string): void {
    const playerId = this.playerSocketMap.get(socketId);
    if (playerId) {
      this.leaveQueue(playerId, socketId);
    }
  }

  // ============================================================
  // Lobby Management
  // ============================================================

  private createLobby(): void {
    this.activeLobby = {
      id: uuidv4(),
      players: [],
      createdAt: Date.now(),
      countdownStarted: false,
      countdownEndTime: 0,
    };

    console.log(`[LobbyManager] New lobby created: ${this.activeLobby.id}`);
  }

  private startCountdown(): void {
    if (!this.activeLobby) return;

    this.activeLobby.countdownStarted = true;
    this.activeLobby.countdownEndTime =
      Date.now() + MATCH_CONFIG.QUEUE_WAIT_TIME * 1000;

    console.log(
      `[LobbyManager] Countdown started for lobby ${this.activeLobby.id}. ` +
      `${MATCH_CONFIG.QUEUE_WAIT_TIME}s until launch.`
    );
  }

  /**
   * Launch the current lobby as a match.
   */
  private launchLobby(): void {
    if (!this.activeLobby) return;

    const lobby = this.activeLobby;
    const players = lobby.players.map(e => ({
      id: e.playerId,
      username: e.username,
      socketId: e.socketId,
    }));

    console.log(
      `[LobbyManager] Launching lobby ${lobby.id} with ${players.length} players`
    );

    // Remove launched players from queue tracking
    for (const player of lobby.players) {
      this.queue = this.queue.filter(e => e.playerId !== player.playerId);
      this.playerInQueue.delete(player.playerId);
      this.playerSocketMap.delete(player.socketId);
    }

    // Clear the active lobby
    this.activeLobby = null;

    // Notify the system to create a match
    this.callbacks.onMatchReady(players, lobby.id);

    // If there are still players in the queue, create a new lobby
    if (this.queue.length > 0) {
      this.createLobby();
      // Move remaining queue players into the new lobby
      for (const entry of this.queue) {
        this.activeLobby!.players.push(entry);
      }
      if (this.activeLobby!.players.length >= MATCH_CONFIG.QUEUE_MIN_PLAYERS) {
        this.startCountdown();
      }
      this.broadcastLobbyState();
    }
  }

  // ============================================================
  // Tick Loop
  // ============================================================

  private tick(): void {
    if (!this.activeLobby) return;

    // Check if countdown has expired
    if (
      this.activeLobby.countdownStarted &&
      Date.now() >= this.activeLobby.countdownEndTime
    ) {
      // Only launch if we have minimum players
      if (this.activeLobby.players.length >= MATCH_CONFIG.QUEUE_MIN_PLAYERS) {
        this.launchLobby();
        return;
      } else {
        // Not enough players — reset countdown
        this.activeLobby.countdownStarted = false;
        this.activeLobby.countdownEndTime = 0;
      }
    }

    // Check if lobby is full
    if (this.activeLobby.players.length >= MATCH_CONFIG.MAX_PLAYERS) {
      this.launchLobby();
      return;
    }

    // Broadcast periodic updates
    this.broadcastLobbyState();
  }

  // ============================================================
  // State Broadcasting
  // ============================================================

  private broadcastLobbyState(): void {
    if (!this.activeLobby) return;

    const state = this.getLobbyState();
    const socketIds = this.activeLobby.players.map(p => p.socketId);

    this.callbacks.onLobbyUpdate(socketIds, state);
  }

  /**
   * Get current lobby state for clients.
   */
  getLobbyState(): LobbyState {
    if (!this.activeLobby) {
      return {
        playerCount: 0,
        maxPlayers: MATCH_CONFIG.MAX_PLAYERS,
        timeUntilStart: MATCH_CONFIG.QUEUE_WAIT_TIME,
      };
    }

    let timeUntilStart = MATCH_CONFIG.QUEUE_WAIT_TIME;
    if (this.activeLobby.countdownStarted) {
      timeUntilStart = Math.max(
        0,
        Math.ceil((this.activeLobby.countdownEndTime - Date.now()) / 1000)
      );
    }

    return {
      playerCount: this.activeLobby.players.length,
      maxPlayers: MATCH_CONFIG.MAX_PLAYERS,
      timeUntilStart,
    };
  }

  // ============================================================
  // Queries
  // ============================================================

  /**
   * Check if a player is currently in the queue.
   */
  isPlayerInQueue(playerId: PlayerId): boolean {
    return this.playerInQueue.has(playerId);
  }

  /**
   * Get total queue size.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get the active lobby player count.
   */
  getActiveLobbyPlayerCount(): number {
    return this.activeLobby?.players.length ?? 0;
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Gracefully shut down the lobby manager.
   */
  shutdown(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    this.queue.length = 0;
    this.playerInQueue.clear();
    this.playerSocketMap.clear();
    this.activeLobby = null;

    console.log('[LobbyManager] Shut down');
  }
}
