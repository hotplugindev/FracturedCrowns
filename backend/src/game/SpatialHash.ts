// ============================================================
// Fractured Crowns — Spatial Hash Grid
// Efficient spatial partitioning for entity lookups (combat, proximity)
// ============================================================

import { SquadId, SPATIAL_HASH_CELL_SIZE } from '../types/game';

interface SpatialEntry {
  id: SquadId;
  x: number;
  y: number;
  ownerId: string;
}

export class SpatialHash {
  private cellSize: number;
  private cells: Map<string, SpatialEntry[]>;
  private entityCells: Map<SquadId, string>; // track which cell each entity is in

  constructor(cellSize: number = SPATIAL_HASH_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityCells = new Map();
  }

  private getCellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  /**
   * Clear and rebuild from scratch. Use when full rebuild is needed.
   */
  clear(): void {
    this.cells.clear();
    this.entityCells.clear();
  }

  /**
   * Insert or update an entity in the spatial hash.
   */
  insertOrUpdate(entry: SpatialEntry): void {
    const newCellKey = this.getCellKey(entry.x, entry.y);
    const oldCellKey = this.entityCells.get(entry.id);

    // If entity hasn't moved cells, just update in place
    if (oldCellKey === newCellKey) {
      const cell = this.cells.get(newCellKey);
      if (cell) {
        const idx = cell.findIndex(e => e.id === entry.id);
        if (idx !== -1) {
          cell[idx] = entry;
        } else {
          cell.push(entry);
        }
      }
      return;
    }

    // Remove from old cell
    if (oldCellKey) {
      this.removeFromCell(entry.id, oldCellKey);
    }

    // Insert into new cell
    let cell = this.cells.get(newCellKey);
    if (!cell) {
      cell = [];
      this.cells.set(newCellKey, cell);
    }
    cell.push(entry);
    this.entityCells.set(entry.id, newCellKey);
  }

  /**
   * Remove an entity from the spatial hash.
   */
  remove(id: SquadId): void {
    const cellKey = this.entityCells.get(id);
    if (cellKey) {
      this.removeFromCell(id, cellKey);
      this.entityCells.delete(id);
    }
  }

  private removeFromCell(id: SquadId, cellKey: string): void {
    const cell = this.cells.get(cellKey);
    if (!cell) return;

    const idx = cell.findIndex(e => e.id === id);
    if (idx !== -1) {
      // Swap with last element for O(1) removal
      cell[idx] = cell[cell.length - 1];
      cell.pop();
    }

    // Clean up empty cells
    if (cell.length === 0) {
      this.cells.delete(cellKey);
    }
  }

  /**
   * Query all entities within a given radius of a point.
   * Returns entries sorted by distance (nearest first).
   */
  queryRadius(x: number, y: number, radius: number): SpatialEntry[] {
    const results: SpatialEntry[] = [];
    const radiusSq = radius * radius;

    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cellKey = `${cx},${cy}`;
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        for (const entry of cell) {
          const dx = entry.x - x;
          const dy = entry.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= radiusSq) {
            results.push(entry);
          }
        }
      }
    }

    // Sort by distance
    results.sort((a, b) => {
      const da = (a.x - x) ** 2 + (a.y - y) ** 2;
      const db = (b.x - x) ** 2 + (b.y - y) ** 2;
      return da - db;
    });

    return results;
  }

  /**
   * Query all entities within the same tile (exact tile match).
   */
  queryTile(tileX: number, tileY: number): SpatialEntry[] {
    const results: SpatialEntry[] = [];
    const cellKey = this.getCellKey(tileX, tileY);
    const cell = this.cells.get(cellKey);
    if (!cell) return results;

    for (const entry of cell) {
      if (Math.floor(entry.x) === tileX && Math.floor(entry.y) === tileY) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Query all entities within a rectangular region.
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): SpatialEntry[] {
    const results: SpatialEntry[] = [];

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCy = Math.floor(minY / this.cellSize);
    const maxCy = Math.floor(maxY / this.cellSize);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cellKey = `${cx},${cy}`;
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        for (const entry of cell) {
          if (entry.x >= minX && entry.x <= maxX && entry.y >= minY && entry.y <= maxY) {
            results.push(entry);
          }
        }
      }
    }

    return results;
  }

  /**
   * Find the nearest enemy squad to a given position.
   * Expands search radius incrementally for efficiency.
   */
  findNearestEnemy(x: number, y: number, ownerId: string, maxRadius: number = 30): SpatialEntry | null {
    // Start with a small radius and expand
    let radius = this.cellSize;
    while (radius <= maxRadius) {
      const entries = this.queryRadius(x, y, radius);
      for (const entry of entries) {
        if (entry.ownerId !== ownerId) {
          return entry;
        }
      }
      radius += this.cellSize;
    }
    return null;
  }

  /**
   * Find all enemy squads near a position (for combat resolution).
   */
  findEnemiesInRange(x: number, y: number, ownerId: string, range: number): SpatialEntry[] {
    return this.queryRadius(x, y, range).filter(e => e.ownerId !== ownerId);
  }

  /**
   * Find all friendly squads near a position.
   */
  findFriendliesInRange(x: number, y: number, ownerId: string, range: number): SpatialEntry[] {
    return this.queryRadius(x, y, range).filter(e => e.ownerId === ownerId);
  }

  /**
   * Check if there are any enemy entities within range of a position.
   * More efficient than findEnemiesInRange when you only need a boolean.
   */
  hasEnemyInRange(x: number, y: number, ownerId: string, range: number): boolean {
    const rangeSq = range * range;

    const minCx = Math.floor((x - range) / this.cellSize);
    const maxCx = Math.floor((x + range) / this.cellSize);
    const minCy = Math.floor((y - range) / this.cellSize);
    const maxCy = Math.floor((y + range) / this.cellSize);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cellKey = `${cx},${cy}`;
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        for (const entry of cell) {
          if (entry.ownerId === ownerId) continue;
          const dx = entry.x - x;
          const dy = entry.y - y;
          if (dx * dx + dy * dy <= rangeSq) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get all occupied cell keys (for debugging/visualization).
   */
  getOccupiedCells(): string[] {
    return Array.from(this.cells.keys());
  }

  /**
   * Get total entity count.
   */
  get entityCount(): number {
    return this.entityCells.size;
  }
}
