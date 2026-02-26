<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from "vue";
import { useGameStore } from "../stores/gameStore";
import { Renderer } from "../game/Renderer";
import type { RenderState } from "../game/Renderer";
import {
    StructureType,
    UnitType,
    BUILDING_COSTS,
    UNIT_STATS,
    UNIT_NAMES,
    STRUCTURE_NAMES,
    BUILDABLE_STRUCTURES,
    TRAINABLE_UNITS,
    TerrainType,
} from "../types/game";
import type { SquadSnapshot, VisibleTile } from "../types/game";

const store = useGameStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
let renderer: Renderer | null = null;

const showScoreboard = ref(false);
const showEventLog = ref(false);
const selectedBuildingForTrain = ref<{ x: number; y: number } | null>(null);

// ---- Computed ----

const hoveredTileInfo = computed<VisibleTile | undefined>(() => {
    return store.hoveredTile;
});

const canAffordBuild = computed(() => {
    return (type: StructureType) => store.myGold >= BUILDING_COSTS[type].gold;
});

const canAffordUnit = computed(() => {
    return (type: UnitType) => store.myGold >= UNIT_STATS[type].cost;
});

const selectedSquadSummary = computed(() => {
    const squads = store.selectedSquads;
    if (squads.length === 0) return null;

    let totalUnits = 0;
    let totalHp = 0;
    let maxHp = 0;
    const composition: Partial<Record<UnitType, number>> = {};

    for (const squad of squads) {
        totalUnits += squad.unitCount;
        totalHp += squad.totalHp;
        maxHp += squad.maxHp;
        if (squad.composition) {
            for (const [type, count] of Object.entries(squad.composition)) {
                const ut = type as UnitType;
                composition[ut] = (composition[ut] ?? 0) + (count ?? 0);
            }
        }
    }

    return {
        count: squads.length,
        totalUnits,
        totalHp,
        maxHp,
        hpPercent: maxHp > 0 ? Math.round((totalHp / maxHp) * 100) : 0,
        composition,
    };
});

const productionBuildings = computed(() => {
    const buildings: Array<{ x: number; y: number; type: StructureType }> = [];
    for (const [, tile] of store.visibleTiles) {
        if (
            tile.ownerId === store.playerId &&
            (tile.structureType === StructureType.Castle ||
                tile.structureType === StructureType.Barracks)
        ) {
            buildings.push({ x: tile.x, y: tile.y, type: tile.structureType });
        }
    }
    return buildings;
});

const hpBarColor = computed(() => {
    const pct = selectedSquadSummary.value?.hpPercent ?? 100;
    if (pct > 50) return "#44ff44";
    if (pct > 25) return "#ffaa00";
    return "#ff4444";
});

const incomeDisplay = computed(() => {
    const gps = store.myGoldPerSecond;
    if (gps >= 0) return `+${gps.toFixed(1)}`;
    return gps.toFixed(1);
});

// ---- Renderer Setup ----

function initRenderer() {
    if (!canvasRef.value) return;

    renderer = new Renderer(canvasRef.value, {
        onTileClick: handleTileClick,
        onTileHover: handleTileHover,
        onSquadClick: handleSquadClick,
        onDragSelect: handleDragSelect,
        onCameraChange: (x, y, zoom) => {
            store.setCamera(x, y, zoom);
        },
        onZoom: () => {},
    });

    renderer.setCamera(store.cameraX, store.cameraY, store.cameraZoom);
    renderer.start();
}

function handleTileClick(x: number, y: number, button: number) {
    if (button === 0) {
        // Left click
        if (store.buildMode.active && store.buildMode.structureType) {
            store.buildStructure(store.buildMode.structureType, x, y);
            return;
        }

        // Check if clicked on own production building
        const tile = store.visibleTiles.get(`${x},${y}`);
        if (
            tile &&
            tile.ownerId === store.playerId &&
            (tile.structureType === StructureType.Castle ||
                tile.structureType === StructureType.Barracks)
        ) {
            selectedBuildingForTrain.value = { x: tile.x, y: tile.y };
            store.clearSelection();
            return;
        }

        // Deselect
        store.clearSelection();
        selectedBuildingForTrain.value = null;
    } else if (button === 2) {
        // Right click — move selected squads or context action
        if (store.selection.selectedSquadIds.length > 0) {
            store.moveSelectedSquads(x, y);
        }
    }
}

function handleTileHover(x: number, y: number) {
    store.setHoveredTile(x, y);
}

function handleSquadClick(squadId: string, append: boolean) {
    const squad = store.squads.find((s) => s.id === squadId);
    if (!squad) return;

    // Only select own squads
    if (squad.ownerId !== store.playerId) return;

    store.selectSquad(squadId, append);
    selectedBuildingForTrain.value = null;
}

