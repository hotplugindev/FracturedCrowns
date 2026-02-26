<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from "vue";
import { useGameStore } from "../stores/gameStore";
import { Renderer } from "../game/Renderer";
import { TerrainType } from "../types/game";

const store = useGameStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
let renderer: Renderer | null = null;
let animFrameId: number = 0;

const hoveredX = ref(-1);
const hoveredY = ref(-1);
const hoveredTerrain = ref<string | null>(null);
const timeLeft = ref(15);
let countdownInterval: ReturnType<typeof setInterval> | null = null;

const isValidSpawnTile = computed(() => {
    if (hoveredX.value < 0 || hoveredY.value < 0) return false;
    if (store.spawnSelected) return false;
    if (!store.mapTerrain) return false;

    const terrain = store.mapTerrain[hoveredY.value]?.[hoveredX.value];
    if (!terrain) return false;
    if (terrain === TerrainType.Mountain || terrain === TerrainType.Water)
        return false;

    // Check minimum distance from suggested spawns
    const minDist = 15;
    for (const loc of store.spawnLocations) {
        const dx = loc.x - hoveredX.value;
        const dy = loc.y - hoveredY.value;
        if (Math.sqrt(dx * dx + dy * dy) < minDist) return true;
    }

    // Also allow clicking anywhere that's plains/forest/mine, far from borders
    if (hoveredX.value < 5 || hoveredY.value < 5) return false;
    if (
        hoveredX.value >= store.mapWidth - 5 ||
        hoveredY.value >= store.mapHeight - 5
    )
        return false;

    return true;
});

const tileInfoText = computed(() => {
    if (hoveredX.value < 0 || hoveredY.value < 0) return "";
    const terrain = hoveredTerrain.value || "unknown";
    const terrainNames: Record<string, string> = {
        plains: "Plains",
        forest: "Forest",
        mountain: "Mountain (impassable)",
        mine: "Gold Mine",
        water: "Water",
    };
    return `${terrainNames[terrain] || terrain} (${hoveredX.value}, ${hoveredY.value})`;
});

function handleTileClick(x: number, y: number, button: number) {
    if (button !== 0) return;
    if (store.spawnSelected) return;
    if (x < 0 || y < 0 || !store.mapTerrain) return;

    const terrain = store.mapTerrain[y]?.[x];
    if (!terrain) return;
    if (terrain === TerrainType.Mountain || terrain === TerrainType.Water)
        return;

    store.selectSpawn(x, y);
}

function handleTileHover(x: number, y: number) {
    hoveredX.value = x;
    hoveredY.value = y;

    if (store.mapTerrain && y >= 0 && x >= 0) {
        hoveredTerrain.value = store.mapTerrain[y]?.[x] || null;
    } else {
        hoveredTerrain.value = null;
    }

    store.setHoveredTile(x, y);
}

function initRenderer() {
    if (!canvasRef.value) return;

    renderer = new Renderer(canvasRef.value, {
        onTileClick: handleTileClick,
        onTileHover: handleTileHover,
        onSquadClick: () => {},
        onDragSelect: () => {},
        onCameraChange: (x, y, zoom) => {
            store.setCamera(x, y, zoom);
        },
        onZoom: () => {},
    });

    // Center camera on map
    renderer.setCamera(store.mapWidth / 2, store.mapHeight / 2, 0.4);

    renderLoop();
}

function renderLoop() {
    if (!renderer || !store.mapTerrain) {
        animFrameId = requestAnimationFrame(renderLoop);
        return;
    }

    renderer.renderSpawnMap(
        store.mapTerrain,
        store.mapWidth,
        store.mapHeight,
        store.spawnLocations,
        hoveredX.value,
        hoveredY.value,
        store.players,
    );

    animFrameId = requestAnimationFrame(renderLoop);
}

function centerOnSpawns() {
    if (!renderer || store.spawnLocations.length === 0) return;

    // Center on the first available spawn location
    const spawn = store.spawnLocations[0];
    if (!spawn) return;
    renderer.setCamera(spawn.x, spawn.y, 0.8);
    store.setCamera(spawn.x, spawn.y, 0.8);
}

function zoomToFit() {
    if (!renderer) return;
    renderer.setCamera(store.mapWidth / 2, store.mapHeight / 2, 0.25);
    store.setCamera(store.mapWidth / 2, store.mapHeight / 2, 0.25);
}

onMounted(() => {
    // Wait a brief moment for the canvas to be in the DOM
    setTimeout(() => {
        initRenderer();
    }, 50);

    // Countdown timer
    countdownInterval = setInterval(() => {
        timeLeft.value = Math.max(0, timeLeft.value - 1);
    }, 1000);
});

onUnmounted(() => {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = 0;
    }

    if (renderer) {
        renderer.destroy();
        renderer = null;
    }

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
});

