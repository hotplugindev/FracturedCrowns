<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useGameStore, AppScreen } from "./stores/gameStore";
import LandingPage from "./views/LandingPage.vue";
import LobbyScreen from "./views/LobbyScreen.vue";
import SpawnSelection from "./views/SpawnSelection.vue";
import GameScreen from "./views/GameScreen.vue";
import ScoreboardScreen from "./views/ScoreboardScreen.vue";

const store = useGameStore();

onMounted(() => {
    store.initializeSocket();
});

// Measure latency periodically
let latencyInterval: ReturnType<typeof setInterval> | null = null;

watch(
    () => store.connected,
    (connected) => {
        if (connected) {
            latencyInterval = setInterval(() => {
                store.measureLatency();
            }, 10000);
        } else if (latencyInterval) {
            clearInterval(latencyInterval);
            latencyInterval = null;
        }
    },
);
</script>

<template>
    <div id="fractured-crowns">
        <!-- Connection Status Banner -->
        <div v-if="!store.connected" class="connection-banner">
            <span class="pulse-dot"></span>
            Connecting to server...
        </div>

        <!-- Error Toast -->
        <Transition name="toast">
            <div v-if="store.error" class="error-toast">
                {{ store.error }}
            </div>
        </Transition>

        <!-- Screen Router -->
        <LandingPage v-if="store.screen === AppScreen.Landing" />
        <LobbyScreen v-else-if="store.screen === AppScreen.Queue" />
        <SpawnSelection v-else-if="store.screen === AppScreen.SpawnSelection" />
        <GameScreen v-else-if="store.screen === AppScreen.Game" />
        <ScoreboardScreen v-else-if="store.screen === AppScreen.Scoreboard" />
    </div>
</template>

<style>
/* ============================================================
   Fractured Crowns — Global Styles
   ============================================================ */

:root {
    --color-bg: #0d0d1a;
    --color-bg-light: #1a1a2e;
    --color-bg-panel: #16213e;
    --color-bg-panel-hover: #1e2d50;
    --color-primary: #e94560;
    --color-primary-hover: #ff6b81;
    --color-secondary: #0f3460;
    --color-accent: #ffd700;
    --color-text: #e0e0e0;
    --color-text-dim: #8a8a9a;
    --color-text-bright: #ffffff;
    --color-success: #2ecc71;
    --color-warning: #f39c12;
    --color-danger: #e74c3c;
    --color-border: #2a2a4a;
    --font-main: "Segoe UI", system-ui, -apple-system, sans-serif;
    --font-mono: "Consolas", "Fira Code", monospace;
    --border-radius: 8px;
    --shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    --shadow-glow: 0 0 20px rgba(233, 69, 96, 0.3);
    --transition: 0.2s ease;
}

*,
*::before,
*::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

html,
body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-main);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

#app {
    width: 100%;
    height: 100%;
}

#fractured-crowns {
    width: 100%;
    height: 100%;
    position: relative;
}

/* ---- Scrollbar ---- */

::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: var(--color-bg);
}

::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-dim);
}

/* ---- Selection ---- */

::selection {
    background: var(--color-primary);
    color: var(--color-text-bright);
}

/* ---- Buttons ---- */

button {
    font-family: var(--font-main);
    cursor: pointer;
    border: none;
    outline: none;
    transition: all var(--transition);
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* ---- Inputs ---- */

input {
    font-family: var(--font-main);
    outline: none;
}

/* ---- Common Components ---- */

.btn-primary {
    background: var(--color-primary);
    color: var(--color-text-bright);
    padding: 12px 32px;
    border-radius: var(--border-radius);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    border: none;
    cursor: pointer;
    transition: all var(--transition);
}

.btn-primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
    box-shadow: var(--shadow-glow);
    transform: translateY(-1px);
}

.btn-primary:active:not(:disabled) {
    transform: translateY(0);
}

.btn-secondary {
    background: var(--color-secondary);
    color: var(--color-text);
    padding: 10px 24px;
    border-radius: var(--border-radius);
    font-size: 14px;
    font-weight: 500;
    border: 1px solid var(--color-border);
    cursor: pointer;
    transition: all var(--transition);
}

.btn-secondary:hover:not(:disabled) {
    background: var(--color-bg-panel-hover);
    border-color: var(--color-text-dim);
}

.btn-small {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: 4px;
}

.panel {
    background: var(--color-bg-panel);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 16px;
}

.panel-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--color-text-dim);
    margin-bottom: 10px;
}

/* ---- Connection Banner ---- */

.connection-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: rgba(233, 69, 96, 0.9);
    color: white;
    text-align: center;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    backdrop-filter: blur(8px);
}

.pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: white;
    animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
    0%,
    100% {
        opacity: 0.4;
        transform: scale(0.8);
    }
    50% {
        opacity: 1;
        transform: scale(1.2);
    }
}

/* ---- Error Toast ---- */

.error-toast {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 999;
    background: rgba(231, 76, 60, 0.95);
    color: white;
    padding: 12px 24px;
    border-radius: var(--border-radius);
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
    max-width: 500px;
    text-align: center;
}

/* ---- Toast Transition ---- */

.toast-enter-active,
.toast-leave-active {
    transition: all 0.3s ease;
}

.toast-enter-from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
}

.toast-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
}

/* ---- Fade Transition ---- */

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

/* ---- Gold Color ---- */

.gold {
    color: var(--color-accent);
}

.text-dim {
    color: var(--color-text-dim);
}

.text-bright {
    color: var(--color-text-bright);
}

.text-success {
    color: var(--color-success);
}

.text-danger {
    color: var(--color-danger);
}

.text-warning {
    color: var(--color-warning);
}

/* ---- Tooltip ---- */

.tooltip {
    position: relative;
}

.tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    margin-bottom: 4px;
}

.tooltip:hover::after {
    opacity: 1;
}
</style>