function handleDragSelect(startX: number, startY: number, endX: number, endY: number) {
    // Select all own squads within the rectangle
    const mySquads = store.squads.filter((s) => {
        if (s.ownerId !== store.playerId) return false;
        return (
            s.x >= startX && s.x <= endX && s.y >= startY && s.y <= endY
        );
    });

    if (mySquads.length > 0) {
        store.selectSquads(mySquads.map((s) => s.id));
        selectedBuildingForTrain.value = null;
    }
}

// ---- Build Actions ----

function startBuild(type: StructureType) {
    if (!canAffordBuild.value(type)) return;
    store.enterBuildMode(type);
    selectedBuildingForTrain.value = null;
}

function cancelBuild() {
    store.exitBuildMode();
}

// ---- Train Actions ----

function trainUnit(type: UnitType) {
    if (!selectedBuildingForTrain.value) return;
    if (!canAffordUnit.value(type)) return;

    store.trainUnit(
        type,
        selectedBuildingForTrain.value.x,
        selectedBuildingForTrain.value.y
    );
}

// ---- Keyboard Shortcuts ----

function handleKeyDown(e: KeyboardEvent) {
    // Don't capture if typing in an input
    if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
    ) {
        return;
    }

    switch (e.key) {
        case "Escape":
            if (store.buildMode.active) {
                cancelBuild();
            } else {
                store.clearSelection();
                selectedBuildingForTrain.value = null;
            }
            break;
        case "Tab":
            e.preventDefault();
            showScoreboard.value = !showScoreboard.value;
            break;
        case "b":
        case "B":
            // Toggle build menu focus — show barracks shortcut
            if (!store.buildMode.active) {
                startBuild(StructureType.Barracks);
            } else {
                cancelBuild();
            }
            break;
        case "t":
        case "T":
            // Tower shortcut
            if (!store.buildMode.active) {
                startBuild(StructureType.Tower);
            }
            break;
        case "w":
        case "W":
            // Wall shortcut only if not camera-moving (handled by renderer)
            break;
        case "l":
        case "L":
            showEventLog.value = !showEventLog.value;
            break;
        case "1":
            if (selectedBuildingForTrain.value) trainUnit(UnitType.Militia);
            break;
        case "2":
            if (selectedBuildingForTrain.value) trainUnit(UnitType.Soldier);
            break;
        case "3":
            if (selectedBuildingForTrain.value) trainUnit(UnitType.Knight);
            break;
        case "4":
            if (selectedBuildingForTrain.value) trainUnit(UnitType.Archer);
            break;
        case "5":
            if (selectedBuildingForTrain.value) trainUnit(UnitType.SiegeRam);
            break;
    }
}

// ---- Update Renderer State ----

function updateRendererState() {
    if (!renderer) return;

    const state: RenderState = {
        visibleTiles: store.visibleTiles,
        squads: store.squads,
        players: store.players,
        myPlayerId: store.playerId,
        selectedSquadIds: new Set(store.selection.selectedSquadIds),
        hoveredTileX: store.selection.hoveredTileX,
        hoveredTileY: store.selection.hoveredTileY,
        buildMode: store.buildMode.active,
        buildStructureType: store.buildMode.structureType,
        mapTerrain: store.mapTerrain,
        mapWidth: store.mapWidth,
        mapHeight: store.mapHeight,
        timeRemaining: store.timeRemaining,
        myGold: store.myGold,
        myGoldPerSecond: store.myGoldPerSecond,
        phase: store.phase,
    };

    renderer.updateState(state);
    store.updateFps(renderer.getFps());
}

// ---- Lifecycle ----

onMounted(() => {
    window.addEventListener("keydown", handleKeyDown);

    nextTick(() => {
        setTimeout(() => {
            initRenderer();
        }, 50);
    });
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeyDown);

    if (renderer) {
        renderer.destroy();
        renderer = null;
    }
});

// Watch game state and push to renderer
watch(
    () => store.tick,
    () => {
        updateRendererState();
    }
);

// Also watch squads/visibleTiles in case they update outside tick
watch(
    [() => store.squads, () => store.visibleTiles],
    () => {
        updateRendererState();
    },
    { deep: false }
);

// ---- Helpers ----

function getStructureIcon(type: StructureType): string {
    const icons: Record<StructureType, string> = {
        [StructureType.Castle]: "🏰",
        [StructureType.Barracks]: "⚔️",
        [StructureType.Wall]: "🧱",
        [StructureType.Tower]: "🗼",
        [StructureType.MineUpgrade]: "⛏️",
        [StructureType.Road]: "🛤️",
    };
    return icons[type] || "?";
}

