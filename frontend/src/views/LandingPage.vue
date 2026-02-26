<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useGameStore } from "../stores/gameStore";

const store = useGameStore();
const usernameInput = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function handleJoin() {
    const name = usernameInput.value.trim();
    if (name.length < 1) {
        store.setError("Please enter a username");
        return;
    }
    if (name.length > 20) {
        store.setError("Username must be 20 characters or less");
        return;
    }
    store.joinQueue(name);
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
        handleJoin();
    }
}

onMounted(() => {
    inputRef.value?.focus();
});
</script>

<template>
    <div class="landing-page">
        <div class="landing-bg">
            <div class="bg-grid"></div>
            <div class="bg-glow bg-glow-1"></div>
            <div class="bg-glow bg-glow-2"></div>
        </div>

        <div class="landing-content">
            <!-- Title -->
            <div class="title-section">
                <div class="crown-icon">👑</div>
                <h1 class="game-title">Fractured Crowns</h1>
                <p class="game-subtitle">
                    Real-Time Multiplayer Strategy
                </p>
                <p class="game-tagline">
                    Conquer. Expand. Rule.
                </p>
            </div>

            <!-- Join Form -->
            <div class="join-section">
                <div class="join-card panel">
                    <label class="input-label" for="username-input">
                        Choose Your Name
                    </label>
                    <div class="input-row">
                        <input
                            ref="inputRef"
                            id="username-input"
                            v-model="usernameInput"
                            type="text"
                            class="username-input"
                            placeholder="Enter username..."
                            maxlength="20"
                            autocomplete="off"
                            spellcheck="false"
                            @keydown="handleKeydown"
                        />
                        <button
                            class="btn-primary join-btn"
                            :disabled="!store.connected || usernameInput.trim().length < 1"
                            @click="handleJoin"
                        >
                            <span class="btn-icon">⚔️</span>
                            Play
                        </button>
                    </div>
                    <p v-if="!store.connected" class="connection-status text-warning">
                        <span class="pulse-dot-small"></span>
                        Connecting to server...
                    </p>
                    <p v-else class="connection-status text-success">
                        <span class="status-dot online"></span>
                        Server online
                    </p>
                </div>
            </div>

            <!-- Server Info -->
            <div class="server-info" v-if="store.connected">
                <div class="info-item">
                    <span class="info-value">{{ store.serverInfo.activeMatches }}</span>
                    <span class="info-label">Active Matches</span>
                </div>
                <div class="info-divider"></div>
                <div class="info-item">
                    <span class="info-value">{{ store.serverInfo.totalPlayers }}</span>
                    <span class="info-label">Players Online</span>
                </div>
                <div class="info-divider"></div>
                <div class="info-item">
                    <span class="info-value">{{ store.serverInfo.queueSize }}</span>
                    <span class="info-label">In Queue</span>
                </div>
            </div>

            <!-- Game Features -->
            <div class="features-section">
                <div class="feature">
                    <span class="feature-icon">🗺️</span>
                    <span class="feature-text">Procedural Maps</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">⚔️</span>
                    <span class="feature-text">Real-Time Combat</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">🏰</span>
                    <span class="feature-text">Build & Expand</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">🤖</span>
                    <span class="feature-text">Bot Opponents</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">👥</span>
                    <span class="feature-text">Up to 20 Players</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">🎯</span>
                    <span class="feature-text">Supply Lines</span>
                </div>
            </div>

            <!-- Footer -->
            <div class="landing-footer">
                <p class="text-dim">
                    Matches last 20–30 minutes · No account needed · Just play
                </p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.landing-page {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
}

/* ---- Background Effects ---- */

.landing-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.bg-grid {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
            rgba(255, 255, 255, 0.03) 1px,
            transparent 1px
        ),
        linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.03) 1px,
            transparent 1px
        );
    background-size: 60px 60px;
}

.bg-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(120px);
    opacity: 0.15;
}

