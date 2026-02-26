// ============================================================
// Fractured Crowns — Game Manager
// Manages all active matches, match lifecycle, and cleanup
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  MatchId,
  PlayerId,
  MatchPhase,
  GameStateSnapshot,
  MatchResult,
  MATCH_CONFIG,
} from '../types/game';
import { Match, MatchCallbacks } from './Match';

export interface GameManagerCallbacks {
  onStateUpdate: (playerId: PlayerId, snapshot: GameStateSnapshot) => void;
  onMatchEnd: (matchId: MatchId, result: MatchResult) => void;
  onPhaseChange: (matchId: MatchId, phase: MatchPhase, data?: any) => void;
}

interface PlayerMatchMapping {
  matchId: MatchId;
  playerId: PlayerId;
}

export class GameManager {
  private matches: Map<MatchId, Match> = new Map();
  private playerToMatch: Map<PlayerId, PlayerMatchMapping> = new Map();
  private callbacks: GameManagerCallbacks;

  // Stats
  private totalMatchesCreated: number = 0;
  private totalMatchesCompleted: number = 0;

  constructor(callbacks: GameManagerCallbacks) {
    this.callbacks = callbacks;

    // Periodic cleanup of stale matches
    setInterval(() => this.cleanupStaleMatches(), 60_000);
  }

  // ============================================================
  // Match Creation
  // ============================================================

  /**
   * Create a new match and add the given players to it.
   * Missing slots are filled with bots.
   */
  createMatch(
    players: Array<{ id: PlayerId; username: string }>,
    fillBots: boolean = true,
    targetPlayerCount: number = MATCH_CONFIG.MAX_PLAYERS
  ): MatchId {
    const matchId = uuidv4();

    const matchCallbacks: MatchCallbacks = {
      onStateUpdate: (playerId: PlayerId, snapshot: GameStateSnapshot) => {
        this.callbacks.onStateUpdate(playerId, snapshot);
      },
      onMatchEnd: (result: MatchResult) => {
        this.handleMatchEnd(matchId, result);
      },
      onPhaseChange: (mid: MatchId, phase: MatchPhase, data?: any) => {
        this.callbacks.onPhaseChange(mid, phase, data);
      },
    };

    const match = new Match(matchId, matchCallbacks);

    // Add human players
    for (const player of players) {
      match.addPlayer(player.id, player.username);
      this.playerToMatch.set(player.id, { matchId, playerId: player.id });
    }

    // Fill remaining slots with bots
    if (fillBots) {
      match.fillWithBots(targetPlayerCount);
    }

    this.matches.set(matchId, match);
    this.totalMatchesCreated++;

    console.log(
      `[GameManager] Match ${matchId} created with ${players.length} humans, ` +
      `${targetPlayerCount - players.length} bots. Total active: ${this.matches.size}`
    );

    return matchId;
  }

  /**
   * Start a match (generate map, enter spawn phase).
   */
  startMatch(matchId: MatchId): boolean {
    const match = this.matches.get(matchId);
    if (!match) {
      console.error(`[GameManager] Cannot start match ${matchId}: not found`);
      return false;
    }

    try {
      match.startMatch();
      console.log(`[GameManager] Match ${matchId} started`);
      return true;
    } catch (err) {
      console.error(`[GameManager] Error starting match ${matchId}:`, err);
      return false;
    }
  }

  // ============================================================
  // Player Commands
  // ============================================================

  /**
   * Route a player command to the correct match.
   */
  handlePlayerCommand(playerId: PlayerId, command: any): boolean {
    const mapping = this.playerToMatch.get(playerId);
    if (!mapping) {
      return false;
    }

    const match = this.matches.get(mapping.matchId);
    if (!match) {
      // Stale mapping — clean it up
      this.playerToMatch.delete(playerId);
      return false;
    }

    match.queueCommand(playerId, command);
    return true;
  }

  // ============================================================
  // Player Connection Management
  // ============================================================

  /**
   * Handle a player disconnecting.
   * The match will convert them to a bot after a grace period.
   */
  handlePlayerDisconnect(playerId: PlayerId): void {
    const mapping = this.playerToMatch.get(playerId);
    if (!mapping) return;

    const match = this.matches.get(mapping.matchId);
    if (!match) {
      this.playerToMatch.delete(playerId);
      return;
    }

    match.playerDisconnected(playerId);
    console.log(`[GameManager] Player ${playerId} disconnected from match ${mapping.matchId}`);
  }