function getUnitIcon(type: UnitType): string {
    const icons: Record<UnitType, string> = {
        [UnitType.Militia]: "🗡️",
        [UnitType.Soldier]: "⚔️",
        [UnitType.Knight]: "🐴",
        [UnitType.Archer]: "🏹",
        [UnitType.SiegeRam]: "🔨",
    };
    return icons[type] || "?";
}

function getTerrainName(terrain: string): string {
    const names: Record<string, string> = {
        plains: "Plains",
        forest: "Forest",
        mountain: "Mountain",
        mine: "Gold Mine",
        water: "Water",
    };
    return names[terrain] || terrain;
}

function formatGold(value: number): string {
    if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
    return Math.floor(value).toString();
}

function goToCapital() {
    const me = store.players.find((p) => p.id === store.playerId);
    if (!me) return;
    // Find the castle tile
    for (const [, tile] of store.visibleTiles) {
        if (
            tile.ownerId === store.playerId &&
            tile.structureType === StructureType.Castle
        ) {
            if (renderer) {
                renderer.setCamera(tile.x, tile.y, 1.2);
                store.setCamera(tile.x, tile.y, 1.2);
            }
            return;
        }
    }
}

function selectAllArmy() {
    const ids = store.mySquads.map((s) => s.id);
    if (ids.length > 0) {
        store.selectSquads(ids);
        selectedBuildingForTrain.value = null;
    }
}

function zoomToFit() {
    if (renderer) {
        renderer.setCamera(store.mapWidth / 2, store.mapHeight / 2, 0.25);
        store.setCamera(store.mapWidth / 2, store.mapHeight / 2, 0.25);
    }
}
</script>

