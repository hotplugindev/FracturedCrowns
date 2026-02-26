// ============================================================
// Fractured Crowns — Canvas Game Renderer
// Renders the game map, units, buildings, fog of war, and UI overlays
// ============================================================

import type {
  VisibleTile,
  SquadSnapshot,
  PlayerPublicInfo,
  PlayerId,
  SquadId,
} from "../types/game";
import {
  TerrainType,
  StructureType,
  UnitType,
  MATCH_CONFIG,
} from "../types/game";

// ---- Constants ----

const TILE_SIZE = 32; // Base tile size in pixels
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4.0;

// ---- Terrain Colors ----

const TERRAIN_COLORS: Record<string, string> = {
  [TerrainType.Plains]: "#6b8e4e",
  [TerrainType.Forest]: "#3d6b35",
  [TerrainType.Mountain]: "#7a7a7a",
  [TerrainType.Mine]: "#c4a35a",
  [TerrainType.Water]: "#3a7ecf",
};

const TERRAIN_COLORS_DARK: Record<string, string> = {
  [TerrainType.Plains]: "#4a6636",
  [TerrainType.Forest]: "#2a4d25",
  [TerrainType.Mountain]: "#5a5a5a",
  [TerrainType.Mine]: "#9a8040",
  [TerrainType.Water]: "#2a5ea0",
};

// ---- Structure Symbols ----

const STRUCTURE_SYMBOLS: Record<string, string> = {
  [StructureType.Castle]: "🏰",
  [StructureType.Barracks]: "⚔",
  [StructureType.Wall]: "▬",
  [StructureType.Tower]: "⬆",
  [StructureType.MineUpgrade]: "⛏",
  [StructureType.Road]: "·",
};

// ---- Unit Symbols ----

const UNIT_SYMBOLS: Record<string, string> = {
  [UnitType.Militia]: "♟",
  [UnitType.Soldier]: "♞",
  [UnitType.Knight]: "♝",
  [UnitType.Archer]: "🏹",
  [UnitType.SiegeRam]: "♜",
};

// ---- Types ----

export interface RenderState {
  visibleTiles: Map<string, VisibleTile>;
  squads: SquadSnapshot[];
  players: PlayerPublicInfo[];
  myPlayerId: PlayerId | null;
  selectedSquadIds: Set<SquadId>;
  hoveredTileX: number;
  hoveredTileY: number;
  buildMode: boolean;
  buildStructureType: StructureType | null;
  mapTerrain: string[][] | null;
  mapWidth: number;
  mapHeight: number;
  timeRemaining: number;
  myGold: number;
  myGoldPerSecond: number;
  phase: string | null;
}

export interface CameraState {
  x: number; // world center X (in tiles)
  y: number; // world center Y (in tiles)
  zoom: number;
}

export interface RendererCallbacks {
  onTileClick: (x: number, y: number, button: number) => void;
  onTileHover: (x: number, y: number) => void;
  onSquadClick: (squadId: SquadId, append: boolean) => void;
  onDragSelect: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => void;
  onCameraChange: (x: number, y: number, zoom: number) => void;
  onZoom: (delta: number) => void;
}