// When map data arrives, recenter
watch(
    () => store.mapTerrain,
    (terrain) => {
        if (terrain && renderer) {
            // Slight delay to ensure render is ready
            setTimeout(() => {
                if (store.spawnLocations.length > 0) {
                    centerOnSpawns();
                } else {
                    zoomToFit();
                }
            }, 100);
        }
    },
);

// Update timer from store
watch(
    () => store.timeRemaining,
    (val) => {
        if (val > 0 && val < timeLeft.value) {
            timeLeft.value = Math.ceil(val);
        }
    },
);
</script>

<template>
    <div class="spawn-selection">
        <!-- Canvas -->
        <div class="canvas-container">
            <canvas ref="canvasRef" class="game-canvas"></canvas>
        </div>

        <!-- Top Bar -->
        <div class="spawn-top-bar">
            <div class="top-bar-left">
                <div class="phase-badge">
                    <span class="phase-icon">🏰</span>
                    <span class="phase-text">Choose Starting Location</span>
                </div>
            </div>
            <div class="top-bar-center">
                <div class="timer-display" :class="{ urgent: timeLeft <= 5 }">
                    <span class="timer-icon">⏱️</span>
                    <span class="timer-value">{{ timeLeft }}s</span>
                </div>
            </div>
            <div class="top-bar-right">
                <div class="player-badge">
                    <span class="player-name">{{ store.username }}</span>
                </div>
            </div>
        </div>

        <!-- Spawn Info Panel -->
        <div class="spawn-info-panel panel">
            <template v-if="!store.spawnSelected">
                <h3 class="info-title">
                    <span class="info-icon">📍</span>
                    Select Your Capital
                </h3>
                <p class="info-desc">
                    Click a highlighted location on the map to place your
                    starting castle. Choose a spot near gold mines for a strong
                    economy.
                </p>
                <div class="info-tips">
                    <div class="tip-item">
                        <span class="tip-icon">⛏️</span>
                        <span class="tip-text"
                            >Yellow tiles are gold mines</span
                        >
                    </div>
                    <div class="tip-item">
                        <span class="tip-icon">⭐</span>
                        <span class="tip-text"
                            >Stars mark suggested spawn points</span
                        >
                    </div>
                    <div class="tip-item">
                        <span class="tip-icon">🏔️</span>
                        <span class="tip-text"
                            >Grey tiles are impassable mountains</span
                        >
                    </div>
                    <div class="tip-item">
                        <span class="tip-icon">🌲</span>
                        <span class="tip-text"
                            >Dark green tiles are forests (slow movement)</span
                        >
                    </div>
                </div>
            </template>
            <template v-else>
                <h3 class="info-title selected-title">
                    <span class="info-icon">✅</span>
                    Capital Placed!
                </h3>
                <p class="info-desc">
                    Your kingdom awaits. The match will begin shortly once all
                    players have chosen their positions.
                </p>
                <div class="waiting-indicator">
                    <span class="waiting-dot"></span>
                    <span class="waiting-dot"></span>
                    <span class="waiting-dot"></span>
                    <span class="waiting-text"
                        >Waiting for other players...</span
                    >
                </div>
            </template>
        </div>

        <!-- Tile Info (bottom) -->
        <div class="tile-info-bar" v-if="tileInfoText">
            <span class="tile-info-text">{{ tileInfoText }}</span>
            <span
                v-if="!store.spawnSelected && isValidSpawnTile"
                class="tile-valid-badge"
            >
                Click to spawn here
            </span>
            <span
                v-else-if="
                    !store.spawnSelected && hoveredTerrain === 'mountain'
                "
                class="tile-invalid-badge"
            >
                Impassable
            </span>
            <span
                v-else-if="!store.spawnSelected && hoveredTerrain === 'water'"
                class="tile-invalid-badge"
            >
                Cannot build here
            </span>
        </div>

        <!-- Camera Controls -->
        <div class="camera-controls">
            <button
                class="cam-btn tooltip"
                data-tooltip="Center on spawns"
                @click="centerOnSpawns"
            >
                🎯
            </button>
            <button
                class="cam-btn tooltip"
                data-tooltip="Zoom to fit"
                @click="zoomToFit"
            >
                🗺️
            </button>
        </div>

        <!-- Controls Legend -->
        <div class="controls-legend">
            <div class="legend-item">
                <kbd>Scroll</kbd>
                <span>Zoom</span>
            </div>
            <div class="legend-item">
                <kbd>Middle Drag</kbd>
                <span>Pan</span>
            </div>
            <div class="legend-item">
                <kbd>WASD</kbd>
                <span>Move Camera</span>
            </div>
            <div class="legend-item">
                <kbd>Left Click</kbd>
                <span>Select Spawn</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.spawn-selection {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background: #0d0d1a;
}

/* ---- Canvas ---- */

.canvas-container {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
}

.game-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
}

/* ---- Top Bar ---- */

.spawn-top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: linear-gradient(
        180deg,
        rgba(13, 13, 26, 0.95) 0%,
        rgba(13, 13, 26, 0.7) 80%,
        transparent 100%
    );
    z-index: 10;
    pointer-events: none;
}