<template>
    <div class="game-screen" ref="containerRef">
        <!-- Canvas -->
        <div class="canvas-container">
            <canvas ref="canvasRef" class="game-canvas"></canvas>
        </div>

        <!-- ============================================================ -->
        <!-- TOP HUD BAR -->
        <!-- ============================================================ -->
        <div class="top-hud">
            <div class="hud-left">
                <!-- Resources -->
                <div class="resource-display">
                    <div class="resource-item gold-display">
                        <span class="resource-icon">💰</span>
                        <span class="resource-value gold">{{
                            formatGold(store.myGold)
                        }}</span>
                        <span class="resource-rate" :class="{ positive: store.myGoldPerSecond > 0 }">
                            ({{ incomeDisplay }}/s)
                        </span>
                    </div>
                    <div class="resource-item">
                        <span class="resource-icon">🗺️</span>
                        <span class="resource-value">{{ store.myTerritory }}</span>
                        <span class="resource-label">tiles</span>
                    </div>
                    <div class="resource-item">
                        <span class="resource-icon">⚔️</span>
                        <span class="resource-value">{{ store.totalUnitCount }}</span>
                        <span class="resource-label">units</span>
                    </div>
                </div>
            </div>

            <div class="hud-center">
                <!-- Timer -->
                <div class="timer-display" :class="{ urgent: store.timeRemaining < 120 }">
                    <span class="timer-icon">⏱️</span>
                    <span class="timer-value">{{ store.formattedTimeRemaining }}</span>
                </div>
            </div>

            <div class="hud-right">
                <!-- Quick Actions -->
                <div class="quick-actions">
                    <button class="hud-btn tooltip" data-tooltip="Go to Capital (H)" @click="goToCapital">
                        🏰
                    </button>
                    <button class="hud-btn tooltip" data-tooltip="Select All Army" @click="selectAllArmy">
                        ⚔️
                    </button>
                    <button class="hud-btn tooltip" data-tooltip="Overview Map" @click="zoomToFit">
                        🗺️
                    </button>
                    <button
                        class="hud-btn tooltip"
                        data-tooltip="Scoreboard (Tab)"
                        :class="{ active: showScoreboard }"
                        @click="showScoreboard = !showScoreboard"
                    >
                        📊
                    </button>
                    <button
                        class="hud-btn tooltip"
                        data-tooltip="Event Log (L)"
                        :class="{ active: showEventLog }"
                        @click="showEventLog = !showEventLog"
                    >
                        📜
                    </button>
                </div>

                <!-- Players Alive -->
                <div class="alive-badge">
                    <span class="alive-count">{{ store.alivePlayers.length }}</span>
                    <span class="alive-label">alive</span>
                </div>
            </div>
        </div>

        <!-- ============================================================ -->
        <!-- BUILD MENU (Left Side) -->
        <!-- ============================================================ -->
        <div class="build-menu panel">
            <div class="panel-title">Build</div>
            <div class="build-grid">
                <button
                    v-for="type in BUILDABLE_STRUCTURES"
                    :key="type"
                    class="build-item"
                    :class="{
                        active: store.buildMode.active && store.buildMode.structureType === type,
                        disabled: !canAffordBuild(type),
                    }"
                    :disabled="!canAffordBuild(type)"
                    @click="
                        store.buildMode.active && store.buildMode.structureType === type
                            ? cancelBuild()
                            : startBuild(type)
                    "
                >
                    <span class="build-icon">{{ getStructureIcon(type) }}</span>
                    <span class="build-name">{{ STRUCTURE_NAMES[type] }}</span>
                    <span class="build-cost gold">{{ BUILDING_COSTS[type].gold }}g</span>
                </button>
            </div>

            <!-- Build Mode Indicator -->
            <div v-if="store.buildMode.active" class="build-mode-indicator">
                <span class="bmi-text">
                    Placing {{ STRUCTURE_NAMES[store.buildMode.structureType!] }}
                </span>
                <button class="btn-small btn-cancel" @click="cancelBuild">
                    Cancel (Esc)
                </button>
            </div>
        </div>

        <!-- ============================================================ -->
        <!-- SELECTION / TRAINING PANEL (Bottom) -->
        <!-- ============================================================ -->
        <div class="bottom-panel">
            <!-- Squad Selection Info -->
            <div v-if="selectedSquadSummary" class="selection-panel panel">
                <div class="panel-title">
                    Selected: {{ selectedSquadSummary.count }} squad{{
                        selectedSquadSummary.count > 1 ? "s" : ""
                    }}
                </div>
                <div class="selection-info">
                    <div class="selection-stats">
                        <div class="stat-row">
                            <span class="stat-label">Units</span>
                            <span class="stat-value">{{ selectedSquadSummary.totalUnits }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">HP</span>
                            <span class="stat-value">
                                {{ selectedSquadSummary.totalHp }} / {{ selectedSquadSummary.maxHp }}
                            </span>
                        </div>
                        <div class="hp-bar-container">
                            <div
                                class="hp-bar-fill"
                                :style="{
                                    width: selectedSquadSummary.hpPercent + '%',
                                    backgroundColor: hpBarColor,
                                }"
                            ></div>
                        </div>
                    </div>
                    <div class="composition-list">
                        <div
                            v-for="(count, type) in selectedSquadSummary.composition"
                            :key="type"
                            class="comp-item"
                        >
                            <span class="comp-icon">{{ getUnitIcon(type as UnitType) }}</span>
                            <span class="comp-name">{{ UNIT_NAMES[type as UnitType] }}</span>
                            <span class="comp-count">x{{ count }}</span>
                        </div>
                    </div>
                </div>
                <div class="selection-hint text-dim">
                    Right-click on the map to move selected units
                </div>
            </div>

            <!-- Training Panel (when production building selected) -->
            <div v-else-if="selectedBuildingForTrain" class="training-panel panel">
                <div class="panel-title">
                    Train Units
                    <span class="text-dim">
                        ({{ selectedBuildingForTrain.x }}, {{ selectedBuildingForTrain.y }})
                    </span>
                </div>
                <div class="train-grid">
                    <button
                        v-for="(type, idx) in TRAINABLE_UNITS"
                        :key="type"
                        class="train-item"
                        :class="{ disabled: !canAffordUnit(type) }"
                        :disabled="!canAffordUnit(type)"
                        @click="trainUnit(type)"
                    >
                        <span class="train-icon">{{ getUnitIcon(type) }}</span>
                        <div class="train-info">
                            <span class="train-name">{{ UNIT_NAMES[type] }}</span>
                            <div class="train-stats-row">
                                <span class="train-cost gold">{{ UNIT_STATS[type].cost }}g</span>
                                <span class="train-time text-dim">{{ UNIT_STATS[type].trainTime }}s</span>
                            </div>
                            <div class="train-stats-detail text-dim">
                                HP:{{ UNIT_STATS[type].maxHp }} DMG:{{ UNIT_STATS[type].damage }}
                                SPD:{{ UNIT_STATS[type].speed }}
                                <template v-if="UNIT_STATS[type].range > 1">
                                    RNG:{{ UNIT_STATS[type].range }}
                                </template>
                            </div>
                        </div>
                        <span class="train-hotkey">{{ idx + 1 }}</span>
                    </button>
                </div>
                <div class="training-hint text-dim">
                    Press 1–5 to queue units. Click elsewhere to deselect.
                </div>
            </div>

            <!-- Tile Info (when nothing selected) -->
            <div v-else-if="hoveredTileInfo" class="tile-info-panel panel">
                <div class="tile-info-grid">
                    <div class="tile-info-item">
                        <span class="tile-info-label">Terrain</span>
                        <span class="tile-info-value">{{ getTerrainName(hoveredTileInfo.terrain) }}</span>
                    </div>
                    <div class="tile-info-item">
                        <span class="tile-info-label">Position</span>
                        <span class="tile-info-value">
                            {{ hoveredTileInfo.x }}, {{ hoveredTileInfo.y }}
                        </span>
                    </div>
                    <div v-if="hoveredTileInfo.ownerId" class="tile-info-item">
                        <span class="tile-info-label">Owner</span>
                        <span class="tile-info-value">
                            {{
                                store.players.find((p) => p.id === hoveredTileInfo!.ownerId)
                                    ?.username || "Unknown"
                            }}
                        </span>
                    </div>
                    <div v-if="hoveredTileInfo.structureType" class="tile-info-item">
                        <span class="tile-info-label">Structure</span>
                        <span class="tile-info-value">
                            {{ getStructureIcon(hoveredTileInfo.structureType) }}
                            {{ STRUCTURE_NAMES[hoveredTileInfo.structureType] }}
                        </span>
                    </div>
                    <div
                        v-if="hoveredTileInfo.captureProgress > 0 && hoveredTileInfo.captureProgress < 100"
                        class="tile-info-item"
                    >
                        <span class="tile-info-label">Capture</span>
                        <span class="tile-info-value text-warning">
                            {{ Math.round(hoveredTileInfo.captureProgress) }}%
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================================ -->
        <!-- SCOREBOARD OVERLAY -->
        <!-- ============================================================ -->
        <Transition name="fade">
            <div v-if="showScoreboard" class="scoreboard-overlay" @click.self="showScoreboard = false">
                <div class="scoreboard-panel panel">
                    <div class="scoreboard-header">
                        <h2 class="scoreboard-title">Scoreboard</h2>
                        <button class="close-btn" @click="showScoreboard = false">✕</button>
                    </div>
                    <table class="scoreboard-table">
                        <thead>
                            <tr>
                                <th class="th-rank">#</th>
                                <th class="th-player">Player</th>
                                <th class="th-score">Score</th>
                                <th class="th-territory">Territory</th>
                                <th class="th-status">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="(player, idx) in store.sortedPlayers"
                                :key="player.id"
                                :class="{
                                    'my-row': player.id === store.playerId,
                                    'dead-row': !player.alive,
                                }"
                            >
                                <td class="td-rank">{{ idx + 1 }}</td>
                                <td class="td-player">
                                    <span
                                        class="player-color-dot"
                                        :style="{ backgroundColor: player.color }"
                                    ></span>
                                    <span class="player-username">{{ player.username }}</span>
                                    <span v-if="player.isBot" class="bot-badge">BOT</span>
                                    <span v-if="player.id === store.playerId" class="you-badge">YOU</span>
                                </td>
                                <td class="td-score">{{ player.score }}</td>
                                <td class="td-territory">{{ player.territoryCount }}</td>
                                <td class="td-status">
                                    <span v-if="player.alive" class="status-alive">Alive</span>
                                    <span v-else class="status-dead">Eliminated</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </Transition>

        <!-- ============================================================ -->
        <!-- EVENT LOG -->
        <!-- ============================================================ -->
        <Transition name="slide-right">
            <div v-if="showEventLog" class="event-log-panel panel">
                <div class="event-log-header">
                    <span class="panel-title">Events</span>
                    <button class="close-btn-small" @click="showEventLog = false">✕</button>
                </div>
                <div class="event-log-list">
                    <div
                        v-for="(event, idx) in store.eventLog"
                        :key="idx"
                        class="event-log-item"
                        :class="'event-' + event.type"
                    >
                        <span class="event-tick text-dim">[{{ event.tick }}]</span>
                        <span class="event-message">{{ event.message }}</span>
                    </div>
                    <div v-if="store.eventLog.length === 0" class="event-empty text-dim">
                        No events yet
                    </div>
                </div>
            </div>
        </Transition>

        <!-- ============================================================ -->
        <!-- ELIMINATED OVERLAY -->
        <!-- ============================================================ -->
        <Transition name="fade">
            <div v-if="!store.isAlive && store.phase === 'playing'" class="eliminated-overlay">
                <div class="eliminated-content">
                    <div class="eliminated-icon">💀</div>
                    <h2 class="eliminated-title">You Have Been Eliminated</h2>
                    <p class="eliminated-desc">
                        Your castle has fallen. You can continue watching the match.
                    </p>
                    <button class="btn-primary" @click="showScoreboard = true">
                        View Scoreboard
                    </button>
                </div>
            </div>
        </Transition>

        <!-- ============================================================ -->
        <!-- PERFORMANCE INFO -->
        <!-- ============================================================ -->
        <div class="perf-info">
            <span>FPS: {{ store.fps }}</span>
            <span>Ping: {{ store.latency >= 0 ? store.latency + "ms" : "?" }}</span>
            <span>Tick: {{ store.tick }}</span>
        </div>

        <!-- ============================================================ -->
        <!-- CONTROLS LEGEND -->
        <!-- ============================================================ -->
        <div class="controls-hint">
            <span><kbd>WASD</kbd> Move</span>
            <span><kbd>Scroll</kbd> Zoom</span>
            <span><kbd>LClick</kbd> Select</span>
            <span><kbd>RClick</kbd> Command</span>
            <span><kbd>Drag</kbd> Box Select</span>
            <span><kbd>Esc</kbd> Cancel</span>
            <span><kbd>Tab</kbd> Score</span>
        </div>
    </div>
