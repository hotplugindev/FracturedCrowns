// ============================================================
// Fractured Crowns — Frontend Shared Type Definitions
// Mirrors backend types for client-side usage
// ============================================================

// ---- Identifiers ----
export type PlayerId = string;
export type MatchId = string;
export type SquadId = string;
export type TileKey = string;

// ---- Enums ----

export enum TerrainType {
  Plains = "plains",
  Forest = "forest",
  Mountain = "mountain",
  Mine = "mine",
  Water = "water",
}

export enum StructureType {
  Castle = "castle",
  Barracks = "barracks",
  Wall = "wall",
  Tower = "tower",
  MineUpgrade = "mine_upgrade",
  Road = "road",
}

export enum UnitType {
  Militia = "militia",
  Soldier = "soldier",
  Knight = "knight",
  Archer = "archer",
  SiegeRam = "siege_ram",
}

export enum MatchPhase {
  Waiting = "waiting",
  SpawnSelection = "spawn_selection",
  Playing = "playing",
  Finished = "finished",
}

export enum CommandType {
  SelectSpawn = "select_spawn",
  MoveSquad = "move_squad",
  BuildStructure = "build_structure",
  TrainUnit = "train_unit",
  RallyPoint = "rally_point",
}

// ---- Unit Stats ----

export interface UnitStats {
  maxHp: number;
  damage: number;
  speed: number;
  cost: number;
  range: number;
  trainTime: number;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.Militia]: {
    maxHp: 40,
    damage: 5,
    speed: 2.5,
    cost: 20,
    range: 1,
    trainTime: 3,
  },
  [UnitType.Soldier]: {
    maxHp: 70,
    damage: 10,
    speed: 2.0,
    cost: 50,
    range: 1,
    trainTime: 5,
  },
  [UnitType.Knight]: {
    maxHp: 120,
    damage: 18,
    speed: 3.0,
    cost: 120,
    range: 1,
    trainTime: 8,
  },
  [UnitType.Archer]: {
    maxHp: 35,
    damage: 12,
    speed: 2.0,
    cost: 60,
    range: 4,
    trainTime: 5,
  },
  [UnitType.SiegeRam]: {
    maxHp: 200,
    damage: 40,
    speed: 1.0,
    cost: 200,
    range: 1,
    trainTime: 12,
  },
};

// ---- Building Costs ----

export interface BuildingCost {
  gold: number;
  buildTime: number;
}

export const BUILDING_COSTS: Record<StructureType, BuildingCost> = {
  [StructureType.Castle]: { gold: 0, buildTime: 0 },
  [StructureType.Barracks]: { gold: 150, buildTime: 8 },
  [StructureType.Wall]: { gold: 40, buildTime: 3 },
  [StructureType.Tower]: { gold: 100, buildTime: 6 },
  [StructureType.MineUpgrade]: { gold: 200, buildTime: 10 },
  [StructureType.Road]: { gold: 15, buildTime: 1 },
};

export const BUILDING_HP: Record<StructureType, number> = {
  [StructureType.Castle]: 500,
  [StructureType.Barracks]: 200,
  [StructureType.Wall]: 300,
  [StructureType.Tower]: 150,
  [StructureType.MineUpgrade]: 100,
  [StructureType.Road]: 30,
};

// ---- Network Events (Server → Client) ----

export interface PlayerPublicInfo {
  id: PlayerId;
  username: string;
  color: string;
  alive: boolean;
  score: number;
  isBot: boolean;
  territoryCount: number;
}

export interface VisibleTile {
  x: number;
  y: number;
  terrain: TerrainType;
  ownerId: PlayerId | null;
  structureType: StructureType | null;
  structureHp: number;
  captureProgress: number;
  capturingPlayerId: PlayerId | null;
}

export interface SquadSnapshot {
  id: SquadId;
  ownerId: PlayerId;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  unitCount: number;
  totalHp: number;
  maxHp: number;
  composition: Partial<Record<UnitType, number>>;
}

export interface GameEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface GameStateSnapshot {
  tick: number;
  phase: MatchPhase;
  timeRemaining: number;
  players: PlayerPublicInfo[];
  myGold: number;
  myGoldPerSecond: number;
  visibleTiles: VisibleTile[];
  squads: SquadSnapshot[];
  events: GameEvent[];
}

