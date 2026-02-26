// ============================================================
// Fractured Crowns — Bot AI
// Simple behavior-tree-style AI for bot players
// ============================================================

import {
  PlayerId,
  GameCommand,
  CommandType,
  UnitType,
  StructureType,
  TerrainType,
  Squad,
  Player,
  Tile,
  UNIT_STATS,
  BUILDING_COSTS,
  ECONOMY,
  MATCH_CONFIG,
  tileKey,
  distanceSq,
} from '../types/game';

// Forward reference to Match — we use a lightweight interface to avoid circular deps
interface MatchAccessor {
  getMap(): { width: number; height: number; tiles: Tile[][] };
  getPlayer(playerId: PlayerId): Player | undefined;
  getPlayers(): Map<PlayerId, Player>;
  getSquads(): Map<string, Squad>;
  getSquadsByOwner(ownerId: PlayerId): Squad[];
  getTick(): number;
  getTrainingQueue(x: number, y: number): Array<{ unitType: UnitType; remainingTime: number }>;
}

// ---- Bot Behavior State ----

enum BotState {
  Expanding = 'expanding',
  Building = 'building',
  Training = 'training',
  Attacking = 'attacking',
  Defending = 'defending',
}

interface BotMemory {
  state: BotState;
  lastActionTick: number;
  lastBuildTick: number;
  lastTrainTick: number;
  lastAttackTick: number;
  targetPlayerId: PlayerId | null;
  expandDirection: { dx: number; dy: number };
  knownMines: Array<{ x: number; y: number }>;
  threatLevel: number;
  actionCooldown: number;
}

export class BotAI {
  private playerId: PlayerId;
  private match: MatchAccessor;
  private memory: BotMemory;
  private tickAccumulator: number = 0;
  private decisionInterval: number; // seconds between AI decisions

  constructor(playerId: PlayerId, match: MatchAccessor) {
    this.playerId = playerId;
    this.match = match;

    // Randomize decision interval slightly so bots don't all act in sync
    this.decisionInterval = 0.8 + Math.random() * 0.6; // 0.8–1.4 seconds

    // Pick a random expand direction
    const angle = Math.random() * Math.PI * 2;

    this.memory = {
      state: BotState.Expanding,
      lastActionTick: 0,
      lastBuildTick: 0,
      lastTrainTick: 0,
      lastAttackTick: 0,
      targetPlayerId: null,
      expandDirection: {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
      },
      knownMines: [],
      threatLevel: 0,
      actionCooldown: 0,
    };
  }

  /**
   * Called each tick. Returns commands for this bot to execute.
   */
  update(dt: number): GameCommand[] {
    this.tickAccumulator += dt;
    if (this.tickAccumulator < this.decisionInterval) {
      return [];
    }
    this.tickAccumulator = 0;

    const player = this.match.getPlayer(this.playerId);
    if (!player || !player.alive) return [];

    const commands: GameCommand[] = [];
    const map = this.match.getMap();
    const mySquads = this.match.getSquadsByOwner(this.playerId);

    // Scan environment
    this.scanEnvironment(player, map, mySquads);

    // Decide state based on situation
    this.decideState(player, mySquads);

    // Execute based on state
    switch (this.memory.state) {
      case BotState.Defending:
        this.executeDefend(commands, player, map, mySquads);
        break;
      case BotState.Attacking:
        this.executeAttack(commands, player, map, mySquads);
        break;
      case BotState.Building:
        this.executeBuild(commands, player, map);
        break;
      case BotState.Training:
        this.executeTrain(commands, player, map);
        break;
      case BotState.Expanding:
        this.executeExpand(commands, player, map, mySquads);
        break;
    }

    // Always try to train if we have gold (regardless of state)
    this.opportunisticTrain(commands, player, map);

    // Always try to build if we have gold (regardless of state)
    this.opportunisticBuild(commands, player, map);

    return commands;
  }

  // ============================================================
  // Environment Scanning
  // ============================================================

