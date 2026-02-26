// ============================================================
// Fractured Crowns — Shared Type Definitions
// ============================================================

// ---- Identifiers ----
export type PlayerId = string;
export type MatchId = string;
export type UnitId = string;
export type SquadId = string;
export type BuildingId = string;
export type TileKey = string; // "x,y" format

// ---- Enums ----

export enum TerrainType {
  Plains = 'plains',
  Forest = 'forest',
  Mountain = 'mountain',
  Mine = 'mine',
  Water = 'water',
}

export enum StructureType {
  Castle = 'castle',
  Barracks = 'barracks',
  Wall = 'wall',
  Tower = 'tower',
  MineUpgrade = 'mine_upgrade',
  Road = 'road',
}

export enum UnitType {
  Militia = 'militia',
  Soldier = 'soldier',
  Knight = 'knight',
  Archer = 'archer',
  SiegeRam = 'siege_ram',
}

export enum MatchPhase {
  Waiting = 'waiting',
  SpawnSelection = 'spawn_selection',
  Playing = 'playing',
  Finished = 'finished',
}

export enum CommandType {
  SelectSpawn = 'select_spawn',
  MoveSquad = 'move_squad',
  BuildStructure = 'build_structure',
  TrainUnit = 'train_unit',
  RallyPoint = 'rally_point',
}

// ---- Map ----

export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  ownerId: PlayerId | null;
  structureType: StructureType | null;
  structureHp: number;
  captureProgress: number; // 0–100
  capturingPlayerId: PlayerId | null;
  connected: boolean; // supply line connectivity
  mineLevel: number; // 0 = no mine / base mine, 1+ = upgraded
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[][];
}

// ---- Units & Squads ----

export interface UnitStats {
  maxHp: number;
  damage: number;
  speed: number; // tiles per second
  cost: number;
  range: number; // 1 = melee, >1 = ranged
  trainTime: number; // seconds
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

export interface Unit {
  id: UnitId;
  type: UnitType;
  hp: number;
  maxHp: number;
}

export interface Squad {
  id: SquadId;
  ownerId: PlayerId;
  units: Unit[];
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  moveProgress: number; // 0–1 between current tile and next
}

// ---- Buildings ----

export interface BuildingCost {
  gold: number;
  buildTime: number; // seconds
}

export const BUILDING_COSTS: Record<StructureType, BuildingCost> = {
  [StructureType.Castle]: { gold: 0, buildTime: 0 }, // starting structure
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

export const TOWER_STATS = {
  damage: 15,
  range: 3,
  fireRate: 1.0, // shots per second
};

// ---- Player ----

export interface Player {
  id: PlayerId;
  username: string;
  isBot: boolean;
  gold: number;
  goldPerSecond: number;
  territoryCount: number;
  capitalX: number;
  capitalY: number;
  color: string;
  alive: boolean;
  score: number;
  connected: boolean;
  spawnSelected: boolean;
}

// ---- Economy Constants ----

export const ECONOMY = {
  BASE_MINE_INCOME: 10, // gold per second per mine
  MINE_UPGRADE_BONUS: 5, // additional gold per upgrade level
  PASSIVE_TERRITORY_INCOME: 0.2, // gold per tile per second
  STARTING_GOLD: 300,
  EXPANSION_PENALTY_DIVISOR: 50,
  EXPANSION_PENALTY_EXPONENT: 1.2,
};

// ---- Match Config ----

export const MATCH_CONFIG = {
  MAX_PLAYERS: 20,
  MAP_WIDTH: 120,
  MAP_HEIGHT: 120,
  TICK_RATE: 15, // ticks per second
  SPAWN_PHASE_DURATION: 15, // seconds
  MATCH_DURATION: 25 * 60, // 25 minutes in seconds
  MIN_SPAWN_DISTANCE: 20, // minimum tiles between spawns
  CAPTURE_RATE: 8, // capture progress per second per unit
  CAPTURE_THRESHOLD: 100, // capture progress needed
  QUEUE_WAIT_TIME: 180, // 3 minutes max queue wait
  QUEUE_MIN_PLAYERS: 2, // minimum to start (bots fill rest)
  FOG_OF_WAR_RADIUS: 8,
  SUPPLY_CHECK_INTERVAL: 5, // check supply every N ticks
};

// ---- Spatial Hash ----

export const SPATIAL_HASH_CELL_SIZE = 8;

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

// ---- Network Events (Server → Client) ----

export interface MatchJoinedEvent {
  matchId: MatchId;
  playerId: PlayerId;
  phase: MatchPhase;
  players: PlayerPublicInfo[];
}

export interface PlayerPublicInfo {
  id: PlayerId;
  username: string;
  color: string;
  alive: boolean;
  score: number;
  isBot: boolean;
  territoryCount: number;
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

// ---- Training Queue ----

export interface TrainingOrder {
  unitType: UnitType;
  remainingTime: number;
  buildingX: number;
  buildingY: number;
}

// ---- Rally Point ----

export interface RallyPoint {
  x: number;
  y: number;
}

// ---- Lobby / Queue ----

export interface QueueEntry {
  playerId: PlayerId;
  username: string;
  joinedAt: number;
  socketId: string;
}

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

// ---- Player Colors ----

export const PLAYER_COLORS: string[] = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // dark orange
  '#e91e63', // pink
  '#00bcd4', // cyan
  '#8bc34a', // light green
  '#ff5722', // deep orange
  '#673ab7', // deep purple
  '#009688', // dark teal
  '#ffc107', // amber
  '#795548', // brown
  '#607d8b', // blue grey
  '#cddc39', // lime
  '#ff9800', // orange 2
  '#03a9f4', // light blue
  '#4caf50', // green 2
];

// ---- Utility ----

export function tileKey(x: number, y: number): TileKey {
  return `${x},${y}`;
}

export function parseTileKey(key: TileKey): { x: number; y: number } {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

export function manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