// ---- Commands (Client → Server) ----

export interface SelectSpawnCommand {
  type: CommandType.SelectSpawn;
  x: number;
  y: number;
}

export interface MoveSquadCommand {
  type: CommandType.MoveSquad;
  squadId: SquadId;
  targetX: number;
  targetY: number;
}

export interface BuildStructureCommand {
  type: CommandType.BuildStructure;
  structureType: StructureType;
  x: number;
  y: number;
}

export interface TrainUnitCommand {
  type: CommandType.TrainUnit;
  unitType: UnitType;
  buildingX: number;
  buildingY: number;
}

export interface RallyPointCommand {
  type: CommandType.RallyPoint;
  buildingX: number;
  buildingY: number;
  rallyX: number;
  rallyY: number;
}

export type GameCommand =
  | SelectSpawnCommand
  | MoveSquadCommand
  | BuildStructureCommand
  | TrainUnitCommand
  | RallyPointCommand;

// ---- Lobby / Queue ----

export interface LobbyState {
  playerCount: number;
  maxPlayers: number;
  timeUntilStart: number;
}

// ---- Scoreboard ----

export interface ScoreEntry {
  playerId: PlayerId;
  username: string;
  isBot: boolean;
  score: number;
  territoryCaptured: number;
  unitsKilled: number;
  unitsLost: number;
  goldEarned: number;
  alive: boolean;
  placement: number;
}

export interface MatchResult {
  matchId: MatchId;
  duration: number;
  scores: ScoreEntry[];
  winnerId: PlayerId | null;
}

// ---- Match Config (client-side constants) ----

export const MATCH_CONFIG = {
  MAX_PLAYERS: 20,
  MAP_WIDTH: 120,
  MAP_HEIGHT: 120,
  TICK_RATE: 15,
  SPAWN_PHASE_DURATION: 15,
  MATCH_DURATION: 25 * 60,
  FOG_OF_WAR_RADIUS: 8,
};

// ---- Player Colors ----

export const PLAYER_COLORS: string[] = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e91e63",
  "#00bcd4",
  "#8bc34a",
  "#ff5722",
  "#673ab7",
  "#009688",
  "#ffc107",
  "#795548",
  "#607d8b",
  "#cddc39",
  "#ff9800",
  "#03a9f4",
  "#4caf50",
];

// ---- Structure Display Names ----

export const STRUCTURE_NAMES: Record<StructureType, string> = {
  [StructureType.Castle]: "Castle",
  [StructureType.Barracks]: "Barracks",
  [StructureType.Wall]: "Wall",
  [StructureType.Tower]: "Tower",
  [StructureType.MineUpgrade]: "Mine Upgrade",
  [StructureType.Road]: "Road",
};

// ---- Unit Display Names ----

export const UNIT_NAMES: Record<UnitType, string> = {
  [UnitType.Militia]: "Militia",
  [UnitType.Soldier]: "Soldier",
  [UnitType.Knight]: "Knight",
  [UnitType.Archer]: "Archer",
  [UnitType.SiegeRam]: "Siege Ram",
};

// ---- Utility ----

export function tileKey(x: number, y: number): TileKey {
  return `${x},${y}`;
}

export function parseTileKey(key: TileKey): { x: number; y: number } {
  const parts = key.split(",").map(Number);
  return { x: parts[0] ?? 0, y: parts[1] ?? 0 };
}

// ---- Buildable Structures (excludes Castle) ----

export const BUILDABLE_STRUCTURES: StructureType[] = [
  StructureType.Barracks,
  StructureType.Wall,
  StructureType.Tower,
  StructureType.MineUpgrade,
  StructureType.Road,
];

// ---- Trainable Units ----

export const TRAINABLE_UNITS: UnitType[] = [
  UnitType.Militia,
  UnitType.Soldier,
  UnitType.Knight,
  UnitType.Archer,
  UnitType.SiegeRam,
];

// ---- Server Info ----

export interface ServerInfo {
  activeMatches: number;
  queueSize: number;
  totalPlayers: number;
}