// ============================================================
// Renderer Class
// ============================================================

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  private camera: CameraState = { x: 60, y: 60, zoom: 1.0 };
  private renderState: RenderState | null = null;
  private callbacks: RendererCallbacks;

  // Interaction state
  private isDragging: boolean = false;
  private dragStartScreenX: number = 0;
  private dragStartScreenY: number = 0;
  private dragStartCamX: number = 0;
  private dragStartCamY: number = 0;

  private isBoxSelecting: boolean = false;
  private boxStartScreenX: number = 0;
  private boxStartScreenY: number = 0;
  private boxCurrentScreenX: number = 0;
  private boxCurrentScreenY: number = 0;

  private mouseScreenX: number = 0;
  private mouseScreenY: number = 0;
  private mouseWorldX: number = 0;
  private mouseWorldY: number = 0;

  // Animation
  private animationFrameId: number = 0;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fpsAccumulator: number = 0;
  private currentFps: number = 0;

  // Cached player color map
  private playerColorMap: Map<PlayerId, string> = new Map();

  // Off-screen minimap canvas
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapSize: number = 160;
  private minimapDirty: boolean = true;
  private minimapTickCounter: number = 0;

  // FOW explored tiles cache
  private exploredTiles: Set<string> = new Set();

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.callbacks = callbacks;

    // Create minimap canvas
    this.minimapCanvas = document.createElement("canvas");
    this.minimapCanvas.width = this.minimapSize;
    this.minimapCanvas.height = this.minimapSize;
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;

    // Set up event listeners
    this.setupInputHandlers();

    // Initial resize
    this.resize();

    // Watch for window resize
    window.addEventListener("resize", () => this.resize());
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Start the render loop.
   */
  start(): void {
    this.lastFrameTime = performance.now();
    this.animate();
  }

  /**
   * Stop the render loop.
   */
  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
  }

  /**
   * Destroy the renderer and clean up.
   */
  destroy(): void {
    this.stop();
    window.removeEventListener("resize", () => this.resize());

    // Remove canvas event listeners (handled by removing the canvas from DOM)
    this.canvas.onmousedown = null;
    this.canvas.onmousemove = null;
    this.canvas.onmouseup = null;
    this.canvas.onwheel = null;
    this.canvas.oncontextmenu = null;
  }

  // ============================================================
  // State Updates
  // ============================================================

  /**
   * Update the render state (called from game store on each tick).
   */
  updateState(state: RenderState): void {
    this.renderState = state;

    // Rebuild player color map
    this.playerColorMap.clear();
    for (const player of state.players) {
      this.playerColorMap.set(player.id, player.color);
    }

    // Mark explored tiles
    for (const [key] of state.visibleTiles) {
      this.exploredTiles.add(key);
    }

    // Mark minimap as dirty
    this.minimapTickCounter++;
    if (this.minimapTickCounter >= 5) {
      this.minimapDirty = true;
      this.minimapTickCounter = 0;
    }
  }

  /**
   * Update camera position.
   */
  setCamera(x: number, y: number, zoom?: number): void {
    this.camera.x = x;
    this.camera.y = y;
    if (zoom !== undefined) {
      this.camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    }
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  getFps(): number {
    return this.currentFps;
  }

  // ============================================================
  // Coordinate Conversion
  // ============================================================

  /**
   * Convert world tile coordinates to screen pixel coordinates.
   */
  private worldToScreen(
    worldX: number,
    worldY: number,
  ): { sx: number; sy: number } {
    const tilePixelSize = TILE_SIZE * this.camera.zoom;
    const sx = (worldX - this.camera.x) * tilePixelSize + this.width / 2;
    const sy = (worldY - this.camera.y) * tilePixelSize + this.height / 2;
    return { sx, sy };
  }

  /**
   * Convert screen pixel coordinates to world tile coordinates.
   */
  private screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    const tilePixelSize = TILE_SIZE * this.camera.zoom;
    const wx = (sx - this.width / 2) / tilePixelSize + this.camera.x;
    const wy = (sy - this.height / 2) / tilePixelSize + this.camera.y;
    return { wx, wy };
  }

  /**
   * Get the tile coordinates at a screen position.
   */
  private getTileAt(sx: number, sy: number): { tx: number; ty: number } {
    const { wx, wy } = this.screenToWorld(sx, sy);
    return { tx: Math.floor(wx), ty: Math.floor(wy) };
  }

  // ============================================================
  // Resize
  // ============================================================

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      this.width = rect.width;
      this.height = rect.height;
    } else {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    }

    // Account for DPR for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================================================
  // Input Handlers
  // ============================================================

  private setupInputHandlers(): void {
    // Prevent context menu on right-click
    this.canvas.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };

    // Mouse down
    this.canvas.onmousedown = (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle mouse button or Alt+Left click → pan
        this.isDragging = true;
        this.dragStartScreenX = sx;
        this.dragStartScreenY = sy;
        this.dragStartCamX = this.camera.x;
        this.dragStartCamY = this.camera.y;
      } else if (e.button === 0) {
        // Left click → start box selection or click
        this.isBoxSelecting = true;
        this.boxStartScreenX = sx;
        this.boxStartScreenY = sy;
        this.boxCurrentScreenX = sx;
        this.boxCurrentScreenY = sy;
      } else if (e.button === 2) {
        // Right click → context action (move/attack)
        const { tx, ty } = this.getTileAt(sx, sy);
        this.callbacks.onTileClick(tx, ty, 2);
      }
    };

    // Mouse move
    this.canvas.onmousemove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.mouseScreenX = sx;
      this.mouseScreenY = sy;

      const { wx, wy } = this.screenToWorld(sx, sy);
      this.mouseWorldX = wx;
      this.mouseWorldY = wy;

      // Update hovered tile
      const { tx, ty } = this.getTileAt(sx, sy);
      this.callbacks.onTileHover(tx, ty);

      if (this.isDragging) {
        const tilePixelSize = TILE_SIZE * this.camera.zoom;
        const dx = (sx - this.dragStartScreenX) / tilePixelSize;
        const dy = (sy - this.dragStartScreenY) / tilePixelSize;
        this.camera.x = this.dragStartCamX - dx;
        this.camera.y = this.dragStartCamY - dy;
        this.callbacks.onCameraChange(
          this.camera.x,
          this.camera.y,
          this.camera.zoom,
        );
      }

      if (this.isBoxSelecting) {
        this.boxCurrentScreenX = sx;
        this.boxCurrentScreenY = sy;
      }
    };

    // Mouse up
    this.canvas.onmouseup = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.isDragging) {
        this.isDragging = false;
        return;
      }

      if (this.isBoxSelecting) {
        this.isBoxSelecting = false;

        const dx = Math.abs(sx - this.boxStartScreenX);
        const dy = Math.abs(sy - this.boxStartScreenY);

        if (dx < 5 && dy < 5) {
          // Tiny drag → treat as click
          const { tx, ty } = this.getTileAt(sx, sy);

          // Check if clicked on a squad
          const clickedSquad = this.findSquadAtScreen(sx, sy);
          if (clickedSquad) {
            this.callbacks.onSquadClick(clickedSquad.id, e.shiftKey);
          } else {
            this.callbacks.onTileClick(tx, ty, 0);
          }
        } else {
          // Box selection
          const start = this.screenToWorld(
            Math.min(this.boxStartScreenX, sx),
            Math.min(this.boxStartScreenY, sy),
          );
          const end = this.screenToWorld(
            Math.max(this.boxStartScreenX, sx),
            Math.max(this.boxStartScreenY, sy),
          );
          this.callbacks.onDragSelect(start.wx, start.wy, end.wx, end.wy);
        }
      }
    };

    // Mouse wheel → zoom
    this.canvas.onwheel = (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, this.camera.zoom * (1 + delta * 3)),
      );

      // Zoom toward mouse position
      const { wx, wy } = this.screenToWorld(
        this.mouseScreenX,
        this.mouseScreenY,
      );
      const oldZoom = this.camera.zoom;
      this.camera.zoom = newZoom;

      // Adjust camera so the world point under the mouse stays in place
      const zoomRatio = newZoom / oldZoom;
      this.camera.x = wx - (wx - this.camera.x) / zoomRatio;
      this.camera.y = wy - (wy - this.camera.y) / zoomRatio;

      this.callbacks.onCameraChange(
        this.camera.x,
        this.camera.y,
        this.camera.zoom,
      );
      this.callbacks.onZoom(newZoom - oldZoom);
    };

    // Keyboard
    window.addEventListener("keydown", (e) => {
      this.handleKeyDown(e);
    });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const panSpeed = 3 / this.camera.zoom;

    switch (e.key) {
      case "w":
      case "ArrowUp":
        this.camera.y -= panSpeed;
        this.callbacks.onCameraChange(
          this.camera.x,
          this.camera.y,
          this.camera.zoom,
        );
        break;
      case "s":
      case "ArrowDown":
        this.camera.y += panSpeed;
        this.callbacks.onCameraChange(
          this.camera.x,
          this.camera.y,
          this.camera.zoom,
        );
        break;
      case "a":
      case "ArrowLeft":
        this.camera.x -= panSpeed;
        this.callbacks.onCameraChange(
          this.camera.x,
          this.camera.y,
          this.camera.zoom,
        );
        break;
      case "d":
      case "ArrowRight":
        this.camera.x += panSpeed;
        this.callbacks.onCameraChange(
          this.camera.x,
          this.camera.y,
          this.camera.zoom,
        );
        break;
      case "Escape":
        // Handled by Vue components
        break;
    }
  }

  private findSquadAtScreen(sx: number, sy: number): SquadSnapshot | null {
    if (!this.renderState) return null;

    const { wx, wy } = this.screenToWorld(sx, sy);
    const clickRadius = 1.0; // world units

    let closest: SquadSnapshot | null = null;
    let closestDist = Infinity;

    for (const squad of this.renderState.squads) {
      const dx = squad.x - wx;
      const dy = squad.y - wy;
      const dist = dx * dx + dy * dy;

      if (dist < clickRadius * clickRadius && dist < closestDist) {
        closestDist = dist;
        closest = squad;
      }
    }

    return closest;
  }

  // ============================================================
  // Render Loop
  // ============================================================

  private animate(): void {
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    // FPS tracking
    this.frameCount++;
    this.fpsAccumulator += dt;
    if (this.fpsAccumulator >= 1.0) {
      this.currentFps = Math.round(this.frameCount / this.fpsAccumulator);
      this.frameCount = 0;
      this.fpsAccumulator = 0;
    }

    this.render(dt);

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  private render(_dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    if (!this.renderState) return;

    const state = this.renderState;
    const tilePixelSize = TILE_SIZE * this.camera.zoom;

    // Calculate visible tile range
    const halfW = w / 2 / tilePixelSize;
    const halfH = h / 2 / tilePixelSize;

    const minTX = Math.floor(this.camera.x - halfW) - 1;
    const maxTX = Math.ceil(this.camera.x + halfW) + 1;
    const minTY = Math.floor(this.camera.y - halfH) - 1;
    const maxTY = Math.ceil(this.camera.y + halfH) + 1;

    const mapW = state.mapWidth;
    const mapH = state.mapHeight;

    // ---- Draw Tiles ----
    for (let ty = Math.max(0, minTY); ty <= Math.min(mapH - 1, maxTY); ty++) {
      for (let tx = Math.max(0, minTX); tx <= Math.min(mapW - 1, maxTX); tx++) {
        const key = `${tx},${ty}`;
        const tile = state.visibleTiles.get(key);
        const explored = this.exploredTiles.has(key);

        const { sx, sy } = this.worldToScreen(tx, ty);
        const size = tilePixelSize + 0.5; // slight overlap to avoid gaps

        if (tile) {
          this.drawTile(ctx, tile, sx, sy, size, state.myPlayerId, false);
        } else if (explored) {
          // Draw explored but not currently visible (fog of war - darkened)
          // Use terrain from mapTerrain if available
          if (state.mapTerrain && state.mapTerrain[ty]) {
            const terrainType = state.mapTerrain[ty]![tx];
            if (terrainType) {
              ctx.fillStyle = TERRAIN_COLORS_DARK[terrainType] || "#2a2a3e";
              ctx.fillRect(sx, sy, size, size);
              ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
              ctx.fillRect(sx, sy, size, size);
            } else {
              ctx.fillStyle = "#2a2a3e";
              ctx.fillRect(sx, sy, size, size);
            }
          } else {
            ctx.fillStyle = "#2a2a3e";
            ctx.fillRect(sx, sy, size, size);
          }
        } else {
          // Unexplored
          ctx.fillStyle = "#111122";
          ctx.fillRect(sx, sy, size, size);
        }
      }
    }

    // ---- Draw Grid Lines (only at high zoom) ----
    if (this.camera.zoom > 0.6) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
      ctx.lineWidth = 0.5;
      for (let ty = Math.max(0, minTY); ty <= Math.min(mapH, maxTY); ty++) {
        const { sx: sx0, sy: sy0 } = this.worldToScreen(Math.max(0, minTX), ty);
        const { sx: sx1 } = this.worldToScreen(Math.min(mapW, maxTX + 1), ty);
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy0);
        ctx.stroke();
      }
      for (let tx = Math.max(0, minTX); tx <= Math.min(mapW, maxTX); tx++) {
        const { sx: sx0, sy: sy0 } = this.worldToScreen(tx, Math.max(0, minTY));
        const { sy: sy1 } = this.worldToScreen(tx, Math.min(mapH, maxTY + 1));
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx0, sy1);
        ctx.stroke();
      }
    }

    // ---- Draw Squads ----
    for (const squad of state.squads) {
      this.drawSquad(
        ctx,
        squad,
        state.myPlayerId,
        state.selectedSquadIds,
        tilePixelSize,
      );
    }

    // ---- Draw Box Selection ----
    if (this.isBoxSelecting) {
      const bx = Math.min(this.boxStartScreenX, this.boxCurrentScreenX);
      const by = Math.min(this.boxStartScreenY, this.boxCurrentScreenY);
      const bw = Math.abs(this.boxCurrentScreenX - this.boxStartScreenX);
      const bh = Math.abs(this.boxCurrentScreenY - this.boxStartScreenY);

      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(0, 255, 136, 0.08)";
      ctx.fillRect(bx, by, bw, bh);
    }

    // ---- Draw Build Mode Cursor ----
    if (state.buildMode && state.buildStructureType) {
      const { tx, ty } = this.getTileAt(this.mouseScreenX, this.mouseScreenY);
      const { sx, sy } = this.worldToScreen(tx, ty);

      ctx.fillStyle = "rgba(0, 255, 100, 0.3)";
      ctx.fillRect(sx, sy, tilePixelSize, tilePixelSize);
      ctx.strokeStyle = "#00ff64";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tilePixelSize, tilePixelSize);

      // Draw structure icon
      if (this.camera.zoom > 0.4) {
        const symbol = STRUCTURE_SYMBOLS[state.buildStructureType] || "?";
        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.max(10, tilePixelSize * 0.6)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(symbol, sx + tilePixelSize / 2, sy + tilePixelSize / 2);
      }
    }

    // ---- Draw Hovered Tile Highlight ----
    if (
      state.hoveredTileX >= 0 &&
      state.hoveredTileY >= 0 &&
      !state.buildMode
    ) {
      const { sx, sy } = this.worldToScreen(
        state.hoveredTileX,
        state.hoveredTileY,
      );
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, tilePixelSize, tilePixelSize);
    }

    // ---- Draw Minimap ----
    this.drawMinimap(ctx, state);
  }

  // ============================================================
  // Tile Drawing
  // ============================================================

  private drawTile(
    ctx: CanvasRenderingContext2D,
    tile: VisibleTile,
    sx: number,
    sy: number,
    size: number,
    myPlayerId: PlayerId | null,
    darkened: boolean,
  ): void {
    // Base terrain color
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || "#444444";
    ctx.fillRect(sx, sy, size, size);

    // Territory owner tint
    if (tile.ownerId) {
      const color = this.playerColorMap.get(tile.ownerId) || "#888888";
      ctx.fillStyle = this.hexToRgba(color, 0.3);
      ctx.fillRect(sx, sy, size, size);

      // Border for territory
      if (this.camera.zoom > 0.35) {
        ctx.strokeStyle = this.hexToRgba(color, 0.5);
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx + 0.5, sy + 0.5, size - 1, size - 1);
      }
    }

    // Capture progress indicator
    if (
      tile.captureProgress > 0 &&
      tile.captureProgress < 100 &&
      tile.capturingPlayerId
    ) {
      const progress = tile.captureProgress / 100;
      const captureColor =
        this.playerColorMap.get(tile.capturingPlayerId) || "#ffff00";

      ctx.fillStyle = this.hexToRgba(captureColor, 0.4 * progress);
      ctx.fillRect(sx, sy + size * (1 - progress), size, size * progress);

      // Progress bar on top
      if (this.camera.zoom > 0.5) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(sx + 2, sy + size - 5, size - 4, 3);
        ctx.fillStyle = captureColor;
        ctx.fillRect(sx + 2, sy + size - 5, (size - 4) * progress, 3);
      }
    }

    // Structure
    if (tile.structureType && this.camera.zoom > 0.25) {
      this.drawStructure(ctx, tile, sx, sy, size);
    }

    // Mine indicator (terrain-level)
    if (tile.terrain === TerrainType.Mine && this.camera.zoom > 0.4) {
      ctx.fillStyle = "#ffd700";
      ctx.font = `bold ${Math.max(8, size * 0.35)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⛏", sx + size / 2, sy + size / 2);
    }

    // Darkened fog overlay
    if (darkened) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(sx, sy, size, size);
    }
  }

  private drawStructure(
    ctx: CanvasRenderingContext2D,
    tile: VisibleTile,
    sx: number,
    sy: number,
    size: number,
  ): void {
    if (!tile.structureType) return;

    const ownerColor = tile.ownerId
      ? this.playerColorMap.get(tile.ownerId) || "#888888"
      : "#888888";

    // Structure background
    if (tile.structureType === StructureType.Wall) {
      ctx.fillStyle = this.hexToRgba(ownerColor, 0.7);
      ctx.fillRect(sx + size * 0.1, sy + size * 0.1, size * 0.8, size * 0.8);
    } else if (tile.structureType === StructureType.Castle) {
      // Draw a larger, more prominent castle icon
      ctx.fillStyle = this.hexToRgba(ownerColor, 0.6);
      ctx.fillRect(sx + size * 0.05, sy + size * 0.05, size * 0.9, size * 0.9);
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        sx + size * 0.05,
        sy + size * 0.05,
        size * 0.9,
        size * 0.9,
      );
    } else if (tile.structureType === StructureType.Road) {
      ctx.fillStyle = "#b8a87a";
      ctx.fillRect(sx + size * 0.2, sy + size * 0.35, size * 0.6, size * 0.3);
    }

    // Structure symbol (skip at very low zoom except for castle)
    if (this.camera.zoom > 0.4 || tile.structureType === StructureType.Castle) {
      const symbol = STRUCTURE_SYMBOLS[tile.structureType] || "?";
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.max(8, size * 0.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbol, sx + size / 2, sy + size / 2);
    }

    // HP bar for damageable structures
    if (
      tile.structureHp > 0 &&
      tile.structureType !== StructureType.Road &&
      this.camera.zoom > 0.5
    ) {
      const maxHp = this.getStructureMaxHp(tile.structureType);
      if (tile.structureHp < maxHp) {
        const hpRatio = tile.structureHp / maxHp;
        const barWidth = size * 0.8;
        const barHeight = 3;
        const barX = sx + size * 0.1;
        const barY = sy + 2;

        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle =
          hpRatio > 0.5 ? "#44ff44" : hpRatio > 0.25 ? "#ffaa00" : "#ff4444";
        ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
      }
    }
  }

  private getStructureMaxHp(structureType: StructureType): number {
    const hpMap: Record<string, number> = {
      [StructureType.Castle]: 500,
      [StructureType.Barracks]: 200,
      [StructureType.Wall]: 300,
      [StructureType.Tower]: 150,
      [StructureType.MineUpgrade]: 100,
      [StructureType.Road]: 30,
    };
    return hpMap[structureType] || 100;
  }

  // ============================================================
  // Squad Drawing
  // ============================================================

  private drawSquad(
    ctx: CanvasRenderingContext2D,
    squad: SquadSnapshot,
    myPlayerId: PlayerId | null,
    selectedIds: Set<SquadId>,
    tilePixelSize: number,
  ): void {
    const { sx, sy } = this.worldToScreen(squad.x, squad.y);
    const isSelected = selectedIds.has(squad.id);
    const isMine = squad.ownerId === myPlayerId;
    const color = this.playerColorMap.get(squad.ownerId) || "#ffffff";
    const radius = Math.max(4, tilePixelSize * 0.35);

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(
        sx + tilePixelSize / 2,
        sy + tilePixelSize / 2,
        radius + 4,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw movement line
      if (squad.targetX !== null && squad.targetY !== null) {
        const target = this.worldToScreen(squad.targetX, squad.targetY);
        ctx.beginPath();
        ctx.moveTo(sx + tilePixelSize / 2, sy + tilePixelSize / 2);
        ctx.lineTo(
          target.sx + tilePixelSize / 2,
          target.sy + tilePixelSize / 2,
        );
        ctx.strokeStyle = "rgba(0, 255, 136, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Target marker
        ctx.beginPath();
        ctx.arc(
          target.sx + tilePixelSize / 2,
          target.sy + tilePixelSize / 2,
          4,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "#00ff88";
        ctx.fill();
      }
    }

    // Unit circle
    ctx.beginPath();
    ctx.arc(
      sx + tilePixelSize / 2,
      sy + tilePixelSize / 2,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isMine ? "#ffffff" : "#000000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Unit count
    if (this.camera.zoom > 0.3) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(8, radius * 0.9)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        squad.unitCount.toString(),
        sx + tilePixelSize / 2,
        sy + tilePixelSize / 2,
      );
    }

    // HP bar
    if (this.camera.zoom > 0.4 && squad.maxHp > 0) {
      const hpRatio = squad.totalHp / squad.maxHp;
      const barWidth = radius * 2;
      const barHeight = 3;
      const barX = sx + tilePixelSize / 2 - radius;
      const barY = sy + tilePixelSize / 2 - radius - 6;

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle =
        hpRatio > 0.5 ? "#44ff44" : hpRatio > 0.25 ? "#ffaa00" : "#ff4444";
      ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    }

    // Unit type icons (at high zoom)
    if (this.camera.zoom > 1.0 && squad.composition) {
      const types = Object.entries(squad.composition).filter(
        ([, count]) => count && count > 0,
      );
      if (types.length > 0) {
        ctx.font = `${Math.max(8, tilePixelSize * 0.25)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffffcc";
        const label = types
          .map(([type, count]) => `${UNIT_SYMBOLS[type] || "?"}${count}`)
          .join(" ");
        ctx.fillText(
          label,
          sx + tilePixelSize / 2,
          sy + tilePixelSize / 2 + radius + 10,
        );
      }
    }
  }

  // ============================================================
  // Minimap
  // ============================================================

  private drawMinimap(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const mmSize = this.minimapSize;
    const mmX = this.width - mmSize - 10;
    const mmY = this.height - mmSize - 10;
    const mapW = state.mapWidth;
    const mapH = state.mapHeight;
    const scaleX = mmSize / mapW;
    const scaleY = mmSize / mapH;

    // Rebuild minimap if dirty
    if (this.minimapDirty) {
      this.minimapDirty = false;
      const mmCtx = this.minimapCtx;

      // Background
      mmCtx.fillStyle = "#111122";
      mmCtx.fillRect(0, 0, mmSize, mmSize);

      // Draw terrain from mapTerrain
      if (state.mapTerrain) {
        for (let y = 0; y < mapH; y++) {
          for (let x = 0; x < mapW; x++) {
            const terrain = state.mapTerrain[y]?.[x];
            if (!terrain) continue;

            const key = `${x},${y}`;
            const tile = state.visibleTiles.get(key);
            const explored = this.exploredTiles.has(key);

            if (tile) {
              if (tile.ownerId) {
                mmCtx.fillStyle =
                  this.playerColorMap.get(tile.ownerId) || "#666666";
              } else {
                mmCtx.fillStyle = TERRAIN_COLORS[terrain] || "#444444";
              }
            } else if (explored) {
              mmCtx.fillStyle = TERRAIN_COLORS_DARK[terrain] || "#2a2a3e";
            } else {
              mmCtx.fillStyle = "#111122";
            }

            mmCtx.fillRect(
              Math.floor(x * scaleX),
              Math.floor(y * scaleY),
              Math.ceil(scaleX) + 1,
              Math.ceil(scaleY) + 1,
            );
          }
        }
      } else {
        // Draw from visible tiles only
        for (const [, tile] of state.visibleTiles) {
          if (tile.ownerId) {
            mmCtx.fillStyle =
              this.playerColorMap.get(tile.ownerId) || "#666666";
          } else {
            mmCtx.fillStyle = TERRAIN_COLORS[tile.terrain] || "#444444";
          }

          mmCtx.fillRect(
            Math.floor(tile.x * scaleX),
            Math.floor(tile.y * scaleY),
            Math.ceil(scaleX) + 1,
            Math.ceil(scaleY) + 1,
          );
        }
      }

      // Draw squads on minimap
      for (const squad of state.squads) {
        const color = this.playerColorMap.get(squad.ownerId) || "#ffffff";
        mmCtx.fillStyle = color;
        const dotSize = Math.max(2, squad.unitCount * 0.4);
        mmCtx.fillRect(
          squad.x * scaleX - dotSize / 2,
          squad.y * scaleY - dotSize / 2,
          dotSize,
          dotSize,
        );
      }
    }

    // Draw minimap to main canvas
    ctx.drawImage(this.minimapCanvas, mmX, mmY);

    // Border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Camera viewport rectangle
    const tilePixelSize = TILE_SIZE * this.camera.zoom;
    const viewW = this.width / tilePixelSize;
    const viewH = this.height / tilePixelSize;

    const vpX = mmX + (this.camera.x - viewW / 2) * scaleX;
    const vpY = mmY + (this.camera.y - viewH / 2) * scaleY;
    const vpW = viewW * scaleX;
    const vpH = viewH * scaleY;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
  }

  // ============================================================
  // Spawn Selection Rendering
  // ============================================================

  /**
   * Render the spawn selection map (full terrain visible, no fog).
   */
  renderSpawnMap(
    mapTerrain: string[][],
    mapWidth: number,
    mapHeight: number,
    spawnLocations: Array<{ x: number; y: number }>,
    hoveredTileX: number,
    hoveredTileY: number,
    players: PlayerPublicInfo[],
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const tilePixelSize = TILE_SIZE * this.camera.zoom;

    // Clear
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // Calculate visible range
    const halfW = w / 2 / tilePixelSize;
    const halfH = h / 2 / tilePixelSize;

    const minTX = Math.floor(this.camera.x - halfW) - 1;
    const maxTX = Math.ceil(this.camera.x + halfW) + 1;
    const minTY = Math.floor(this.camera.y - halfH) - 1;
    const maxTY = Math.ceil(this.camera.y + halfH) + 1;

    // Draw terrain
    for (
      let ty = Math.max(0, minTY);
      ty <= Math.min(mapHeight - 1, maxTY);
      ty++
    ) {
      for (
        let tx = Math.max(0, minTX);
        tx <= Math.min(mapWidth - 1, maxTX);
        tx++
      ) {
        const terrain = mapTerrain[ty]?.[tx];
        if (!terrain) continue;

        const { sx, sy } = this.worldToScreen(tx, ty);
        ctx.fillStyle = TERRAIN_COLORS[terrain] || "#444444";
        ctx.fillRect(sx, sy, tilePixelSize + 0.5, tilePixelSize + 0.5);
      }
    }

    // Draw spawn locations
    for (const spawn of spawnLocations) {
      const { sx, sy } = this.worldToScreen(spawn.x, spawn.y);
      const radius = tilePixelSize * 1.5;

      // Pulsing indicator
      const pulse = Math.sin(performance.now() / 300) * 0.3 + 0.7;

      ctx.beginPath();
      ctx.arc(
        sx + tilePixelSize / 2,
        sy + tilePixelSize / 2,
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = `rgba(255, 255, 100, ${0.15 * pulse})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 100, ${0.7 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#ffff64";
      ctx.font = `bold ${Math.max(10, tilePixelSize * 0.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", sx + tilePixelSize / 2, sy + tilePixelSize / 2);
    }

    // Hovered tile
    if (hoveredTileX >= 0 && hoveredTileY >= 0) {
      const { sx, sy } = this.worldToScreen(hoveredTileX, hoveredTileY);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tilePixelSize, tilePixelSize);
    }
  }

  // ============================================================
  // Utility
  // ============================================================

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