</template>

<style scoped>
.game-screen {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background: #0d0d1a;
    user-select: none;
}

/* ---- Canvas ---- */

.canvas-container {
    position: absolute;
    inset: 0;
}

.game-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: default;
}

/* ============================================================
   TOP HUD BAR
   ============================================================ */

.top-hud {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: linear-gradient(
        180deg,
        rgba(13, 13, 26, 0.92) 0%,
        rgba(13, 13, 26, 0.6) 85%,
        transparent 100%
    );
    z-index: 20;
    pointer-events: none;
    gap: 10px;
}

.top-hud > * {
    pointer-events: auto;
}

.hud-left,
.hud-right {
    display: flex;
    align-items: center;
    gap: 10px;
}

.hud-right {
    justify-content: flex-end;
}

.hud-center {
    flex: 0 0 auto;
}

/* ---- Resources ---- */

.resource-display {
    display: flex;
    align-items: center;
    gap: 14px;
}

.resource-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
}

.resource-icon {
    font-size: 16px;
}

.resource-value {
    font-weight: 700;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
}

.resource-value.gold {
    color: var(--color-accent);
}

.resource-rate {
    font-size: 11px;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
}

.resource-rate.positive {
    color: var(--color-success);
}

.resource-label {
    font-size: 11px;
    color: var(--color-text-dim);
}