  /**
   * Handle a player reconnecting to their match.
   */
  handlePlayerReconnect(playerId: PlayerId): MatchId | null {
    const mapping = this.playerToMatch.get(playerId);
    if (!mapping) return null;

    const match = this.matches.get(mapping.matchId);
    if (!match) {
      this.playerToMatch.delete(playerId);
      return null;
    }

    const phase = match.getPhase();
    if (phase === MatchPhase.Finished) {
      this.playerToMatch.delete(playerId);
      return null;
    }

    match.playerReconnected(playerId);
    console.log(`[GameManager] Player ${playerId} reconnected to match ${mapping.matchId}`);
    return mapping.matchId;
  }

  // ============================================================
  // Match Lifecycle
  // ============================================================

  private handleMatchEnd(matchId: MatchId, result: MatchResult): void {
    console.log(
      `[GameManager] Match ${matchId} ended. ` +
      `Duration: ${Math.round(result.duration)}s. ` +
      `Winner: ${result.winnerId ?? 'none'}`
    );

    this.callbacks.onMatchEnd(matchId, result);
    this.totalMatchesCompleted++;

    // Schedule cleanup after a delay so clients can see the scoreboard
    setTimeout(() => {
      this.destroyMatch(matchId);
    }, 30_000); // 30 seconds for scoreboard viewing
  }

  /**
   * Destroy a match and clean up all associated state.
   */
  destroyMatch(matchId: MatchId): void {
    const match = this.matches.get(matchId);
    if (!match) return;

    // Remove player mappings
    for (const [playerId, mapping] of this.playerToMatch) {
      if (mapping.matchId === matchId) {
        this.playerToMatch.delete(playerId);
      }
    }

    // Destroy the match instance
    match.destroy();
    this.matches.delete(matchId);

    console.log(`[GameManager] Match ${matchId} destroyed. Active matches: ${this.matches.size}`);
  }

  /**
   * Clean up matches that have been running too long or are in a bad state.
   */
  private cleanupStaleMatches(): void {
    const maxMatchDuration = 45 * 60 * 1000; // 45 minutes absolute max
    const now = Date.now();

    for (const [matchId, match] of this.matches) {
      const phase = match.getPhase();

      // Remove finished matches that somehow survived the scheduled cleanup
      if (phase === MatchPhase.Finished) {
        this.destroyMatch(matchId);
        continue;
      }

      // Forcefully end matches with no alive players
      if (phase === MatchPhase.Playing && match.getAlivePlayerCount() === 0) {
        console.log(`[GameManager] Force-ending match ${matchId}: no alive players`);
        this.destroyMatch(matchId);
        continue;
      }
    }
  }

  // ============================================================
  // Queries
  // ============================================================

  /**
   * Get the match a player is currently in.
   */
  getPlayerMatch(playerId: PlayerId): Match | null {
    const mapping = this.playerToMatch.get(playerId);
    if (!mapping) return null;

    return this.matches.get(mapping.matchId) ?? null;
  }

  /**
   * Get the match ID a player is currently in.
   */
  getPlayerMatchId(playerId: PlayerId): MatchId | null {
    const mapping = this.playerToMatch.get(playerId);
    return mapping?.matchId ?? null;
  }

  /**
   * Get a match by ID.
   */
  getMatch(matchId: MatchId): Match | null {
    return this.matches.get(matchId) ?? null;
  }

  /**
   * Check if a player is in an active match.
   */
  isPlayerInMatch(playerId: PlayerId): boolean {
    const mapping = this.playerToMatch.get(playerId);
    if (!mapping) return false;

    const match = this.matches.get(mapping.matchId);
    if (!match) {
      this.playerToMatch.delete(playerId);
      return false;
    }

    return match.getPhase() !== MatchPhase.Finished;
  }

  /**
   * Remove a player from their match mapping (e.g., when they leave).
   */
  removePlayerMapping(playerId: PlayerId): void {
    this.playerToMatch.delete(playerId);
  }

  /**
   * Get active match count.
   */
  getActiveMatchCount(): number {
    return this.matches.size;
  }

  /**
   * Get total connected player count across all matches.
   */
  getTotalPlayerCount(): number {
    return this.playerToMatch.size;
  }

  /**
   * Get server stats for health/monitoring.
   */
  getStats(): {
    activeMatches: number;
    totalPlayers: number;
    totalMatchesCreated: number;
    totalMatchesCompleted: number;
  } {
    return {
      activeMatches: this.matches.size,
      totalPlayers: this.playerToMatch.size,
      totalMatchesCreated: this.totalMatchesCreated,
      totalMatchesCompleted: this.totalMatchesCompleted,
    };
  }

  /**
   * Gracefully shut down all matches.
   */
  shutdown(): void {
    console.log(`[GameManager] Shutting down ${this.matches.size} active matches...`);
    for (const [matchId] of this.matches) {
      this.destroyMatch(matchId);
    }
  }
}
