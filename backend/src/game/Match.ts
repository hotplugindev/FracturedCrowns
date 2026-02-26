// ============================================================
// Fractured Crowns — Match Engine
// Core authoritative game simulation
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  MatchId,
  PlayerId,
  SquadId,
  Player,
  Squad,
  Unit,
  Tile,
  GameMap,
  MatchPhase,
  TerrainType,
  StructureType,
  UnitType,
  CommandType,
  GameCommand,
  SelectSpawnCommand,
  MoveSquadCommand,
  BuildStructureCommand,
  TrainUnitCommand,
  RallyPointCommand,
  TrainingOrder,
  RallyPoint,
  GameStateSnapshot,
  VisibleTile,
  SquadSnapshot,
  PlayerPublicInfo,
  GameEvent,
  ScoreEntry,
  MatchResult,
  UNIT_STATS,
  BUILDING_COSTS,
  BUILDING_HP,
  TOWER_STATS,
  ECONOMY,
  MATCH_CONFIG,
  PLAYER_COLORS,
  tileKey,
  distanceSq,
  clamp,
} from '../types/game';
import { MapGenerator } from './MapGenerator';
import { SpatialHash } from './SpatialHash';
import { BotAI } from './BotAI';

// ---- Internal types ----

interface PendingCommand {
  playerId: PlayerId;
  command: GameCommand;
  tick: number;
}

interface PlayerStats {
  territoryCaptured: number;
  unitsKilled: number;
  unitsLost: number;
  goldEarned: number;
  eliminationOrder: number;
}

interface TowerCooldown {
  x: number;
  y: number;
  lastFired: number;
}

export interface MatchCallbacks {
  onStateUpdate: (playerId: PlayerId, snapshot: GameStateSnapshot) => void;
  onMatchEnd: (result: MatchResult) => void;
  onPhaseChange: (matchId: MatchId, phase: MatchPhase, data?: any) => void;
}

// ============================================================
// Match Class
// ============================================================

export class Match {
  readonly id: MatchId;
  private phase: MatchPhase = MatchPhase.Waiting;
  private tick: number = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTime: number = 0;

  // Map
  private map!: GameMap;
  private mapGenerator: MapGenerator;
  private spawnLocations: Array<{ x: number; y: number }> = [];

  // Players
  private players: Map<PlayerId, Player> = new Map();
  private playerOrder: PlayerId[] = [];

  // Squads & Units
  private squads: Map<SquadId, Squad> = new Map();
  private spatialHash: SpatialHash = new SpatialHash();

  // Economy & Training
  private trainingQueues: Map<string, TrainingOrder[]> = new Map(); // key: "x,y"
  private rallyPoints: Map<string, RallyPoint> = new Map(); // key: "x,y"

  // Tower tracking
  private towerCooldowns: Map<string, number> = new Map(); // key: "x,y" -> last fired tick

  // Commands
  private pendingCommands: PendingCommand[] = [];

  // Stats
  private playerStats: Map<PlayerId, PlayerStats> = new Map();
  private eliminationCounter: number = 0;

  // Timing
  private matchStartTime: number = 0;
  private spawnPhaseEndTime: number = 0;
  private matchEndTime: number = 0;

  // Bot AI
  private botAIs: Map<PlayerId, BotAI> = new Map();

  // Callbacks
  private callbacks: MatchCallbacks;

  // Supply line check throttle
  private supplyCheckCounter: number = 0;

  // Events for current tick
  private tickEvents: GameEvent[] = [];

  constructor(id: MatchId, callbacks: MatchCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
    this.mapGenerator = new MapGenerator(Date.now() + Math.floor(Math.random() * 100000));
  }

  // ============================================================
  // Match Setup
  // ============================================================

  /**
   * Add a human player to the match.
   */
  addPlayer(playerId: PlayerId, username: string): boolean {
    if (this.players.size >= MATCH_CONFIG.MAX_PLAYERS) return false;
    if (this.players.has(playerId)) return false;

    const colorIndex = this.players.size;
    const player: Player = {
      id: playerId,
      username,
      isBot: false,
      gold: ECONOMY.STARTING_GOLD,
      goldPerSecond: 0,
      territoryCount: 0,
      capitalX: -1,
      capitalY: -1,
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
      alive: true,
      score: 0,
      connected: true,
      spawnSelected: false,
    };

    this.players.set(playerId, player);
    this.playerOrder.push(playerId);
    this.playerStats.set(playerId, {
      territoryCaptured: 0,
      unitsKilled: 0,
      unitsLost: 0,
      goldEarned: 0,
      eliminationOrder: 0,
    });

    return true;
  }

  /**
   * Fill empty slots with bots.
   */
  fillWithBots(targetCount: number = MATCH_CONFIG.MAX_PLAYERS): void {
    const botNames = [
      'Lord Ironhelm', 'Queen Ashfire', 'Duke Stormwall', 'Lady Thornvale',
      'Baron Blackthorn', 'Empress Goldcrest', 'Count Redfang', 'Princess Frostbloom',
      'Warlord Grimjaw', 'Sage Moonshadow', 'Marshal Steelridge', 'Countess Silverbane',
      'Knight Dawnbringer', 'Archduke Ravenclaw', 'Sultana Sandstorm', 'Jarl Thunderpeak',
      'Vizier Darkwater', 'Paladin Sunforge', 'Chieftain Boulderfist', 'Oracle Starweaver',
    ];

    let botIndex = 0;
    while (this.players.size < targetCount) {
      const botId = `bot_${uuidv4().substring(0, 8)}`;
      const colorIndex = this.players.size;
      const botName = botNames[botIndex % botNames.length];
      botIndex++;

      const bot: Player = {
        id: botId,
        username: botName,
        isBot: true,
        gold: ECONOMY.STARTING_GOLD,
        goldPerSecond: 0,
        territoryCount: 0,
        capitalX: -1,
        capitalY: -1,
        color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
        alive: true,
        score: 0,
        connected: true,
        spawnSelected: false,
      };

      this.players.set(botId, bot);
      this.playerOrder.push(botId);
      this.playerStats.set(botId, {
        territoryCaptured: 0,
        unitsKilled: 0,
        unitsLost: 0,
        goldEarned: 0,
        eliminationOrder: 0,
      });
    }
  }