.gold-display {
    background: rgba(255, 215, 0, 0.06);
    border: 1px solid rgba(255, 215, 0, 0.15);
    padding: 4px 10px;
    border-radius: 6px;
}

/* ---- Timer ---- */

.timer-display {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(22, 33, 62, 0.95);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 6px 16px;
}

.timer-display.urgent {
    border-color: var(--color-danger);
    animation: timer-pulse 1s ease-in-out infinite;
}

@keyframes timer-pulse {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 12px rgba(231, 76, 60, 0.4); }
}

.timer-icon {
    font-size: 14px;
}

.timer-value {
    font-size: 20px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 50px;
    text-align: center;
}

.timer-display.urgent .timer-value {
    color: var(--color-danger);
}

/* ---- Quick Actions ---- */

.quick-actions {
    display: flex;
    gap: 4px;
}

.hud-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.hud-btn:hover {
    background: rgba(30, 45, 80, 0.95);
    border-color: var(--color-text-dim);
}

.hud-btn.active {
    background: rgba(233, 69, 96, 0.2);
    border-color: var(--color-primary);
}

/* ---- Alive Badge ---- */

.alive-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 4px 10px;
}

.alive-count {
    font-size: 16px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-family: var(--font-mono);
}

.alive-label {
    font-size: 11px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ============================================================
   BUILD MENU (Left Side)
   ============================================================ */

.build-menu {
    position: absolute;
    left: 10px;
    top: 60px;
    width: 160px;
    z-index: 15;
    background: rgba(22, 33, 62, 0.93);
    backdrop-filter: blur(8px);
    padding: 10px;
}

.build-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.build-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    font-size: 12px;
    color: var(--color-text);
}

.build-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
}

.build-item.active {
    background: rgba(233, 69, 96, 0.15);
    border-color: var(--color-primary);
}

.build-item.disabled,
.build-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.build-icon {
    font-size: 16px;
    flex-shrink: 0;
    width: 22px;
    text-align: center;
}

.build-name {
    flex: 1;
    font-weight: 500;
    font-size: 11px;
}

.build-cost {
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-mono);
}

.build-cost.gold {
    color: var(--color-accent);
}

/* ---- Build Mode Indicator ---- */

.build-mode-indicator {
    margin-top: 8px;
    padding: 8px;
    background: rgba(233, 69, 96, 0.1);
    border: 1px solid rgba(233, 69, 96, 0.3);
    border-radius: 5px;
    text-align: center;
}

.bmi-text {
    display: block;
    font-size: 11px;
    color: var(--color-primary-hover);
    margin-bottom: 6px;
    font-weight: 600;
}

.btn-cancel {
    background: rgba(231, 76, 60, 0.15);
    color: var(--color-danger);
    border: 1px solid rgba(231, 76, 60, 0.3);
    font-size: 10px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
}

.btn-cancel:hover {
    background: rgba(231, 76, 60, 0.3);
}

/* ============================================================
   BOTTOM PANEL
   ============================================================ */