  private scanEnvironment(player: Player, map: { width: number; height: number; tiles: Tile[][] }, mySquads: Squad[]): void {
    // Find nearby mines we don't own
    this.memory.knownMines = [];
    const scanRadius = 25;

    for (let dy = -scanRadius; dy <= scanRadius; dy++) {
      for (let dx = -scanRadius; dx <= scanRadius; dx++) {
        const x = player.capitalX + dx;
        const y = player.capitalY + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;

        const tile = map.tiles[y][x];
        if (tile.terrain === TerrainType.Mine && tile.ownerId !== this.playerId) {
          this.memory.knownMines.push({ x, y });
        }
      }
    }

    // Sort mines by distance to capital
    this.memory.knownMines.sort((a, b) => {
      const da = distanceSq(a.x, a.y, player.capitalX, player.capitalY);
      const db = distanceSq(b.x, b.y, player.capitalX, player.capitalY);
      return da - db;
    });

    // Assess threat level
    this.memory.threatLevel = 0;
    const allSquads = this.match.getSquads();
    for (const [, squad] of allSquads) {
      if (squad.ownerId === this.playerId) continue;
      const dist = Math.sqrt(distanceSq(squad.x, squad.y, player.capitalX, player.capitalY));
      if (dist < 15) {
        this.memory.threatLevel += squad.units.length * (15 - dist) / 15;
      }
    }
  }

  // ============================================================
  // State Decision
  // ============================================================

  private decideState(player: Player, mySquads: Squad[]): void {
    const totalUnits = mySquads.reduce((sum, s) => sum + s.units.length, 0);
    const tick = this.match.getTick();

    // High threat → defend
    if (this.memory.threatLevel > 5) {
      this.memory.state = BotState.Defending;
      return;
    }

    // Have enough units and gold → attack
    if (totalUnits >= 12 && player.gold > 200 && tick - this.memory.lastAttackTick > MATCH_CONFIG.TICK_RATE * 30) {
      this.memory.state = BotState.Attacking;
      return;
    }

    // Low on units → train
    if (totalUnits < 6) {
      this.memory.state = BotState.Training;
      return;
    }

    // Have uncaptured nearby mines → expand
    if (this.memory.knownMines.length > 0 && totalUnits >= 3) {
      this.memory.state = BotState.Expanding;
      return;
    }

    // Have gold → build
    if (player.gold > 150) {
      this.memory.state = BotState.Building;
      return;
    }

    // Default: expand
    this.memory.state = BotState.Expanding;
  }

  // ============================================================
  // Behavior Execution
  // ============================================================

