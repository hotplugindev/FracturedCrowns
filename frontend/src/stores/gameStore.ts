// ============================================================
// Fractured Crowns — Pinia Game Store
// Central client-side state management for all game data
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type {
  PlayerId,
  MatchId,
  MatchPhase,
  GameStateSnapshot,
  VisibleTile,
  SquadSnapshot,
  PlayerPublicInfo,
  GameEvent,
  LobbyState,
  MatchResult,
  ServerInfo,
  SquadId,
  TerrainType,
} from '../types/game';
import {
  CommandType,
  StructureType,
  UnitType,
} from '../types/game';
import { socketClient } from '../network/socket';

// ---- App Screen State ----

export enum AppScreen {
  Landing = 'landing',
  Queue = 'queue',
  SpawnSelection = 'spawn_selection',
  Game = 'game',
  Scoreboard = 'scoreboard',
}

// ---- Build Mode State ----

export interface BuildMode {
  active: boolean;
  structureType: StructureType | null;
}

// ---- Selection State ----

export interface SelectionState {
  selectedSquadIds: SquadId[];
  hoveredTileX: number;
  hoveredTileY: number;
}

// ============================================================
// Game Store
// ============================================================

export const useGameStore = defineStore('game', () => {
  // ---- App State ----
  const screen = ref<AppScreen>(AppScreen.Landing);
  const username = ref<string>('');
  const connected = ref<boolean>(false);
  const error = ref<string | null>(null);
  const errorTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

  // ---- Player Identity ----
  const playerId = ref<PlayerId | null>(null);
  const matchId = ref<MatchId | null>(null);

  // ---- Lobby / Queue State ----
  const lobbyState = ref<LobbyState>({
    playerCount: 0,
    maxPlayers: 20,
    timeUntilStart: 180,
  });

  // ---- Server Info ----
  const serverInfo = ref<ServerInfo>({
    activeMatches: 0,
    queueSize: 0,
    totalPlayers: 0,
  });

  // ---- Match State ----
  const phase = ref<MatchPhase | null>(null);
  const tick = ref<number>(0);
  const timeRemaining = ref<number>(0);

  // ---- Economy ----
  const myGold = ref<number>(0);
  const myGoldPerSecond = ref<number>(0);

  // ---- Players ----
  const players = ref<PlayerPublicInfo[]>([]);

  // ---- Map Data (terrain only, for spawn screen) ----
  const mapWidth = ref<number>(120);
  const mapHeight = ref<number>(120);
  const mapTerrain = shallowRef<string[][] | null>(null);

  // ---- Visible Tiles (from game state) ----
  const visibleTiles = shallowRef<Map<string, VisibleTile>>(new Map());

  // ---- Squads ----
  const squads = shallowRef<SquadSnapshot[]>([]);

  // ---- Game Events (from latest tick) ----
  const gameEvents = ref<GameEvent[]>([]);

  // ---- Event Log (accumulated) ----
  const eventLog = ref<Array<{ tick: number; type: string; message: string }>>([]);
  const maxEventLogSize = 50;

  // ---- Spawn Selection ----
  const spawnLocations = ref<Array<{ x: number; y: number }>>([]);
  const spawnSelected = ref<boolean>(false);

  // ---- Match Result ----
  const matchResult = ref<MatchResult | null>(null);

  // ---- UI State ----
  const buildMode = ref<BuildMode>({ active: false, structureType: null });
  const trainUnitType = ref<UnitType | null>(null);
  const selection = ref<SelectionState>({
    selectedSquadIds: [],
    hoveredTileX: -1,
    hoveredTileY: -1,
  });

  // ---- Camera State ----
  const cameraX = ref<number>(60);
  const cameraY = ref<number>(60);
  const cameraZoom = ref<number>(1);

  // ---- Performance ----
  const latency = ref<number>(0);
  const fps = ref<number>(0);

  // ============================================================
  // Computed
  // ============================================================

  const myPlayer = computed<PlayerPublicInfo | undefined>(() => {
    if (!playerId.value) return undefined;
    return players.value.find(p => p.id === playerId.value);
  });

  const myColor = computed<string>(() => {
    return myPlayer.value?.color ?? '#ffffff';
  });

  const isAlive = computed<boolean>(() => {
    return myPlayer.value?.alive ?? false;
  });

  const alivePlayers = computed<PlayerPublicInfo[]>(() => {
    return players.value.filter(p => p.alive);
  });

  const mySquads = computed<SquadSnapshot[]>(() => {
    if (!playerId.value) return [];
    return squads.value.filter(s => s.ownerId === playerId.value);
  });

  const selectedSquads = computed<SquadSnapshot[]>(() => {
    const ids = new Set(selection.value.selectedSquadIds);
    return squads.value.filter(s => ids.has(s.id));
  });

  const totalUnitCount = computed<number>(() => {
    return mySquads.value.reduce((sum, s) => sum + s.unitCount, 0);
  });

  const myTerritory = computed<number>(() => {
    return myPlayer.value?.territoryCount ?? 0;
  });

  const sortedPlayers = computed<PlayerPublicInfo[]>(() => {
    return [...players.value].sort((a, b) => b.score - a.score);
  });

  const formattedTimeRemaining = computed<string>(() => {
    const mins = Math.floor(timeRemaining.value / 60);
    const secs = Math.floor(timeRemaining.value % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  });

  const hoveredTile = computed<VisibleTile | undefined>(() => {
    const { hoveredTileX: hx, hoveredTileY: hy } = selection.value;
    if (hx < 0 || hy < 0) return undefined;
    return visibleTiles.value.get(`${hx},${hy}`);
  });

  // ============================================================
  // Actions — Network Setup
  // ============================================================

  function initializeSocket(): void {
    socketClient.connect();

    socketClient.on({
      onConnect: () => {
        connected.value = true;
        clearError();
      },

      onDisconnect: (_reason: string) => {
        connected.value = false;
      },

      onQueueJoined: (data) => {
        playerId.value = data.playerId;
        lobbyState.value = data.lobbyState;
        screen.value = AppScreen.Queue;
        clearError();
      },

      onLobbyUpdate: (state) => {
        lobbyState.value = state;
      },

      onMatchStarting: (data) => {
        matchId.value = data.matchId;
        playerId.value = data.playerId;
        // Request map data for spawn selection
        socketClient.requestMap();
      },

      onPhaseChange: (data) => {
        phase.value = data.phase as MatchPhase;

        if (data.phase === 'spawn_selection') {
          screen.value = AppScreen.SpawnSelection;
          spawnSelected.value = false;

          if (data.data?.spawnLocations) {
            spawnLocations.value = data.data.spawnLocations;
          }
        } else if (data.phase === 'playing') {
          screen.value = AppScreen.Game;
        } else if (data.phase === 'finished') {
          // Will be handled by onMatchEnded
        }
      },

      onGameState: (snapshot) => {
        applyGameState(snapshot);
      },

      onMatchEnded: (result) => {
        matchResult.value = result;
        screen.value = AppScreen.Scoreboard;
        phase.value = 'finished' as MatchPhase;
      },

      onMapData: (data) => {
        mapWidth.value = data.width;
        mapHeight.value = data.height;
        mapTerrain.value = data.terrain;
      },

      onError: (data) => {
        setError(data.message);
      },

      onServerInfo: (data) => {
        serverInfo.value = data;
      },
    });
  }

  // ============================================================
  // Actions — Queue
  // ============================================================

  function joinQueue(name: string): void {
    if (!name.trim()) {
      setError('Please enter a username');
      return;
    }

    username.value = name.trim();
    socketClient.joinQueue(username.value);
  }

  function leaveQueue(): void {
    socketClient.leaveQueue();
    screen.value = AppScreen.Landing;
  }

  // ============================================================
  // Actions — Spawn Selection
  // ============================================================

  function selectSpawn(x: number, y: number): void {
    if (spawnSelected.value) return;

    socketClient.sendCommand({
      type: CommandType.SelectSpawn,
      x,
      y,
    });

    spawnSelected.value = true;
    cameraX.value = x;
    cameraY.value = y;
  }

  // ============================================================
  // Actions — Game Commands
  // ============================================================

  function moveSelectedSquads(targetX: number, targetY: number): void {
    for (const squadId of selection.value.selectedSquadIds) {
      socketClient.sendCommand({
        type: CommandType.MoveSquad,
        squadId,
        targetX,
        targetY,
      });
    }
  }

  function buildStructure(structureType: StructureType, x: number, y: number): void {
    socketClient.sendCommand({
      type: CommandType.BuildStructure,
      structureType,
      x,
      y,
    });

    // Exit build mode after placing
    if (buildMode.value.active) {
      buildMode.value = { active: false, structureType: null };
    }
  }

  function trainUnit(unitType: UnitType, buildingX: number, buildingY: number): void {
    socketClient.sendCommand({
      type: CommandType.TrainUnit,
      unitType,
      buildingX,
      buildingY,
    });
  }

  function setRallyPoint(buildingX: number, buildingY: number, rallyX: number, rallyY: number): void {
    socketClient.sendCommand({
      type: CommandType.RallyPoint,
      buildingX,
      buildingY,
      rallyX,
      rallyY,
    });
  }

  // ============================================================
  // Actions — UI State
  // ============================================================

  function enterBuildMode(structureType: StructureType): void {
    buildMode.value = { active: true, structureType };
    selection.value.selectedSquadIds = [];
  }

  function exitBuildMode(): void {
    buildMode.value = { active: false, structureType: null };
  }

  function selectSquad(squadId: SquadId, append: boolean = false): void {
    if (append) {
      if (!selection.value.selectedSquadIds.includes(squadId)) {
        selection.value.selectedSquadIds.push(squadId);
      }
    } else {
      selection.value.selectedSquadIds = [squadId];
    }

    buildMode.value = { active: false, structureType: null };
  }

  function selectSquads(squadIds: SquadId[]): void {
    selection.value.selectedSquadIds = squadIds;
    buildMode.value = { active: false, structureType: null };
  }

  function clearSelection(): void {
    selection.value.selectedSquadIds = [];
  }

  function setHoveredTile(x: number, y: number): void {
    selection.value.hoveredTileX = x;
    selection.value.hoveredTileY = y;
  }

  function setCamera(x: number, y: number, zoom?: number): void {
    cameraX.value = x;
    cameraY.value = y;
    if (zoom !== undefined) {
      cameraZoom.value = Math.max(0.25, Math.min(4, zoom));
    }
  }

  function zoomCamera(delta: number): void {
    cameraZoom.value = Math.max(0.25, Math.min(4, cameraZoom.value + delta));
  }

  // ============================================================
  // Actions — State Application
  // ============================================================

  function applyGameState(snapshot: GameStateSnapshot): void {
    tick.value = snapshot.tick;
    phase.value = snapshot.phase;
    timeRemaining.value = snapshot.timeRemaining;
    myGold.value = snapshot.myGold;
    myGoldPerSecond.value = snapshot.myGoldPerSecond;
    players.value = snapshot.players;
    squads.value = snapshot.squads;
    gameEvents.value = snapshot.events;

    // Update visible tiles map
    const newTiles = new Map<string, VisibleTile>();
    // Keep old explored tiles (grayed out) — merge with new
    for (const [key, tile] of visibleTiles.value) {
      newTiles.set(key, tile);
    }
    for (const tile of snapshot.visibleTiles) {
      newTiles.set(`${tile.x},${tile.y}`, tile);
    }
    visibleTiles.value = newTiles;

    // Prune selected squads that no longer exist
    const existingIds = new Set(snapshot.squads.map(s => s.id));
    selection.value.selectedSquadIds = selection.value.selectedSquadIds.filter(
      id => existingIds.has(id)
    );

    // Process events into log
    for (const event of snapshot.events) {
      let message = '';
      switch (event.type) {
        case 'player_eliminated':
          message = `${event.data.username} has been eliminated!`;
          break;
        case 'structure_destroyed':
          message = `A structure was destroyed at (${event.data.x}, ${event.data.y})`;
          break;
        case 'build':
          if (event.data.playerId === playerId.value) {
            message = `Built ${event.data.structureType}`;
          }
          break;
        case 'tower_fire':
          // Don't log tower fires, too noisy
          continue;
        default:
          message = `${event.type}`;
      }

      if (message) {
        eventLog.value.unshift({
          tick: snapshot.tick,
          type: event.type,
          message,
        });

        // Trim log
        if (eventLog.value.length > maxEventLogSize) {
          eventLog.value = eventLog.value.slice(0, maxEventLogSize);
        }
      }
    }
  }

  // ============================================================
  // Actions — Error Handling
  // ============================================================

  function setError(message: string): void {
    error.value = message;

    // Auto-clear after 5 seconds
    if (errorTimeout.value) {
      clearTimeout(errorTimeout.value);
    }
    errorTimeout.value = setTimeout(() => {
      error.value = null;
      errorTimeout.value = null;
    }, 5000);
  }

  function clearError(): void {
    error.value = null;
    if (errorTimeout.value) {
      clearTimeout(errorTimeout.value);
      errorTimeout.value = null;
    }
  }

  // ============================================================
  // Actions — Navigation
  // ============================================================

  function goToLanding(): void {
    screen.value = AppScreen.Landing;
    matchId.value = null;
    phase.value = null;
    matchResult.value = null;
    myGold.value = 0;
    myGoldPerSecond.value = 0;
    players.value = [];
    squads.value = [];
    visibleTiles.value = new Map();
    gameEvents.value = [];
    eventLog.value = [];
    spawnSelected.value = false;
    spawnLocations.value = [];
    mapTerrain.value = null;
    buildMode.value = { active: false, structureType: null };
    selection.value = { selectedSquadIds: [], hoveredTileX: -1, hoveredTileY: -1 };
    cameraX.value = 60;
    cameraY.value = 60;
    cameraZoom.value = 1;
    socketClient.resetMatchState();
  }

  // ============================================================
  // Actions — Performance Tracking
  // ============================================================

  function updateFps(value: number): void {
    fps.value = value;
  }

  async function measureLatency(): Promise<void> {
    try {
      latency.value = await socketClient.ping();
    } catch {
      latency.value = -1;
    }
  }

  // ============================================================
  // Return
  // ============================================================

  return {
    // State
    screen,
    username,
    connected,
    error,
    playerId,
    matchId,
    lobbyState,
    serverInfo,
    phase,
    tick,
    timeRemaining,
    myGold,
    myGoldPerSecond,
    players,
    mapWidth,
    mapHeight,
    mapTerrain,
    visibleTiles,
    squads,
    gameEvents,
    eventLog,
    spawnLocations,
    spawnSelected,
    matchResult,
    buildMode,
    trainUnitType,
    selection,
    cameraX,
    cameraY,
    cameraZoom,
    latency,
    fps,

    // Computed
    myPlayer,
    myColor,
    isAlive,
    alivePlayers,
    mySquads,
    selectedSquads,
    totalUnitCount,
    myTerritory,
    sortedPlayers,
    formattedTimeRemaining,
    hoveredTile,

    // Actions
    initializeSocket,
    joinQueue,
    leaveQueue,
    selectSpawn,
    moveSelectedSquads,
    buildStructure,
    trainUnit,
    setRallyPoint,
    enterBuildMode,
    exitBuildMode,
    selectSquad,
    selectSquads,
    clearSelection,
    setHoveredTile,
    setCamera,
    zoomCamera,
    applyGameState,
    setError,
    clearError,
    goToLanding,
    updateFps,
    measureLatency,
  };
});