.bottom-panel {
    position: absolute;
    bottom: 10px;
    left: 180px;
    right: 180px;
    z-index: 15;
    pointer-events: none;
}

.bottom-panel > * {
    pointer-events: auto;
}

/* ---- Selection Panel ---- */

.selection-panel {
    background: rgba(22, 33, 62, 0.93);
    backdrop-filter: blur(8px);
    padding: 12px;
}

.selection-info {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
}

.selection-stats {
    flex: 0 0 120px;
}

.stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    margin-bottom: 3px;
}

.stat-label {
    color: var(--color-text-dim);
}

.stat-value {
    color: var(--color-text-bright);
    font-weight: 600;
    font-family: var(--font-mono);
    font-size: 12px;
}

.hp-bar-container {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
}

.hp-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease, background-color 0.3s ease;
}

.composition-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
}

.comp-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    font-size: 11px;
}

.comp-icon {
    font-size: 14px;
}

.comp-name {
    color: var(--color-text);
    font-weight: 500;
}

.comp-count {
    color: var(--color-text-bright);
    font-weight: 700;
    font-family: var(--font-mono);
}

.selection-hint {
    font-size: 11px;
    text-align: center;
}

/* ---- Training Panel ---- */

.training-panel {
    background: rgba(22, 33, 62, 0.93);
    backdrop-filter: blur(8px);
    padding: 12px;
}

.train-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.train-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    flex: 1 0 180px;
    min-width: 0;
    position: relative;
}

.train-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
}

.train-item.disabled,
.train-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.train-icon {
    font-size: 22px;
    flex-shrink: 0;
}

.train-info {
    flex: 1;
    min-width: 0;
}

.train-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-bright);
    display: block;
}

.train-stats-row {
    display: flex;
    gap: 8px;
    margin-top: 1px;
}

.train-cost {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-mono);
}

.train-time {
    font-size: 10px;
    font-family: var(--font-mono);
}

.train-stats-detail {
    font-size: 9px;
    font-family: var(--font-mono);
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.train-hotkey {
    position: absolute;
    top: 4px;
    right: 6px;
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.training-hint {
    font-size: 11px;
    text-align: center;
    margin-top: 8px;
}

/* ---- Tile Info Panel ---- */

.tile-info-panel {
    background: rgba(22, 33, 62, 0.85);
    backdrop-filter: blur(6px);
    padding: 10px 14px;
    max-width: 400px;
    margin: 0 auto;
}

.tile-info-grid {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.tile-info-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.tile-info-label {
    font-size: 10px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.tile-info-value {
    font-size: 13px;
    color: var(--color-text-bright);
    font-weight: 500;
}

/* ============================================================
   SCOREBOARD OVERLAY
   ============================================================ */

.scoreboard-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
}

.scoreboard-panel {
    width: 600px;
    max-width: 95vw;
    max-height: 80vh;
    overflow-y: auto;
    background: rgba(22, 33, 62, 0.98);
}

.scoreboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
}

.scoreboard-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--color-text-bright);
}

.close-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-dim);
    cursor: pointer;
    font-size: 14px;
    transition: all 0.15s ease;
}

.close-btn:hover {
    background: rgba(231, 76, 60, 0.2);
    border-color: var(--color-danger);
    color: var(--color-danger);
}

/* ---- Scoreboard Table ---- */

.scoreboard-table {
    width: 100%;
    border-collapse: collapse;
}

.scoreboard-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-dim);
    border-bottom: 1px solid var(--color-border);
}

.scoreboard-table td {
    padding: 7px 10px;
    font-size: 13px;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
}

.scoreboard-table tr.my-row {
    background: rgba(233, 69, 96, 0.08);
}

.scoreboard-table tr.dead-row {
    opacity: 0.5;
}

.th-rank {
    width: 40px;
}

.th-score,
.th-territory,
.th-status {
    width: 80px;
    text-align: center;
}

.td-rank {
    font-weight: 700;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
}

.td-player {
    display: flex;
    align-items: center;
    gap: 8px;
}

.player-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
}

.player-username {
    font-weight: 600;
    color: var(--color-text-bright);
}

.bot-badge {
    font-size: 9px;
    font-weight: 700;
    color: var(--color-text-dim);
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.5px;
}

.you-badge {
    font-size: 9px;
    font-weight: 700;
    color: var(--color-primary);
    background: rgba(233, 69, 96, 0.12);
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.5px;
}

.td-score,
.td-territory,
.td-status {
    text-align: center;
    font-family: var(--font-mono);
    font-size: 13px;
}

.td-score {
    font-weight: 700;
    color: var(--color-accent);
}

.status-alive {
    color: var(--color-success);
    font-weight: 600;
    font-size: 12px;
}