  private executeDefend(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }, mySquads: Squad[]): void {
    // Move all idle squads toward capital
    for (const squad of mySquads) {
      if (squad.path.length > 0) continue; // Already moving
      if (squad.units.length === 0) continue;

      const dist = Math.sqrt(distanceSq(squad.x, squad.y, player.capitalX, player.capitalY));
      if (dist > 5) {
        commands.push({
          type: CommandType.MoveSquad,
          squadId: squad.id,
          targetX: player.capitalX + Math.round((Math.random() - 0.5) * 4),
          targetY: player.capitalY + Math.round((Math.random() - 0.5) * 4),
        });
      }
    }

    // Build towers near capital if we can afford them
    if (player.gold >= BUILDING_COSTS[StructureType.Tower].gold) {
      const positions = this.findBuildPositionsNear(map, player.capitalX, player.capitalY, 4);
      for (const pos of positions) {
        const tile = map.tiles[pos.y][pos.x];
        if (tile.ownerId === this.playerId && !tile.structureType && tile.connected) {
          commands.push({
            type: CommandType.BuildStructure,
            structureType: StructureType.Tower,
            x: pos.x,
            y: pos.y,
          });
          break;
        }
      }
    }
  }

  private executeAttack(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }, mySquads: Squad[]): void {
    this.memory.lastAttackTick = this.match.getTick();

    // Find weakest enemy neighbor
    const target = this.findWeakestNeighbor(player, map);
    if (!target) {
      this.memory.state = BotState.Expanding;
      return;
    }

    this.memory.targetPlayerId = target.id;

    // Send all available squads toward enemy capital
    for (const squad of mySquads) {
      if (squad.units.length < 2) continue; // Don't send tiny squads

      commands.push({
        type: CommandType.MoveSquad,
        squadId: squad.id,
        targetX: target.capitalX + Math.round((Math.random() - 0.5) * 6),
        targetY: target.capitalY + Math.round((Math.random() - 0.5) * 6),
      });
    }
  }

  private executeBuild(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }): void {
    const tick = this.match.getTick();
    if (tick - this.memory.lastBuildTick < MATCH_CONFIG.TICK_RATE * 3) return;
    this.memory.lastBuildTick = tick;

    // Priority 1: Upgrade owned mines
    if (player.gold >= BUILDING_COSTS[StructureType.MineUpgrade].gold) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const tile = map.tiles[y][x];
          if (
            tile.terrain === TerrainType.Mine &&
            tile.ownerId === this.playerId &&
            tile.connected &&
            tile.mineLevel < 2
          ) {
            commands.push({
              type: CommandType.BuildStructure,
              structureType: StructureType.MineUpgrade,
              x,
              y,
            });
            return;
          }
        }
      }
    }

    // Priority 2: Build barracks near capital
    if (player.gold >= BUILDING_COSTS[StructureType.Barracks].gold) {
      const barracksCount = this.countStructures(map, StructureType.Barracks);
      if (barracksCount < 2) {
        const positions = this.findBuildPositionsNear(map, player.capitalX, player.capitalY, 5);
        for (const pos of positions) {
          const tile = map.tiles[pos.y][pos.x];
          if (tile.ownerId === this.playerId && !tile.structureType && tile.connected) {
            if (tile.terrain === TerrainType.Plains) {
              commands.push({
                type: CommandType.BuildStructure,
                structureType: StructureType.Barracks,
                x: pos.x,
                y: pos.y,
              });
              return;
            }
          }
        }
      }
    }

    // Priority 3: Build walls on border tiles
    if (player.gold >= BUILDING_COSTS[StructureType.Wall].gold * 3) {
      const borderTiles = this.findBorderTiles(map, 3);
      for (const pos of borderTiles) {
        const tile = map.tiles[pos.y][pos.x];
        if (!tile.structureType && tile.connected && tile.terrain === TerrainType.Plains) {
          commands.push({
            type: CommandType.BuildStructure,
            structureType: StructureType.Wall,
            x: pos.x,
            y: pos.y,
          });
          return;
        }
      }
    }
  }

  private executeTrain(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }): void {
    const tick = this.match.getTick();
    if (tick - this.memory.lastTrainTick < MATCH_CONFIG.TICK_RATE * 2) return;
    this.memory.lastTrainTick = tick;

    this.trainUnitsAtBuildings(commands, player, map);
  }

  private executeExpand(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }, mySquads: Squad[]): void {
    // Send idle squads toward nearest uncaptured mine
    if (this.memory.knownMines.length > 0) {
      const targetMine = this.memory.knownMines[0];

      for (const squad of mySquads) {
        if (squad.path.length > 0) continue; // Already moving
        if (squad.units.length === 0) continue;

        commands.push({
          type: CommandType.MoveSquad,
          squadId: squad.id,
          targetX: targetMine.x,
          targetY: targetMine.y,
        });
        break; // Send one squad at a time
      }
    } else {
      // No known mines — expand in a random direction
      const expandX = Math.round(
        player.capitalX + this.memory.expandDirection.dx * (10 + Math.random() * 15)
      );
      const expandY = Math.round(
        player.capitalY + this.memory.expandDirection.dy * (10 + Math.random() * 15)
      );

      const clampedX = Math.max(5, Math.min(map.width - 5, expandX));
      const clampedY = Math.max(5, Math.min(map.height - 5, expandY));

      for (const squad of mySquads) {
        if (squad.path.length > 0) continue;
        if (squad.units.length === 0) continue;

        commands.push({
          type: CommandType.MoveSquad,
          squadId: squad.id,
          targetX: clampedX,
          targetY: clampedY,
        });
        break;
      }

      // Rotate expand direction slightly
      const rotAngle = (Math.random() - 0.5) * 0.8;
      const cos = Math.cos(rotAngle);
      const sin = Math.sin(rotAngle);
      const ndx = this.memory.expandDirection.dx * cos - this.memory.expandDirection.dy * sin;
      const ndy = this.memory.expandDirection.dx * sin + this.memory.expandDirection.dy * cos;
      this.memory.expandDirection.dx = ndx;
      this.memory.expandDirection.dy = ndy;
    }
  }

  // ============================================================
  // Opportunistic Actions (always run)
  // ============================================================

  private opportunisticTrain(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }): void {
    // Only train if we have enough gold
    const cheapestUnit = UNIT_STATS[UnitType.Militia].cost;
    if (player.gold < cheapestUnit) return;

    this.trainUnitsAtBuildings(commands, player, map);
  }

  private opportunisticBuild(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }): void {
    // Build roads between capital and mines if we have spare gold
    if (player.gold > 500 && Math.random() < 0.3) {
      // Find a random owned tile without a road near capital
      const positions = this.findBuildPositionsNear(map, player.capitalX, player.capitalY, 8);
      for (const pos of positions) {
        const tile = map.tiles[pos.y][pos.x];
        if (
          tile.ownerId === this.playerId &&
          !tile.structureType &&
          tile.connected &&
          tile.terrain === TerrainType.Plains
        ) {
          commands.push({
            type: CommandType.BuildStructure,
            structureType: StructureType.Road,
            x: pos.x,
            y: pos.y,
          });
          return;
        }
      }
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private trainUnitsAtBuildings(commands: GameCommand[], player: Player, map: { width: number; height: number; tiles: Tile[][] }): void {
    // Find production buildings
    const buildings: Array<{ x: number; y: number; type: StructureType }> = [];

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        if (tile.ownerId !== this.playerId) continue;
        if (!tile.connected) continue;
        if (tile.structureType === StructureType.Castle || tile.structureType === StructureType.Barracks) {
          buildings.push({ x, y, type: tile.structureType });
        }
      }
    }

    for (const building of buildings) {
      const queue = this.match.getTrainingQueue(building.x, building.y);
      if (queue.length >= 3) continue; // Queue not full but give some breathing room

      // Decide unit type based on situation and gold
      let unitType = UnitType.Militia;
      const gold = player.gold;

      if (gold > 200 && Math.random() < 0.4) {
        unitType = UnitType.Soldier;
      }
      if (gold > 300 && Math.random() < 0.25) {
        unitType = UnitType.Archer;
      }
      if (gold > 400 && Math.random() < 0.15) {
        unitType = UnitType.Knight;
      }
      if (gold > 500 && this.memory.state === BotState.Attacking && Math.random() < 0.1) {
        unitType = UnitType.SiegeRam;
      }

      const cost = UNIT_STATS[unitType].cost;
      if (player.gold < cost) {
        unitType = UnitType.Militia;
        if (player.gold < UNIT_STATS[UnitType.Militia].cost) continue;
      }

      commands.push({
        type: CommandType.TrainUnit,
        unitType,
        buildingX: building.x,
        buildingY: building.y,
      });

      // Only queue one unit per decision cycle per building
      break;
    }
  }

  private findWeakestNeighbor(player: Player, map: { width: number; height: number; tiles: Tile[][] }): Player | null {
    const players = this.match.getPlayers();
    let weakest: Player | null = null;
    let weakestScore = Infinity;

    for (const [pid, p] of players) {
      if (pid === this.playerId) continue;
      if (!p.alive) continue;

      // Check if this player is a neighbor (shares border)
      const dist = Math.sqrt(distanceSq(player.capitalX, player.capitalY, p.capitalX, p.capitalY));
      if (dist > 50) continue; // Too far away

      // Score: lower is weaker (prefer to attack weak nearby players)
      const score = p.territoryCount * 2 + p.score + dist * 3;
      if (score < weakestScore) {
        weakestScore = score;
        weakest = p;
      }
    }

    return weakest;
  }

  private findBuildPositionsNear(
    map: { width: number; height: number; tiles: Tile[][] },
    cx: number,
    cy: number,
    radius: number
  ): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number; dist: number }> = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;

        const dist = dx * dx + dy * dy;
        if (dist > radius * radius) continue;

        positions.push({ x, y, dist });
      }
    }

    // Sort by distance
    positions.sort((a, b) => a.dist - b.dist);
    return positions.map(p => ({ x: p.x, y: p.y }));
  }

  private findBorderTiles(map: { width: number; height: number; tiles: Tile[][] }, maxCount: number): Array<{ x: number; y: number }> {
    const borders: Array<{ x: number; y: number }> = [];
    const directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    for (let y = 0; y < map.height && borders.length < maxCount * 3; y++) {
      for (let x = 0; x < map.width && borders.length < maxCount * 3; x++) {
        const tile = map.tiles[y][x];
        if (tile.ownerId !== this.playerId) continue;

        // Check if it's a border tile (adjacent to non-owned tile)
        let isBorder = false;
        for (const dir of directions) {
          const nx = x + dir.dx;
          const ny = y + dir.dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          if (map.tiles[ny][nx].ownerId !== this.playerId) {
            isBorder = true;
            break;
          }
        }

        if (isBorder) {
          borders.push({ x, y });
        }
      }
    }

    // Shuffle and take maxCount
    for (let i = borders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [borders[i], borders[j]] = [borders[j], borders[i]];
    }

    return borders.slice(0, maxCount);
  }

  private countStructures(map: { width: number; height: number; tiles: Tile[][] }, structureType: StructureType): number {
    let count = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        if (tile.ownerId === this.playerId && tile.structureType === structureType) {
          count++;
        }
      }
    }
    return count;
  }
}