  /**
   * Initialize the match: generate map, enter spawn selection.
   */
  startMatch(): void {
    // Generate the map
    this.map = this.mapGenerator.generate();

    // Find spawn locations
    this.spawnLocations = this.mapGenerator.findSpawnLocations(this.map, this.players.size);

    // Initialize bot AIs and auto-select spawns for bots
    let spawnIdx = 0;
    for (const [pid, player] of this.players) {
      if (player.isBot) {
        const spawn = this.spawnLocations[spawnIdx];
        if (spawn) {
          this.executeSpawnSelection(pid, spawn.x, spawn.y);
          spawnIdx++;
        }
        // Bot AI will be initialized after all spawns are done
      }
    }

    // Enter spawn selection phase
    this.phase = MatchPhase.SpawnSelection;
    this.matchStartTime = Date.now();
    this.spawnPhaseEndTime = Date.now() + MATCH_CONFIG.SPAWN_PHASE_DURATION * 1000;

    this.callbacks.onPhaseChange(this.id, this.phase, {
      spawnLocations: this.spawnLocations.slice(spawnIdx), // remaining locations for humans
      duration: MATCH_CONFIG.SPAWN_PHASE_DURATION,
    });

    // Start the tick loop
    this.startTickLoop();
  }

  // ============================================================
  // Tick Loop
  // ============================================================

  private startTickLoop(): void {
    const tickMs = 1000 / MATCH_CONFIG.TICK_RATE;
    this.lastTickTime = Date.now();

    this.tickInterval = setInterval(() => {
      try {
        this.runTick();
      } catch (err) {
        console.error(`[Match ${this.id}] Tick error:`, err);
      }
    }, tickMs);
  }

  private stopTickLoop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private runTick(): void {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000; // delta in seconds
    this.lastTickTime = now;
    this.tick++;
    this.tickEvents = [];

    // Clamp dt to prevent huge jumps
    const clampedDt = Math.min(dt, 0.2);

    if (this.phase === MatchPhase.SpawnSelection) {
      this.tickSpawnPhase(now);
    } else if (this.phase === MatchPhase.Playing) {
      this.tickGameplay(clampedDt, now);
    }

    // Broadcast state to all connected human players
    this.broadcastState();
  }

  private tickSpawnPhase(now: number): void {
    // Process spawn selection commands
    this.processCommands();

    // Check if spawn phase is over
    if (now >= this.spawnPhaseEndTime || this.allPlayersSpawned()) {
      this.finishSpawnPhase();
    }
  }

  private finishSpawnPhase(): void {
    // Auto-assign remaining players to available spawns
    let availableSpawns = [...this.spawnLocations];

    // Remove used spawns
    for (const [, player] of this.players) {
      if (player.spawnSelected) {
        availableSpawns = availableSpawns.filter(
          s => !(s.x === player.capitalX && s.y === player.capitalY)
        );
      }
    }

    for (const [pid, player] of this.players) {
      if (!player.spawnSelected && player.alive) {
        const spawn = availableSpawns.shift();
        if (spawn) {
          this.executeSpawnSelection(pid, spawn.x, spawn.y);
        } else {
          // No spawn available — eliminate this player
          player.alive = false;
        }
      }
    }

    // Initialize bot AIs now that all spawns are finalized
    for (const [pid, player] of this.players) {
      if (player.isBot && player.alive) {
        this.botAIs.set(pid, new BotAI(pid, this));
      }
    }

    // Transition to playing phase
    this.phase = MatchPhase.Playing;
    this.matchEndTime = Date.now() + MATCH_CONFIG.MATCH_DURATION * 1000;
    this.callbacks.onPhaseChange(this.id, this.phase, {
      duration: MATCH_CONFIG.MATCH_DURATION,
    });
  }

  private allPlayersSpawned(): boolean {
    for (const [, player] of this.players) {
      if (!player.spawnSelected && player.alive && !player.isBot) return false;
    }
    return true;
  }

  private tickGameplay(dt: number, now: number): void {
    // 1. Process player commands
    this.processCommands();

    // 2. Run bot AI
    this.runBots(dt);

    // 3. Process training queues
    this.updateTraining(dt);

    // 4. Update unit movement
    this.updateUnitMovement(dt);

    // 5. Resolve combat
    this.resolveCombat(dt);

    // 6. Update tower attacks
    this.updateTowers(dt);

    // 7. Update territory capture
    this.updateTerritory(dt);

    // 8. Update supply lines (throttled)
    this.supplyCheckCounter++;
    if (this.supplyCheckCounter >= MATCH_CONFIG.SUPPLY_CHECK_INTERVAL) {
      this.supplyCheckCounter = 0;
      this.updateSupplyLines();
    }

    // 9. Calculate economy
    this.calculateEconomy(dt);

    // 10. Update scores
    this.updateScores();

    // 11. Check win/loss conditions
    this.checkEndConditions(now);
  }

  // ============================================================
  // Command Processing
  // ============================================================