.spawn-top-bar > * {
    pointer-events: auto;
}

.top-bar-left,
.top-bar-right {
    flex: 1;
}

.top-bar-right {
    display: flex;
    justify-content: flex-end;
}

.top-bar-center {
    flex: 0 0 auto;
}

.phase-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 8px 16px;
}

.phase-icon {
    font-size: 18px;
}

.phase-text {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-bright);
    letter-spacing: 0.3px;
}

.timer-display {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 8px 20px;
    transition: all 0.3s ease;
}

.timer-display.urgent {
    border-color: var(--color-danger);
    background: rgba(231, 76, 60, 0.2);
    animation: timer-pulse 0.8s ease-in-out infinite;
}

@keyframes timer-pulse {
    0%,
    100% {
        box-shadow: 0 0 0 0 rgba(231, 76, 60, 0);
    }
    50% {
        box-shadow: 0 0 16px 4px rgba(231, 76, 60, 0.3);
    }
}

.timer-icon {
    font-size: 16px;
}

.timer-value {
    font-size: 22px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 40px;
    text-align: center;
}

.timer-display.urgent .timer-value {
    color: var(--color-danger);
}

.player-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 8px 16px;
}

.player-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-bright);
}

/* ---- Spawn Info Panel ---- */

.spawn-info-panel {
    position: absolute;
    top: 80px;
    left: 16px;
    width: 300px;
    z-index: 10;
    background: rgba(22, 33, 62, 0.95);
    backdrop-filter: blur(10px);
}

.info-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-bright);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.info-title.selected-title {
    color: var(--color-success);
}

.info-icon {
    font-size: 18px;
}

.info-desc {
    font-size: 13px;
    color: var(--color-text-dim);
    line-height: 1.6;
    margin-bottom: 14px;
}

.info-tips {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.tip-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--color-text);
}

.tip-icon {
    font-size: 15px;
    width: 22px;
    text-align: center;
    flex-shrink: 0;
}

.tip-text {
    line-height: 1.4;
}

/* ---- Waiting Indicator ---- */

.waiting-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    margin-top: 4px;
}

.waiting-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-dim);
    opacity: 0.4;
    animation: dot-bounce 1.4s ease-in-out infinite;
}

.waiting-dot:nth-child(2) {
    animation-delay: 0.2s;
}

.waiting-dot:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes dot-bounce {
    0%,
    80%,
    100% {
        opacity: 0.2;
        transform: scale(0.8);
    }
    40% {
        opacity: 1;
        transform: scale(1.3);
    }
}

.waiting-text {
    font-size: 12px;
    color: var(--color-text-dim);
    margin-left: 4px;
}

/* ---- Tile Info Bar ---- */

.tile-info-bar {
    position: absolute;
    bottom: 50px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(13, 13, 26, 0.9);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 8px 18px;
    backdrop-filter: blur(8px);
}

.tile-info-text {
    font-size: 13px;
    color: var(--color-text);
    font-weight: 500;
}

.tile-valid-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-success);
    background: rgba(46, 204, 113, 0.12);
    padding: 2px 10px;
    border-radius: 10px;
    border: 1px solid rgba(46, 204, 113, 0.3);
}

.tile-invalid-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-danger);
    background: rgba(231, 76, 60, 0.12);
    padding: 2px 10px;
    border-radius: 10px;
    border: 1px solid rgba(231, 76, 60, 0.3);
}

/* ---- Camera Controls ---- */

.camera-controls {
    position: absolute;
    bottom: 100px;
    right: 16px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.cam-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(22, 33, 62, 0.9);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    font-size: 18px;
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(8px);
}

.cam-btn:hover {
    background: rgba(30, 45, 80, 0.95);
    border-color: var(--color-text-dim);
    transform: scale(1.05);
}

.cam-btn:active {
    transform: scale(0.95);
}

/* ---- Controls Legend ---- */

.controls-legend {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    gap: 16px;
    padding: 6px 14px;
    background: rgba(13, 13, 26, 0.7);
    border-radius: 6px;
    backdrop-filter: blur(6px);
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--color-text-dim);
}

.legend-item kbd {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--color-text);
}

/* ---- Responsive ---- */

@media (max-width: 700px) {
    .spawn-info-panel {
        width: 240px;
        top: 70px;
        left: 8px;
    }

    .info-title {
        font-size: 14px;
    }

    .info-desc {
        font-size: 12px;
    }

    .controls-legend {
        gap: 8px;
        padding: 4px 10px;
    }

    .legend-item {
        font-size: 10px;
    }

    .phase-text {
        font-size: 12px;
    }

    .timer-value {
        font-size: 18px;
    }
}

@media (max-width: 480px) {
    .controls-legend {
        display: none;
    }

    .spawn-info-panel {
        width: calc(100% - 16px);
        top: auto;
        bottom: 60px;
        left: 8px;
        padding: 12px;
    }

    .camera-controls {
        bottom: auto;
        top: 70px;
        right: 8px;
    }
}
</style>