.bg-glow-1 {
    width: 600px;
    height: 600px;
    background: var(--color-primary);
    top: -200px;
    right: -100px;
    animation: float 12s ease-in-out infinite;
}

.bg-glow-2 {
    width: 500px;
    height: 500px;
    background: #3498db;
    bottom: -200px;
    left: -100px;
    animation: float 15s ease-in-out infinite reverse;
}

@keyframes float {
    0%,
    100% {
        transform: translate(0, 0);
    }
    50% {
        transform: translate(40px, 30px);
    }
}

/* ---- Content ---- */

.landing-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
    z-index: 1;
    max-width: 600px;
    width: 100%;
    padding: 24px;
}

/* ---- Title Section ---- */

.title-section {
    text-align: center;
}

.crown-icon {
    font-size: 56px;
    margin-bottom: 8px;
    animation: crown-bounce 3s ease-in-out infinite;
}

@keyframes crown-bounce {
    0%,
    100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-8px);
    }
}

.game-title {
    font-size: 52px;
    font-weight: 800;
    letter-spacing: -1px;
    background: linear-gradient(135deg, #ffd700, #e94560, #ff6b81);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.1;
    margin-bottom: 8px;
}

.game-subtitle {
    font-size: 18px;
    color: var(--color-text-dim);
    font-weight: 400;
    letter-spacing: 2px;
    text-transform: uppercase;
}

.game-tagline {
    font-size: 14px;
    color: var(--color-text-dim);
    margin-top: 6px;
    letter-spacing: 4px;
    text-transform: uppercase;
    opacity: 0.6;
}

/* ---- Join Section ---- */

.join-section {
    width: 100%;
    max-width: 440px;
}

.join-card {
    padding: 28px;
}

.input-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--color-text-dim);
    margin-bottom: 12px;
}

.input-row {
    display: flex;
    gap: 10px;
}

.username-input {
    flex: 1;
    padding: 12px 16px;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius);
    color: var(--color-text-bright);
    font-size: 16px;
    transition: all var(--transition);
}

.username-input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.15);
}

.username-input::placeholder {
    color: var(--color-text-dim);
    opacity: 0.6;
}

.join-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    padding: 12px 28px;
}

.btn-icon {
    font-size: 16px;
}

.connection-status {
    margin-top: 12px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.pulse-dot-small {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
    animation: pulse 1.5s ease-in-out infinite;
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

.status-dot.online {
    background: var(--color-success);
    box-shadow: 0 0 6px var(--color-success);
}

/* ---- Server Info ---- */

.server-info {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 24px;
    background: rgba(22, 33, 62, 0.5);
    border-radius: var(--border-radius);
    border: 1px solid var(--color-border);
}

.info-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
}

.info-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-bright);
}

.info-label {
    font-size: 11px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.info-divider {
    width: 1px;
    height: 30px;
    background: var(--color-border);
}

/* ---- Features ---- */

.features-section {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
}

.feature {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(22, 33, 62, 0.3);
    border-radius: 20px;
    border: 1px solid rgba(42, 42, 74, 0.5);
    font-size: 13px;
    color: var(--color-text-dim);
    transition: all var(--transition);
}

.feature:hover {
    border-color: var(--color-primary);
    color: var(--color-text);
    background: rgba(233, 69, 96, 0.05);
}

.feature-icon {
    font-size: 16px;
}

.feature-text {
    font-weight: 500;
}

/* ---- Footer ---- */

.landing-footer {
    text-align: center;
    font-size: 12px;
}

/* ---- Responsive ---- */

@media (max-width: 600px) {
    .game-title {
        font-size: 36px;
    }

    .game-subtitle {
        font-size: 14px;
    }

    .input-row {
        flex-direction: column;
    }

    .join-btn {
        justify-content: center;
    }

    .server-info {
        gap: 12px;
        padding: 10px 16px;
    }

    .features-section {
        gap: 8px;
    }
}
</style>
