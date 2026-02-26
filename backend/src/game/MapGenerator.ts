// ============================================================
// Fractured Crowns — Map Generator
// ============================================================

import {
  GameMap,
  Tile,
  TerrainType,
  MATCH_CONFIG,
  tileKey,
} from '../types/game';

// Simple seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise for terrain generation
class ValueNoise {
  private permutation: number[];
  private values: number[];
  private rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.permutation = [];
    this.values = [];

    for (let i = 0; i < 256; i++) {
      this.permutation.push(i);
      this.values.push(this.rng());
    }

    // Shuffle permutation table
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }

    // Duplicate for wrapping
    this.permutation = [...this.permutation, ...this.permutation];
    this.values = [...this.values, ...this.values];
  }

  private hash(x: number, y: number): number {
    return this.permutation[(this.permutation[x & 255] + y) & 511];
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = this.smoothstep(x - xi);
    const yf = this.smoothstep(y - yi);

    const v00 = this.values[this.hash(xi, yi)];
    const v10 = this.values[this.hash(xi + 1, yi)];
    const v01 = this.values[this.hash(xi, yi + 1)];
    const v11 = this.values[this.hash(xi + 1, yi + 1)];

    const top = this.lerp(v00, v10, xf);
    const bottom = this.lerp(v01, v11, xf);

    return this.lerp(top, bottom, yf);
  }

  // Fractal Brownian Motion for more natural terrain
  fbm(x: number, y: number, octaves: number = 4, lacunarity: number = 2.0, gain: number = 0.5): number {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.sample(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

export class MapGenerator {
  private rng: () => number;

  constructor(private seed: number = Date.now()) {
    this.rng = mulberry32(seed);
  }

  generate(width: number = MATCH_CONFIG.MAP_WIDTH, height: number = MATCH_CONFIG.MAP_HEIGHT): GameMap {
    const terrainNoise = new ValueNoise(this.seed);
    const forestNoise = new ValueNoise(this.seed + 1337);
    const waterNoise = new ValueNoise(this.seed + 42069);

    // Initialize tiles
    const tiles: Tile[][] = [];

    for (let y = 0; y < height; y++) {
      tiles[y] = [];
      for (let x = 0; x < width; x++) {
        const elevation = terrainNoise.fbm(x / 30, y / 30, 5, 2.0, 0.5);
        const forestValue = forestNoise.fbm(x / 20, y / 20, 3, 2.0, 0.6);
        const waterValue = waterNoise.fbm(x / 40, y / 40, 3, 2.0, 0.5);

        let terrain = TerrainType.Plains;

        // Mountains at high elevation
        if (elevation > 0.72) {
          terrain = TerrainType.Mountain;
        }
        // Water at low elevation combined with water noise
        else if (elevation < 0.28 && waterValue > 0.55) {
          terrain = TerrainType.Water;
        }
        // Forest where forest noise is high and elevation is mid-range
        else if (forestValue > 0.58 && elevation > 0.3 && elevation < 0.65) {
          terrain = TerrainType.Forest;
        }

        // Add border mountains to create natural map boundary
        const borderDist = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (borderDist <= 2) {
          terrain = TerrainType.Mountain;
        } else if (borderDist <= 4 && elevation > 0.55) {
          terrain = TerrainType.Mountain;
        }

        tiles[y][x] = {
          x,
          y,
          terrain,
          ownerId: null,
          structureType: null,
          structureHp: 0,
          captureProgress: 0,
          capturingPlayerId: null,
          connected: false,
          mineLevel: 0,
        };
      }
    }

    // Place mines strategically
    this.placeMines(tiles, width, height);

    // Ensure connectivity by clearing isolated mountain clusters
    this.ensureConnectivity(tiles, width, height);

    return { width, height, tiles };
  }

  private placeMines(tiles: Tile[][], width: number, height: number): void {
    const mineCount = Math.floor((width * height) / 300); // ~48 mines for 120x120
    const mines: Array<{ x: number; y: number }> = [];
    const minMineDistance = 8;
    const borderPadding = 8;

    let attempts = 0;
    const maxAttempts = mineCount * 50;

    while (mines.length < mineCount && attempts < maxAttempts) {
      attempts++;

      const x = borderPadding + Math.floor(this.rng() * (width - borderPadding * 2));
      const y = borderPadding + Math.floor(this.rng() * (height - borderPadding * 2));

      // Must be on passable terrain
      if (tiles[y][x].terrain === TerrainType.Mountain || tiles[y][x].terrain === TerrainType.Water) {
        continue;
      }

      // Check distance from other mines
      let tooClose = false;
      for (const mine of mines) {
        const dx = mine.x - x;
        const dy = mine.y - y;
        if (dx * dx + dy * dy < minMineDistance * minMineDistance) {
          tooClose = true;
          break;
        }
      }

      if (tooClose) continue;

      // Ensure surrounding area has some passable tiles (not buried in mountains)
      let passableNeighbors = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (tiles[ny][nx].terrain !== TerrainType.Mountain && tiles[ny][nx].terrain !== TerrainType.Water) {
              passableNeighbors++;
            }
          }
        }
      }

      if (passableNeighbors < 12) continue;

      tiles[y][x].terrain = TerrainType.Mine;
      tiles[y][x].mineLevel = 0;
      mines.push({ x, y });
    }
  }

  private ensureConnectivity(tiles: Tile[][], width: number, height: number): void {
    // Break up large impassable clusters to ensure map is navigable
    // Use a pass to remove mountain tiles that create 3x3+ solid blocks
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y][x].terrain !== TerrainType.Mountain) continue;

        // Don't modify border mountains
        const borderDist = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (borderDist <= 3) continue;

        // Count mountain neighbors in a cross pattern
        let mountainNeighbors = 0;
        const directions = [
          [-1, 0], [1, 0], [0, -1], [0, 1],
          [-1, -1], [1, -1], [-1, 1], [1, 1],
        ];

        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (tiles[ny][nx].terrain === TerrainType.Mountain) {
              mountainNeighbors++;
            }
          }
        }

        // If fully surrounded by mountains, randomly clear some to create passes
        if (mountainNeighbors >= 7 && this.rng() < 0.3) {
          tiles[y][x].terrain = TerrainType.Plains;
        }
      }
    }
  }

  /**
   * Find valid spawn locations for players.
   * Spawns must be:
   * - On plains terrain
   * - Minimum distance from other spawns
   * - Near at least one mine
   * - Have enough open space for initial expansion
   */
  findSpawnLocations(map: GameMap, count: number): Array<{ x: number; y: number }> {
    const spawns: Array<{ x: number; y: number }> = [];
    const minDist = MATCH_CONFIG.MIN_SPAWN_DISTANCE;
    const padding = 12;
    const maxMineDistance = 15;

    // Collect mine positions for proximity checks
    const mines: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.tiles[y][x].terrain === TerrainType.Mine) {
          mines.push({ x, y });
        }
      }
    }

    // Generate candidate positions scored by quality
    const candidates: Array<{ x: number; y: number; score: number }> = [];

    for (let y = padding; y < map.height - padding; y += 3) {
      for (let x = padding; x < map.width - padding; x += 3) {
        const tile = map.tiles[y][x];
        if (tile.terrain !== TerrainType.Plains) continue;

        // Check open space around
        let openSpace = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
              const t = map.tiles[ny][nx].terrain;
              if (t === TerrainType.Plains || t === TerrainType.Forest) {
                openSpace++;
              }
            }
          }
        }

        if (openSpace < 30) continue;

        // Find nearest mine distance
        let nearestMineDist = Infinity;
        for (const mine of mines) {
          const dist = Math.abs(mine.x - x) + Math.abs(mine.y - y);
          if (dist < nearestMineDist) nearestMineDist = dist;
        }

        if (nearestMineDist > maxMineDistance) continue;

        // Score: prefer locations near mines with lots of open space, away from edges
        const edgeDist = Math.min(x, y, map.width - x, map.height - y);
        const score = openSpace * 2 - nearestMineDist * 3 + edgeDist * 0.5;

        candidates.push({ x, y, score });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Greedy selection with distance constraint
    for (const candidate of candidates) {
      if (spawns.length >= count) break;

      let valid = true;
      for (const spawn of spawns) {
        const dx = spawn.x - candidate.x;
        const dy = spawn.y - candidate.y;
        if (dx * dx + dy * dy < minDist * minDist) {
          valid = false;
          break;
        }
      }

      if (valid) {
        spawns.push({ x: candidate.x, y: candidate.y });
      }
    }

    // If we couldn't find enough spawns, relax constraints
    if (spawns.length < count) {
      const relaxedMinDist = minDist * 0.6;
      for (const candidate of candidates) {
        if (spawns.length >= count) break;

        let valid = true;
        for (const spawn of spawns) {
          const dx = spawn.x - candidate.x;
          const dy = spawn.y - candidate.y;
          if (dx * dx + dy * dy < relaxedMinDist * relaxedMinDist) {
            valid = false;
            break;
          }
        }

        if (valid) {
          spawns.push({ x: candidate.x, y: candidate.y });
        }
      }
    }

    return spawns;
  }

  /**
   * Check if a specific tile is a valid spawn location.
   */
  isValidSpawn(
    map: GameMap,
    x: number,
    y: number,
    existingSpawns: Array<{ x: number; y: number }>
  ): boolean {
    if (x < 5 || y < 5 || x >= map.width - 5 || y >= map.height - 5) return false;

    const tile = map.tiles[y][x];
    if (tile.terrain === TerrainType.Mountain || tile.terrain === TerrainType.Water) return false;

    // Check minimum distance from existing spawns
    for (const spawn of existingSpawns) {
      const dx = spawn.x - x;
      const dy = spawn.y - y;
      if (dx * dx + dy * dy < MATCH_CONFIG.MIN_SPAWN_DISTANCE * MATCH_CONFIG.MIN_SPAWN_DISTANCE) {
        return false;
      }
    }

    // Check open space
    let openSpace = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
          const t = map.tiles[ny][nx].terrain;
          if (t !== TerrainType.Mountain && t !== TerrainType.Water) {
            openSpace++;
          }
        }
      }
    }

    return openSpace >= 18;
  }

  /**
   * Get all passable neighbors of a tile (for pathfinding).
   */
  static getPassableNeighbors(map: GameMap, x: number, y: number): Array<{ x: number; y: number; cost: number }> {
    const neighbors: Array<{ x: number; y: number; cost: number }> = [];
    const directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;

      const tile = map.tiles[ny][nx];
      if (tile.terrain === TerrainType.Mountain) continue;

      let cost = 1.0;
      if (tile.terrain === TerrainType.Forest) cost = 1.5;
      if (tile.terrain === TerrainType.Water) cost = 2.5;
      if (tile.structureType === 'road' as any) cost = 0.6;

      neighbors.push({ x: nx, y: ny, cost });
    }

    return neighbors;
  }

  /**
   * A* pathfinding on the game map.
   */
  static findPath(
    map: GameMap,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    maxSteps: number = 500
  ): Array<{ x: number; y: number }> | null {
    if (startX === endX && startY === endY) return [];

    const endTile = map.tiles[endY]?.[endX];
    if (!endTile || endTile.terrain === TerrainType.Mountain) return null;

    const openSet = new MinHeap<{ x: number; y: number; f: number; g: number }>(
      (a, b) => a.f - b.f
    );
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();

    const startKey = tileKey(startX, startY);
    const endKey = tileKey(endX, endY);

    gScore.set(startKey, 0);
    const h = Math.abs(endX - startX) + Math.abs(endY - startY);
    openSet.push({ x: startX, y: startY, f: h, g: 0 });

    const visited = new Set<string>();
    let steps = 0;

    while (openSet.size > 0 && steps < maxSteps) {
      steps++;
      const current = openSet.pop()!;
      const currentKey = tileKey(current.x, current.y);

      if (currentKey === endKey) {
        // Reconstruct path
        const path: Array<{ x: number; y: number }> = [];
        let key = endKey;
        while (key !== startKey) {
          const { x, y } = parseTileKeyLocal(key);
          path.unshift({ x, y });
          key = cameFrom.get(key)!;
        }
        return path;
      }

      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      const neighbors = MapGenerator.getPassableNeighbors(map, current.x, current.y);
      for (const neighbor of neighbors) {
        const neighborKey = tileKey(neighbor.x, neighbor.y);
        if (visited.has(neighborKey)) continue;

        const tentativeG = current.g + neighbor.cost;
        const existingG = gScore.get(neighborKey) ?? Infinity;

        if (tentativeG < existingG) {
          cameFrom.set(neighborKey, currentKey);
          gScore.set(neighborKey, tentativeG);
          const fScore = tentativeG + Math.abs(endX - neighbor.x) + Math.abs(endY - neighbor.y);
          openSet.push({ x: neighbor.x, y: neighbor.y, f: fScore, g: tentativeG });
        }
      }
    }

    return null; // No path found
  }
}

// Local helper
function parseTileKeyLocal(key: string): { x: number; y: number } {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

// Min-heap implementation for A*
class MinHeap<T> {
  private data: T[] = [];

  constructor(private comparator: (a: T, b: T) => number) {}

  get size(): number {
    return this.data.length;
  }

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.comparator(this.data[i], this.data[parent]) < 0) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(i: number): void {
    const length = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < length && this.comparator(this.data[left], this.data[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.comparator(this.data[right], this.data[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else {
        break;
      }
    }
  }
}