  /**
   * Queue a command from a player.
   */
  queueCommand(playerId: PlayerId, command: GameCommand): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    this.pendingCommands.push({
      playerId,
      command,
      tick: this.tick,
    });
  }

  private processCommands(): void {
    const commands = this.pendingCommands.splice(0);

    for (const { playerId, command } of commands) {
      try {
        switch (command.type) {
          case CommandType.SelectSpawn:
            this.handleSelectSpawn(playerId, command as SelectSpawnCommand);
            break;
          case CommandType.MoveSquad:
            this.handleMoveSquad(playerId, command as MoveSquadCommand);
            break;
          case CommandType.BuildStructure:
            this.handleBuildStructure(playerId, command as BuildStructureCommand);
            break;
          case CommandType.TrainUnit:
            this.handleTrainUnit(playerId, command as TrainUnitCommand);
            break;
          case CommandType.RallyPoint:
            this.handleRallyPoint(playerId, command as RallyPointCommand);
            break;
        }
      } catch (err) {
        console.error(`[Match ${this.id}] Command error for ${playerId}:`, err);
      }
    }
  }

  private handleSelectSpawn(playerId: PlayerId, cmd: SelectSpawnCommand): void {
    if (this.phase !== MatchPhase.SpawnSelection) return;

    const player = this.players.get(playerId);
    if (!player || player.spawnSelected) return;

    const x = Math.round(cmd.x);
    const y = Math.round(cmd.y);

    // Validate spawn location
    const existingSpawns = Array.from(this.players.values())
      .filter(p => p.spawnSelected)
      .map(p => ({ x: p.capitalX, y: p.capitalY }));

    if (this.mapGenerator.isValidSpawn(this.map, x, y, existingSpawns)) {
      this.executeSpawnSelection(playerId, x, y);
    }
  }

  private executeSpawnSelection(playerId: PlayerId, x: number, y: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    player.capitalX = x;
    player.capitalY = y;
    player.spawnSelected = true;

    // Claim starting territory (5x5 around capital)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;

        const tile = this.map.tiles[ty][tx];
        if (tile.terrain === TerrainType.Mountain) continue;

        tile.ownerId = playerId;
        tile.captureProgress = MATCH_CONFIG.CAPTURE_THRESHOLD;
        tile.capturingPlayerId = null;
        tile.connected = true;
      }
    }

    // Place castle
    const castleTile = this.map.tiles[y][x];
    castleTile.structureType = StructureType.Castle;
    castleTile.structureHp = BUILDING_HP[StructureType.Castle];

    // Give starting militia squad
    this.createSquad(playerId, x, y + 1, [
      { type: UnitType.Militia, count: 5 },
    ]);
  }

  private handleMoveSquad(playerId: PlayerId, cmd: MoveSquadCommand): void {
    if (this.phase !== MatchPhase.Playing) return;

    const squad = this.squads.get(cmd.squadId);
    if (!squad || squad.ownerId !== playerId) return;

    const targetX = clamp(Math.round(cmd.targetX), 0, this.map.width - 1);
    const targetY = clamp(Math.round(cmd.targetY), 0, this.map.height - 1);

    // Don't path to impassable
    const targetTile = this.map.tiles[targetY][targetX];
    if (targetTile.terrain === TerrainType.Mountain) return;

    // A* pathfinding
    const path = MapGenerator.findPath(
      this.map,
      Math.round(squad.x),
      Math.round(squad.y),
      targetX,
      targetY,
      800
    );

    if (path && path.length > 0) {
      squad.targetX = targetX;
      squad.targetY = targetY;
      squad.path = path;
      squad.pathIndex = 0;
      squad.moveProgress = 0;
    }
  }

  private handleBuildStructure(playerId: PlayerId, cmd: BuildStructureCommand): void {
    if (this.phase !== MatchPhase.Playing) return;

    const player = this.players.get(playerId);
    if (!player) return;

    const x = Math.round(cmd.x);
    const y = Math.round(cmd.y);

    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;

    const tile = this.map.tiles[y][x];

    // Must own the tile
    if (tile.ownerId !== playerId) return;

    // Must be connected
    if (!tile.connected) return;

    // Can't build on mountains or water
    if (tile.terrain === TerrainType.Mountain || tile.terrain === TerrainType.Water) return;

    // Mine upgrade only on mines
    if (cmd.structureType === StructureType.MineUpgrade && tile.terrain !== TerrainType.Mine) return;

    // Can't build on existing structure (except mine upgrade on mine)
    if (tile.structureType !== null) {
      if (cmd.structureType === StructureType.MineUpgrade && tile.terrain === TerrainType.Mine) {
        // Allow upgrading mines
      } else if (cmd.structureType === StructureType.Road && tile.structureType === StructureType.Road) {
        return; // Already has road
      } else {
        return;
      }
    }

    // Can't build castle
    if (cmd.structureType === StructureType.Castle) return;

    // Check cost
    const cost = BUILDING_COSTS[cmd.structureType];
    if (!cost) return;
    if (player.gold < cost.gold) return;

    // Deduct gold
    player.gold -= cost.gold;

    // Place structure
    tile.structureType = cmd.structureType;
    tile.structureHp = BUILDING_HP[cmd.structureType];

    // Track mine upgrade level
    if (cmd.structureType === StructureType.MineUpgrade) {
      tile.mineLevel++;
    }

    this.tickEvents.push({
      type: 'build',
      data: { playerId, structureType: cmd.structureType, x, y },
    });
  }

  private handleTrainUnit(playerId: PlayerId, cmd: TrainUnitCommand): void {
    if (this.phase !== MatchPhase.Playing) return;

    const player = this.players.get(playerId);
    if (!player) return;

    const x = Math.round(cmd.buildingX);
    const y = Math.round(cmd.buildingY);

    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;

    const tile = this.map.tiles[y][x];

    // Must own the tile and have a production building
    if (tile.ownerId !== playerId) return;
    if (tile.structureType !== StructureType.Castle && tile.structureType !== StructureType.Barracks) return;
    if (!tile.connected) return;

    // Check cost
    const stats = UNIT_STATS[cmd.unitType];
    if (!stats) return;
    if (player.gold < stats.cost) return;

    // Training queue limit per building
    const queueKey = tileKey(x, y);
    let queue = this.trainingQueues.get(queueKey);
    if (!queue) {
      queue = [];
      this.trainingQueues.set(queueKey, queue);
    }

    if (queue.length >= 5) return; // Max queue size

    // Deduct gold
    player.gold -= stats.cost;

    // Barracks produces 30% faster
    let trainTime = stats.trainTime;
    if (tile.structureType === StructureType.Barracks) {
      trainTime *= 0.7;
    }

    queue.push({
      unitType: cmd.unitType,
      remainingTime: trainTime,
      buildingX: x,
      buildingY: y,
    });
  }

  private handleRallyPoint(playerId: PlayerId, cmd: RallyPointCommand): void {
    const x = Math.round(cmd.buildingX);
    const y = Math.round(cmd.buildingY);
    const tile = this.map.tiles[y]?.[x];
    if (!tile || tile.ownerId !== playerId) return;

    const key = tileKey(x, y);
    this.rallyPoints.set(key, { x: cmd.rallyX, y: cmd.rallyY });
  }

  // ============================================================
  // Unit Movement
  // ============================================================

  private updateUnitMovement(dt: number): void {
    for (const [squadId, squad] of this.squads) {
      if (!squad.path || squad.path.length === 0 || squad.pathIndex >= squad.path.length) {
        squad.path = [];
        squad.pathIndex = 0;
        squad.targetX = null;
        squad.targetY = null;
        continue;
      }

      // Calculate speed (average of unit types in squad, affected by terrain)
      const speed = this.getSquadSpeed(squad);
      const target = squad.path[squad.pathIndex];

      // Move toward next path node
      const dx = target.x - squad.x;
      const dy = target.y - squad.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.05) {
        // Arrived at path node
        squad.x = target.x;
        squad.y = target.y;
        squad.pathIndex++;
        squad.moveProgress = 0;
      } else {
        const move = speed * dt;
        const ratio = Math.min(move / dist, 1.0);
        squad.x += dx * ratio;
        squad.y += dy * ratio;
      }

      // Update spatial hash
      this.spatialHash.insertOrUpdate({
        id: squadId,
        x: squad.x,
        y: squad.y,
        ownerId: squad.ownerId,
      });
    }
  }

  private getSquadSpeed(squad: Squad): number {
    if (squad.units.length === 0) return 0;

    // Slowest unit determines squad speed
    let minSpeed = Infinity;
    for (const unit of squad.units) {
      const stats = UNIT_STATS[unit.type];
      if (stats.speed < minSpeed) minSpeed = stats.speed;
    }

    // Terrain modifier
    const tileX = Math.round(squad.x);
    const tileY = Math.round(squad.y);
    if (tileX >= 0 && tileY >= 0 && tileX < this.map.width && tileY < this.map.height) {
      const tile = this.map.tiles[tileY][tileX];
      if (tile.terrain === TerrainType.Forest) minSpeed *= 0.6;
      if (tile.terrain === TerrainType.Water) minSpeed *= 0.4;
      if (tile.structureType === StructureType.Road) minSpeed *= 1.5;
    }

    return minSpeed;
  }

  // ============================================================
  // Combat Resolution
  // ============================================================

  private resolveCombat(dt: number): void {
    const squadsToRemove: SquadId[] = [];
    const processedPairs = new Set<string>();

    for (const [squadId, squad] of this.squads) {
      if (squad.units.length === 0) {
        squadsToRemove.push(squadId);
        continue;
      }

      // Find nearby enemies
      const enemies = this.spatialHash.findEnemiesInRange(
        squad.x, squad.y, squad.ownerId, 2
      );

      for (const enemyEntry of enemies) {
        const enemySquad = this.squads.get(enemyEntry.id);
        if (!enemySquad || enemySquad.units.length === 0) continue;

        // Avoid processing same pair twice
        const pairKey = [squadId, enemyEntry.id].sort().join(':');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const dist = Math.sqrt(distanceSq(squad.x, squad.y, enemySquad.x, enemySquad.y));

        // Engage combat
        this.engageCombat(squad, enemySquad, dist, dt);
      }

      // Also attack enemy structures
      this.attackEnemyStructures(squad, dt);
    }

    // Remove empty squads
    for (const id of squadsToRemove) {
      this.removeSquad(id);
    }
  }

  private engageCombat(squad1: Squad, squad2: Squad, distance: number, dt: number): void {
    // squad1 attacks squad2 and vice versa

    // Calculate damage from squad1 to squad2
    const dmg1to2 = this.calculateSquadDamage(squad1, distance, dt);
    const dmg2to1 = this.calculateSquadDamage(squad2, distance, dt);

    // Apply damage
    this.applyDamageToSquad(squad2, dmg1to2, squad1.ownerId);
    this.applyDamageToSquad(squad1, dmg2to1, squad2.ownerId);

    // Stop movement during combat
    if (distance <= 1.5) {
      squad1.path = [];
      squad1.pathIndex = 0;
      squad2.path = [];
      squad2.pathIndex = 0;
    }
  }

  private calculateSquadDamage(squad: Squad, distance: number, dt: number): number {
    let totalDamage = 0;

    for (const unit of squad.units) {
      const stats = UNIT_STATS[unit.type];

      // Check if unit can attack at this distance
      if (distance > stats.range + 0.5) continue;

      totalDamage += stats.damage * dt;
    }

    return totalDamage;
  }

  private applyDamageToSquad(squad: Squad, damage: number, attackerOwnerId: PlayerId): void {
    if (damage <= 0 || squad.units.length === 0) return;

    // Distribute damage across units (front units take more)
    const perUnit = damage / Math.min(squad.units.length, 3); // front 3 units absorb damage

    let unitsToRemove: number[] = [];
    const limit = Math.min(squad.units.length, 3);

    for (let i = 0; i < limit; i++) {
      squad.units[i].hp -= perUnit;
      if (squad.units[i].hp <= 0) {
        unitsToRemove.push(i);
      }
    }

    // Remove dead units (reverse order to maintain indices)
    for (let i = unitsToRemove.length - 1; i >= 0; i--) {
      const deadUnit = squad.units[unitsToRemove[i]];
      squad.units.splice(unitsToRemove[i], 1);

      // Update stats
      const attackerStats = this.playerStats.get(attackerOwnerId);
      if (attackerStats) attackerStats.unitsKilled++;

      const defenderStats = this.playerStats.get(squad.ownerId);
      if (defenderStats) defenderStats.unitsLost++;
    }
  }

  private attackEnemyStructures(squad: Squad, dt: number): void {
    const tileX = Math.round(squad.x);
    const tileY = Math.round(squad.y);

    if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height) return;

    const tile = this.map.tiles[tileY][tileX];

    // Attack enemy structures on this tile
    if (tile.structureType && tile.ownerId && tile.ownerId !== squad.ownerId) {
      let totalDamage = 0;
      for (const unit of squad.units) {
        const stats = UNIT_STATS[unit.type];
        // Siege rams do bonus damage to structures
        const multiplier = unit.type === UnitType.SiegeRam ? 3.0 : 1.0;
        totalDamage += stats.damage * multiplier * dt;
      }

      tile.structureHp -= totalDamage;

      if (tile.structureHp <= 0) {
        // Check if this was a castle
        if (tile.structureType === StructureType.Castle) {
          this.eliminatePlayer(tile.ownerId);
        }

        tile.structureType = null;
        tile.structureHp = 0;

        this.tickEvents.push({
          type: 'structure_destroyed',
          data: { x: tileX, y: tileY, destroyedBy: squad.ownerId },
        });
      }
    }
  }

  // ============================================================
  // Tower Attacks
  // ============================================================

  private updateTowers(dt: number): void {
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y][x];
        if (tile.structureType !== StructureType.Tower) continue;
        if (!tile.ownerId) continue;
        if (!tile.connected) continue;

        const key = tileKey(x, y);
        const lastFired = this.towerCooldowns.get(key) ?? 0;
        const cooldownTicks = Math.floor(MATCH_CONFIG.TICK_RATE / TOWER_STATS.fireRate);

        if (this.tick - lastFired < cooldownTicks) continue;

        // Find nearest enemy in range
        const enemy = this.spatialHash.findNearestEnemy(x, y, tile.ownerId, TOWER_STATS.range);
        if (enemy) {
          const enemySquad = this.squads.get(enemy.id);
          if (enemySquad && enemySquad.units.length > 0) {
            // Apply tower damage to a random unit
            const targetIdx = Math.floor(Math.random() * Math.min(enemySquad.units.length, 2));
            enemySquad.units[targetIdx].hp -= TOWER_STATS.damage;

            if (enemySquad.units[targetIdx].hp <= 0) {
              enemySquad.units.splice(targetIdx, 1);
              const ownerStats = this.playerStats.get(tile.ownerId);
              if (ownerStats) ownerStats.unitsKilled++;
              const enemyStats = this.playerStats.get(enemySquad.ownerId);
              if (enemyStats) enemyStats.unitsLost++;
            }

            this.towerCooldowns.set(key, this.tick);

            this.tickEvents.push({
              type: 'tower_fire',
              data: { x, y, targetX: enemy.x, targetY: enemy.y },
            });
          }
        }
      }
    }
  }

  // ============================================================
  // Territory Capture
  // ============================================================

  private updateTerritory(dt: number): void {
    // Build a set of tiles that have squads on them
    const squadPositions = new Map<string, { playerId: PlayerId; unitCount: number }>();

    for (const [, squad] of this.squads) {
      const tx = Math.round(squad.x);
      const ty = Math.round(squad.y);
      const key = tileKey(tx, ty);

      const existing = squadPositions.get(key);
      if (existing && existing.playerId === squad.ownerId) {
        existing.unitCount += squad.units.length;
      } else if (!existing) {
        squadPositions.set(key, {
          playerId: squad.ownerId,
          unitCount: squad.units.length,
        });
      }
      // If multiple players on same tile, combat handles it
    }

    // Process capture for tiles with squads
    for (const [key, presence] of squadPositions) {
      const [tx, ty] = key.split(',').map(Number);
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;

      const tile = this.map.tiles[ty][tx];
      if (tile.terrain === TerrainType.Mountain) continue;

      // Skip if already fully owned by this player
      if (tile.ownerId === presence.playerId && tile.captureProgress >= MATCH_CONFIG.CAPTURE_THRESHOLD) {
        continue;
      }

      // If tile belongs to someone else or is neutral
      if (tile.ownerId !== presence.playerId) {
        // If someone else is capturing, reset if different player
        if (tile.capturingPlayerId && tile.capturingPlayerId !== presence.playerId) {
          // Contested — reduce progress
          tile.captureProgress -= MATCH_CONFIG.CAPTURE_RATE * dt * presence.unitCount * 0.5;
          if (tile.captureProgress <= 0) {
            tile.captureProgress = 0;
            tile.capturingPlayerId = presence.playerId;
          }
        } else {
          tile.capturingPlayerId = presence.playerId;
          tile.captureProgress += MATCH_CONFIG.CAPTURE_RATE * dt * Math.min(presence.unitCount, 5);

          if (tile.captureProgress >= MATCH_CONFIG.CAPTURE_THRESHOLD) {
            // Tile captured!
            const previousOwner = tile.ownerId;
            tile.ownerId = presence.playerId;
            tile.captureProgress = MATCH_CONFIG.CAPTURE_THRESHOLD;
            tile.capturingPlayerId = null;

            // Update territory counts
            const capturer = this.players.get(presence.playerId);
            if (capturer) capturer.territoryCount++;

            if (previousOwner) {
              const prevOwner = this.players.get(previousOwner);
              if (prevOwner) prevOwner.territoryCount = Math.max(0, prevOwner.territoryCount - 1);
            }

            const capturerStats = this.playerStats.get(presence.playerId);
            if (capturerStats) capturerStats.territoryCaptured++;
          }
        }
      }
    }
  }

  // ============================================================
  // Supply Lines (Flood Fill from Capital)
  // ============================================================

  private updateSupplyLines(): void {
    // Reset all connected flags
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        this.map.tiles[y][x].connected = false;
      }
    }

    // Flood fill from each player's capital
    for (const [playerId, player] of this.players) {
      if (!player.alive || !player.spawnSelected) continue;

      const capitalTile = this.map.tiles[player.capitalY]?.[player.capitalX];
      if (!capitalTile || capitalTile.ownerId !== playerId) {
        // Capital lost — player's territory is all disconnected
        continue;
      }

      // BFS flood fill
      const visited = new Set<string>();
      const queue: Array<{ x: number; y: number }> = [{ x: player.capitalX, y: player.capitalY }];
      visited.add(tileKey(player.capitalX, player.capitalY));

      while (queue.length > 0) {
        const current = queue.shift()!;
        const tile = this.map.tiles[current.y][current.x];
        tile.connected = true;

        // Check 4 neighbors
        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= this.map.width || n.y >= this.map.height) continue;

          const nKey = tileKey(n.x, n.y);
          if (visited.has(nKey)) continue;

          const nTile = this.map.tiles[n.y][n.x];
          if (nTile.ownerId !== playerId) continue;
          if (nTile.terrain === TerrainType.Mountain) continue;

          visited.add(nKey);
          queue.push(n);
        }
      }
    }

    // Recount territory for each player
    const counts = new Map<PlayerId, number>();
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y][x];
        if (tile.ownerId) {
          counts.set(tile.ownerId, (counts.get(tile.ownerId) ?? 0) + 1);
        }
      }
    }
    for (const [pid, player] of this.players) {
      player.territoryCount = counts.get(pid) ?? 0;
    }
  }

  // ============================================================
  // Economy
  // ============================================================

  private calculateEconomy(dt: number): void {
    for (const [playerId, player] of this.players) {
      if (!player.alive) continue;

      // Calculate expansion penalty
      const incomeMultiplier = 1 / (1 + Math.pow(player.territoryCount / ECONOMY.EXPANSION_PENALTY_DIVISOR, ECONOMY.EXPANSION_PENALTY_EXPONENT));

      let baseIncome = 0;

      // Mine income
      for (let y = 0; y < this.map.height; y++) {
        for (let x = 0; x < this.map.width; x++) {
          const tile = this.map.tiles[y][x];
          if (tile.ownerId !== playerId) continue;
          if (!tile.connected) continue;

          if (tile.terrain === TerrainType.Mine) {
            const mineIncome = ECONOMY.BASE_MINE_INCOME + tile.mineLevel * ECONOMY.MINE_UPGRADE_BONUS;
            baseIncome += mineIncome;
          }

          // Passive territory income
          baseIncome += ECONOMY.PASSIVE_TERRITORY_INCOME;
        }
      }

      const goldPerSecond = baseIncome * incomeMultiplier;
      player.goldPerSecond = Math.round(goldPerSecond * 100) / 100;
      player.gold += goldPerSecond * dt;

      const stats = this.playerStats.get(playerId);
      if (stats) stats.goldEarned += goldPerSecond * dt;
    }
  }

  // ============================================================
  // Training
  // ============================================================

  private updateTraining(dt: number): void {
    for (const [key, queue] of this.trainingQueues) {
      if (queue.length === 0) continue;

      const order = queue[0];
      const [bx, by] = key.split(',').map(Number);
      const tile = this.map.tiles[by]?.[bx];

      // Verify building still exists and is connected
      if (!tile || !tile.structureType || !tile.ownerId || !tile.connected) {
        queue.length = 0;
        continue;
      }

      order.remainingTime -= dt;

      if (order.remainingTime <= 0) {
        queue.shift();

        // Spawn unit
        const rallyKey = tileKey(bx, by);
        const rally = this.rallyPoints.get(rallyKey);
        const spawnX = rally ? rally.x : bx;
        const spawnY = rally ? rally.y : by + 1;

        // Try to merge into existing squad at spawn point
        let merged = false;
        for (const [, squad] of this.squads) {
          if (squad.ownerId !== tile.ownerId) continue;
          if (Math.abs(squad.x - bx) > 2 && Math.abs(squad.y - by) > 2) continue;
          if (squad.units.length >= 20) continue; // Max squad size
          if (squad.path.length > 0) continue; // Don't merge with moving squads

          const stats = UNIT_STATS[order.unitType];
          squad.units.push({
            id: uuidv4(),
            type: order.unitType,
            hp: stats.maxHp,
            maxHp: stats.maxHp,
          });
          merged = true;
          break;
        }

        if (!merged) {
          this.createSquad(tile.ownerId, spawnX, spawnY, [
            { type: order.unitType, count: 1 },
          ]);
        }

        // If there's a rally point, send the squad there
        if (rally) {
          // Find the squad we just added to or created
          for (const [sid, squad] of this.squads) {
            if (squad.ownerId === tile.ownerId && Math.abs(squad.x - bx) <= 2 && Math.abs(squad.y - by) <= 2) {
              if (!squad.targetX) {
                const path = MapGenerator.findPath(this.map, Math.round(squad.x), Math.round(squad.y), Math.round(rally.x), Math.round(rally.y));
                if (path) {
                  squad.targetX = Math.round(rally.x);
                  squad.targetY = Math.round(rally.y);
                  squad.path = path;
                  squad.pathIndex = 0;
                }
              }
              break;
            }
          }
        }
      }
    }
  }

  // ============================================================
  // Bots
  // ============================================================

  private runBots(dt: number): void {
    for (const [botId, botAI] of this.botAIs) {
      const player = this.players.get(botId);
      if (!player || !player.alive) continue;

      const commands = botAI.update(dt);
      for (const cmd of commands) {
        this.queueCommand(botId, cmd);
      }
    }
  }

  // ============================================================
  // Scoring & Win Conditions
  // ============================================================

  private updateScores(): void {
    for (const [playerId, player] of this.players) {
      if (!player.alive) continue;

      const stats = this.playerStats.get(playerId)!;
      player.score =
        player.territoryCount * 2 +
        stats.unitsKilled * 5 +
        stats.territoryCaptured * 1 +
        Math.floor(stats.goldEarned / 100);
    }
  }

  private eliminatePlayer(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    player.alive = false;
    this.eliminationCounter++;

    const stats = this.playerStats.get(playerId);
    if (stats) stats.eliminationOrder = this.eliminationCounter;

    // Remove all squads belonging to this player
    const toRemove: SquadId[] = [];
    for (const [sid, squad] of this.squads) {
      if (squad.ownerId === playerId) {
        toRemove.push(sid);
      }
    }
    for (const sid of toRemove) {
      this.removeSquad(sid);
    }

    // Clear territory
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y][x];
        if (tile.ownerId === playerId) {
          tile.ownerId = null;
          tile.captureProgress = 0;
          tile.capturingPlayerId = null;
          tile.connected = false;
          if (tile.structureType) {
            tile.structureType = null;
            tile.structureHp = 0;
          }
        }
      }
    }

    // Remove bot AI
    this.botAIs.delete(playerId);

    // Clear training queues for this player's buildings
    for (const [key, queue] of this.trainingQueues) {
      const [x, y] = key.split(',').map(Number);
      const tile = this.map.tiles[y]?.[x];
      if (tile && tile.ownerId === playerId) {
        this.trainingQueues.delete(key);
      }
    }

    this.tickEvents.push({
      type: 'player_eliminated',
      data: { playerId, username: player.username },
    });
  }

  private checkEndConditions(now: number): void {
    // Time expired
    if (now >= this.matchEndTime) {
      this.endMatch();
      return;
    }

    // Only one player remaining
    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
    if (alivePlayers.length <= 1) {
      this.endMatch();
      return;
    }
  }

  private endMatch(): void {
    this.phase = MatchPhase.Finished;
    this.stopTickLoop();

    const result = this.buildMatchResult();
    this.callbacks.onMatchEnd(result);
    this.callbacks.onPhaseChange(this.id, MatchPhase.Finished, result);
  }

  private buildMatchResult(): MatchResult {
    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
    const totalPlayers = this.players.size;

    const scores: ScoreEntry[] = Array.from(this.players.values()).map(player => {
      const stats = this.playerStats.get(player.id)!;
      return {
        playerId: player.id,
        username: player.username,
        isBot: player.isBot,
        score: player.score,
        territoryCaptured: stats.territoryCaptured,
        unitsKilled: stats.unitsKilled,
        unitsLost: stats.unitsLost,
        goldEarned: Math.round(stats.goldEarned),
        alive: player.alive,
        placement: 0, // calculated below
      };
    });

    // Sort by: alive first, then by score
    scores.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.score - a.score;
    });

    // Assign placements
    scores.forEach((s, i) => { s.placement = i + 1; });

    return {
      matchId: this.id,
      duration: (Date.now() - this.matchStartTime) / 1000,
      scores,
      winnerId: scores[0]?.playerId ?? null,
    };
  }

  // ============================================================
  // Squad Management
  // ============================================================

  createSquad(
    ownerId: PlayerId,
    x: number,
    y: number,
    composition: Array<{ type: UnitType; count: number }>
  ): SquadId {
    const squadId = uuidv4();
    const units: Unit[] = [];

    for (const { type, count } of composition) {
      const stats = UNIT_STATS[type];
      for (let i = 0; i < count; i++) {
        units.push({
          id: uuidv4(),
          type,
          hp: stats.maxHp,
          maxHp: stats.maxHp,
        });
      }
    }

    const squad: Squad = {
      id: squadId,
      ownerId,
      units,
      x,
      y,
      targetX: null,
      targetY: null,
      path: [],
      pathIndex: 0,
      moveProgress: 0,
    };

    this.squads.set(squadId, squad);
    this.spatialHash.insertOrUpdate({
      id: squadId,
      x,
      y,
      ownerId,
    });

    return squadId;
  }

  private removeSquad(squadId: SquadId): void {
    this.squads.delete(squadId);
    this.spatialHash.remove(squadId);
  }

  // ============================================================
  // State Broadcasting
  // ============================================================

  private broadcastState(): void {
    for (const [playerId, player] of this.players) {
      if (player.isBot || !player.connected) continue;

      const snapshot = this.buildSnapshot(playerId);
      this.callbacks.onStateUpdate(playerId, snapshot);
    }
  }

  private buildSnapshot(playerId: PlayerId): GameStateSnapshot {
    const player = this.players.get(playerId)!;
    const now = Date.now();

    let timeRemaining = 0;
    if (this.phase === MatchPhase.SpawnSelection) {
      timeRemaining = Math.max(0, (this.spawnPhaseEndTime - now) / 1000);
    } else if (this.phase === MatchPhase.Playing) {
      timeRemaining = Math.max(0, (this.matchEndTime - now) / 1000);
    }

    // Compute visibility (fog of war)
    const visibleSet = this.computeVisibility(playerId);

    // Build visible tiles
    const visibleTiles: VisibleTile[] = [];
    for (const key of visibleSet) {
      const [x, y] = key.split(',').map(Number);
      const tile = this.map.tiles[y][x];
      visibleTiles.push({
        x: tile.x,
        y: tile.y,
        terrain: tile.terrain,
        ownerId: tile.ownerId,
        structureType: tile.structureType,
        structureHp: tile.structureHp,
        captureProgress: tile.captureProgress,
        capturingPlayerId: tile.capturingPlayerId,
      });
    }

    // Build squad snapshots (only visible ones)
    const squads: SquadSnapshot[] = [];
    for (const [, squad] of this.squads) {
      // Always show own squads; others only if visible
      const squadKey = tileKey(Math.round(squad.x), Math.round(squad.y));
      if (squad.ownerId === playerId || visibleSet.has(squadKey)) {
        const composition: Partial<Record<UnitType, number>> = {};
        let totalHp = 0;
        let maxHp = 0;
        for (const unit of squad.units) {
          composition[unit.type] = (composition[unit.type] ?? 0) + 1;
          totalHp += unit.hp;
          maxHp += unit.maxHp;
        }

        squads.push({
          id: squad.id,
          ownerId: squad.ownerId,
          x: squad.x,
          y: squad.y,
          targetX: squad.ownerId === playerId ? squad.targetX : null,
          targetY: squad.ownerId === playerId ? squad.targetY : null,
          unitCount: squad.units.length,
          totalHp: Math.round(totalHp),
          maxHp: Math.round(maxHp),
          composition,
        });
      }
    }

    // Player public info
    const players: PlayerPublicInfo[] = Array.from(this.players.values()).map(p => ({
      id: p.id,
      username: p.username,
      color: p.color,
      alive: p.alive,
      score: p.score,
      isBot: p.isBot,
      territoryCount: p.territoryCount,
    }));

    return {
      tick: this.tick,
      phase: this.phase,
      timeRemaining,
      players,
      myGold: Math.floor(player.gold),
      myGoldPerSecond: player.goldPerSecond,
      visibleTiles,
      squads,
      events: [...this.tickEvents],
    };
  }

  private computeVisibility(playerId: PlayerId): Set<string> {
    const visible = new Set<string>();
    const radius = MATCH_CONFIG.FOG_OF_WAR_RADIUS;

    // Visibility from owned connected territory
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y][x];
        if (tile.ownerId === playerId) {
          // Add tiles in visibility radius around owned tiles
          // Optimization: only expand from border tiles
          this.addVisibilityRadius(visible, x, y, 3);
        }
      }
    }

    // Visibility from squads
    for (const [, squad] of this.squads) {
      if (squad.ownerId === playerId) {
        this.addVisibilityRadius(visible, Math.round(squad.x), Math.round(squad.y), radius);
      }
    }

    return visible;
  }

  private addVisibilityRadius(visible: Set<string>, cx: number, cy: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) continue;
        visible.add(tileKey(x, y));
      }
    }
  }

  // ============================================================
  // Public Accessors (for Bot AI and other systems)
  // ============================================================

  getMap(): GameMap {
    return this.map;
  }

  getPlayer(playerId: PlayerId): Player | undefined {
    return this.players.get(playerId);
  }

  getPlayers(): Map<PlayerId, Player> {
    return this.players;
  }

  getSquads(): Map<SquadId, Squad> {
    return this.squads;
  }

  getSquadsByOwner(ownerId: PlayerId): Squad[] {
    const result: Squad[] = [];
    for (const [, squad] of this.squads) {
      if (squad.ownerId === ownerId) {
        result.push(squad);
      }
    }
    return result;
  }

  getPhase(): MatchPhase {
    return this.phase;
  }

  getTick(): number {
    return this.tick;
  }

  getTrainingQueue(x: number, y: number): TrainingOrder[] {
    return this.trainingQueues.get(tileKey(x, y)) ?? [];
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getAlivePlayerCount(): number {
    let count = 0;
    for (const [, p] of this.players) {
      if (p.alive) count++;
    }
    return count;
  }

  getSpawnLocations(): Array<{ x: number; y: number }> {
    return this.spawnLocations;
  }

  isPlayerAlive(playerId: PlayerId): boolean {
    const player = this.players.get(playerId);
    return player?.alive ?? false;
  }

  getFullMapForSpawn(): { width: number; height: number; terrain: TerrainType[][] } {
    const terrain: TerrainType[][] = [];
    for (let y = 0; y < this.map.height; y++) {
      terrain[y] = [];
      for (let x = 0; x < this.map.width; x++) {
        terrain[y][x] = this.map.tiles[y][x].terrain;
      }
    }
    return { width: this.map.width, height: this.map.height, terrain };
  }

  playerDisconnected(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      // Convert to bot after a delay in real implementation
      // For now, just create a bot AI to take over
      if (!player.isBot && player.alive) {
        player.isBot = true;
        this.botAIs.set(playerId, new BotAI(playerId, this));
      }
    }
  }

  playerReconnected(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = true;
      player.isBot = false;
      this.botAIs.delete(playerId);
    }
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.stopTickLoop();
    this.squads.clear();
    this.spatialHash.clear();
    this.trainingQueues.clear();
    this.botAIs.clear();
    this.pendingCommands.length = 0;
  }
}