.status-dead {
    color: var(--color-danger);
    font-weight: 600;
    font-size: 12px;
}

/* ============================================================
   EVENT LOG
   ============================================================ */

.event-log-panel {
    position: absolute;
    top: 60px;
    right: 10px;
    width: 280px;
    max-height: 400px;
    z-index: 15;
    background: rgba(22, 33, 62, 0.93);
    backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
}

.event-log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}

.close-btn-small {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 4px;
    color: var(--color-text-dim);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
}

.close-btn-small:hover {
    background: rgba(231, 76, 60, 0.2);
    color: var(--color-danger);
}

.event-log-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 320px;
}

.event-log-item {
    display: flex;
    gap: 6px;
    font-size: 11px;
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 3px;
    line-height: 1.4;
}

.event-log-item.event-player_eliminated {
    background: rgba(231, 76, 60, 0.1);
    border-left: 2px solid var(--color-danger);
}

.event-log-item.event-structure_destroyed {
    background: rgba(243, 156, 18, 0.08);
    border-left: 2px solid var(--color-warning);
}

.event-tick {
    font-family: var(--font-mono);
    font-size: 10px;
    flex-shrink: 0;
    width: 45px;
    text-align: right;
}

.event-message {
    color: var(--color-text);
}

.event-empty {
    text-align: center;
    padding: 16px;
    font-size: 12px;
}

/* ============================================================
   ELIMINATED OVERLAY
   ============================================================ */

.eliminated-overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.eliminated-content {
    text-align: center;
    padding: 32px 48px;
    background: rgba(22, 33, 62, 0.95);
    border: 1px solid var(--color-danger);
    border-radius: var(--border-radius);
    box-shadow: 0 0 40px rgba(231, 76, 60, 0.3);
    pointer-events: auto;
}

.eliminated-icon {
    font-size: 48px;
    margin-bottom: 12px;
}

.eliminated-title {
    font-size: 24px;
    font-weight: 800;
    color: var(--color-danger);
    margin-bottom: 8px;
}

.eliminated-desc {
    font-size: 14px;
    color: var(--color-text-dim);
    margin-bottom: 20px;
}

/* ============================================================
   PERFORMANCE INFO
   ============================================================ */

.perf-info {
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 10;
    display: flex;
    gap: 10px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    opacity: 0.6;
    pointer-events: none;
}

/* ============================================================
   CONTROLS HINT
   ============================================================ */

.controls-hint {
    position: absolute;
    bottom: 10px;
    left: 10px;
    z-index: 10;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 10px;
    color: var(--color-text-dim);
    opacity: 0.5;
    pointer-events: none;
    max-width: 400px;
}

.controls-hint kbd {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 9px;
}

/* ============================================================
   TRANSITIONS
   ============================================================ */

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.slide-right-enter-active,
.slide-right-leave-active {
    transition: all 0.25s ease;
}

.slide-right-enter-from {
    opacity: 0;
    transform: translateX(30px);
}

.slide-right-leave-to {
    opacity: 0;
    transform: translateX(30px);
}

/* ============================================================
   RESPONSIVE
   ============================================================ */

@media (max-width: 900px) {
    .build-menu {
        width: 130px;
        top: 55px;
        left: 6px;
        padding: 8px;
    }

    .build-item {
        padding: 5px 6px;
    }

    .build-name {
        font-size: 10px;
    }

    .bottom-panel {
        left: 145px;
        right: 10px;
    }

    .resource-display {
        gap: 8px;
    }

    .resource-item {
        font-size: 11px;
    }

    .resource-icon {
        font-size: 13px;
    }

    .train-item {
        flex: 1 0 140px;
        padding: 6px 8px;
    }

    .train-icon {
        font-size: 18px;
    }

    .controls-hint {
        display: none;
    }
}

@media (max-width: 640px) {
    .build-menu {
        width: 110px;
        top: 50px;
        left: 4px;
        padding: 6px;
    }

    .build-icon {
        font-size: 14px;
        width: 18px;
    }

    .build-name {
        font-size: 9px;
    }

    .build-cost {
        font-size: 9px;
    }

    .bottom-panel {
        left: 120px;
        right: 6px;
    }

    .top-hud {
        padding: 6px 8px;
    }

    .gold-display {
        padding: 3px 6px;
    }

    .resource-label,
    .resource-rate {
        display: none;
    }

    .timer-value {
        font-size: 16px;
    }

    .quick-actions {
        gap: 2px;
    }

    .hud-btn {
        width: 28px;
        height: 28px;
        font-size: 12px;
    }

    .event-log-panel {
        width: 220px;
    }

    .scoreboard-panel {
        width: 95vw;
    }

    .train-item {
        flex: 1 0 100%;
    }

    .perf-info {
        font-size: 8px;
        gap: 6px;
    }
}
</style>
