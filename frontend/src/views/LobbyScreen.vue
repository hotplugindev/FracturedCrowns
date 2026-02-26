<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useGameStore } from "../stores/gameStore";

const store = useGameStore();

// Animated countdown
const displayTime = ref(store.lobbyState.timeUntilStart);
let countdownInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    countdownInterval = setInterval(() => {
        if (store.lobbyState.timeUntilStart > 0) {
            displayTime.value = store.lobbyState.timeUntilStart;
        }
    }, 250);
});

onUnmounted(() => {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
});

const formattedTime = computed(() => {
    const t = Math.max(0, Math.ceil(displayTime.value));
    const mins = Math.floor(t / 60);
    const secs = t % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
});

const fillPercent = computed(() => {
    const { playerCount, maxPlayers } = store.lobbyState;
    return Math.min(100, (playerCount / maxPlayers) * 100);
});

const playerSlots = computed(() => {
    const slots: Array<{ filled: boolean; index: number }> = [];
    for (let i = 0; i < store.lobbyState.maxPlayers; i++) {
        slots.push({
            filled: i < store.lobbyState.playerCount,
            index: i,
        });
    }
    return slots;
});

const statusText = computed(() => {
    const { playerCount, maxPlayers } = store.lobbyState;
    if (playerCount >= maxPlayers) {
        return "Lobby full — starting match!";
    }
    if (playerCount >= 2) {
        return "Waiting for more players or countdown...";
    }
    return "Waiting for players to join...";
});

const isAlmostFull = computed(() => {
    return store.lobbyState.playerCount >= store.lobbyState.maxPlayers * 0.8;
});

function handleLeave() {
    store.leaveQueue();
}
</script>

<template>
    <div class="lobby-screen">
        <div class="lobby-bg">
            <div class="bg-grid"></div>
            <div class="bg-glow bg-glow-1"></div>
            <div class="bg-glow bg-glow-2"></div>
        </div>

        <div class="lobby-content">
            <!-- Header -->
            <div class="lobby-header">
                <div class="crown-icon">⚔️</div>
                <h1 class="lobby-title">Finding Match</h1>
                <p class="lobby-subtitle">{{ statusText }}</p>
            </div>

            <!-- Countdown Timer -->
            <div class="countdown-section">
                <div class="countdown-ring">
                    <svg viewBox="0 0 120 120" class="countdown-svg">
                        <circle
                            cx="60"
                            cy="60"
                            r="52"
                            fill="none"
                            stroke="rgba(255, 255, 255, 0.08)"
                            stroke-width="6"
                        />
                        <circle
                            cx="60"
                            cy="60"
                            r="52"
                            fill="none"
                            stroke="var(--color-primary)"
                            stroke-width="6"
                            stroke-linecap="round"
                            :stroke-dasharray="2 * Math.PI * 52"
                            :stroke-dashoffset="
                                2 * Math.PI * 52 * (1 - displayTime / 180)
                            "
                            transform="rotate(-90 60 60)"
                            class="countdown-progress"
                        />
                    </svg>
                    <div class="countdown-value">
                        <span class="countdown-time">{{ formattedTime }}</span>
                        <span class="countdown-label">until start</span>
                    </div>
                </div>
            </div>

            <!-- Player Count -->
            <div class="players-section panel">
                <div class="players-header">
                    <span class="panel-title">Players</span>
                    <span class="player-count-badge" :class="{ 'almost-full': isAlmostFull }">
                        {{ store.lobbyState.playerCount }} / {{ store.lobbyState.maxPlayers }}
                    </span>
                </div>

                <!-- Progress Bar -->
                <div class="player-progress-bar">
                    <div
                        class="player-progress-fill"
                        :style="{ width: fillPercent + '%' }"
                        :class="{ 'almost-full': isAlmostFull }"
                    ></div>
                </div>

                <!-- Player Slots Grid -->
                <div class="player-slots">
                    <div
                        v-for="slot in playerSlots"
                        :key="slot.index"
                        class="player-slot"
                        :class="{ filled: slot.filled }"
                    >
                        <span v-if="slot.filled" class="slot-icon">👤</span>
                        <span v-else class="slot-icon empty">·</span>
                    </div>
                </div>

                <p class="slots-info text-dim">
                    <template v-if="store.lobbyState.playerCount < store.lobbyState.maxPlayers">
                        {{ store.lobbyState.maxPlayers - store.lobbyState.playerCount }}
                        empty slots will be filled with bots
                    </template>
                    <template v-else>
                        All slots filled — match starting now!
                    </template>
                </p>
            </div>

            <!-- Your Info -->
            <div class="your-info panel">
                <div class="info-row">
                    <span class="info-label-text">Your Name</span>
                    <span class="info-value-text text-bright">{{ store.username }}</span>
                </div>
                <div class="info-row">
                    <span class="info-label-text">Status</span>
                    <span class="info-value-text text-success">
                        <span class="status-dot online"></span>
                        In Queue
                    </span>
                </div>
            </div>

            <!-- Tip -->
            <div class="tip-section">
                <p class="tip-text text-dim">
                    💡 <strong>Tip:</strong> Capture mines early to boost your economy.
                    Territory far from your capital becomes costly to maintain!
                </p>
            </div>

            <!-- Leave Button -->
            <button class="btn-secondary leave-btn" @click="handleLeave">
                ← Leave Queue
            </button>
        </div>

        <!-- Animated waiting dots -->
        <div class="waiting-dots">
            <span class="dot dot-1"></span>
            <span class="dot dot-2"></span>
            <span class="dot dot-3"></span>
        </div>
    </div>
</template>

<style scoped>
.lobby-screen {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
}

/* ---- Background ---- */

.lobby-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.bg-grid {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
            rgba(255, 255, 255, 0.02) 1px,
            transparent 1px
        ),
        linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.02) 1px,
            transparent 1px
        );
    background-size: 60px 60px;
}

.bg-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(120px);
    opacity: 0.12;
}

.bg-glow-1 {
    width: 500px;
    height: 500px;
    background: var(--color-primary);
    top: -150px;
    left: -100px;
    animation: float 10s ease-in-out infinite;
}

.bg-glow-2 {
    width: 400px;
    height: 400px;
    background: #0f3460;
    bottom: -150px;
    right: -100px;
    animation: float 14s ease-in-out infinite reverse;
}

@keyframes float {
    0%,
    100% {
        transform: translate(0, 0);
    }
    50% {
        transform: translate(30px, 20px);
    }
}

/* ---- Content ---- */

.lobby-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    z-index: 1;
    max-width: 480px;
    width: 100%;
    padding: 24px;
}

/* ---- Header ---- */

.lobby-header {
    text-align: center;
}

.crown-icon {
    font-size: 40px;
    margin-bottom: 6px;
}

.lobby-title {
    font-size: 32px;
    font-weight: 800;
    color: var(--color-text-bright);
    letter-spacing: -0.5px;
    margin-bottom: 4px;
}

.lobby-subtitle {
    font-size: 14px;
    color: var(--color-text-dim);
}

/* ---- Countdown ---- */

.countdown-section {
    display: flex;
    justify-content: center;
}

.countdown-ring {
    position: relative;
    width: 140px;
    height: 140px;
}

.countdown-svg {
    width: 100%;
    height: 100%;
}

.countdown-progress {
    transition: stroke-dashoffset 0.5s ease;
}

.countdown-value {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.countdown-time {
    font-size: 32px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
}

.countdown-label {
    font-size: 11px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 2px;
}

/* ---- Players Section ---- */

.players-section {
    width: 100%;
}

.players-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.player-count-badge {
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text-bright);
    background: var(--color-secondary);
    padding: 4px 12px;
    border-radius: 12px;
    font-variant-numeric: tabular-nums;
    transition: all 0.3s ease;
}

.player-count-badge.almost-full {
    background: var(--color-primary);
    box-shadow: 0 0 12px rgba(233, 69, 96, 0.4);
}

/* ---- Progress Bar ---- */

.player-progress-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 14px;
}

.player-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-secondary), var(--color-primary));
    border-radius: 3px;
    transition: width 0.5s ease;
}

.player-progress-fill.almost-full {
    background: linear-gradient(90deg, var(--color-primary), #ff6b81);
    box-shadow: 0 0 8px rgba(233, 69, 96, 0.5);
}

/* ---- Player Slots Grid ---- */

.player-slots {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 4px;
    margin-bottom: 10px;
}

.player-slot {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.3s ease;
    font-size: 14px;
}

.player-slot.filled {
    background: rgba(233, 69, 96, 0.15);
    border-color: rgba(233, 69, 96, 0.3);
}

.slot-icon.empty {
    color: rgba(255, 255, 255, 0.1);
    font-size: 18px;
}

.slots-info {
    font-size: 12px;
    text-align: center;
}

/* ---- Your Info ---- */

.your-info {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 18px;
}

.info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.info-label-text {
    font-size: 12px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.info-value-text {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
}

.status-dot.online {
    background: var(--color-success);
    box-shadow: 0 0 6px var(--color-success);
}

/* ---- Tip ---- */

.tip-section {
    width: 100%;
    padding: 12px 16px;
    background: rgba(243, 156, 18, 0.06);
    border: 1px solid rgba(243, 156, 18, 0.15);
    border-radius: var(--border-radius);
}

.tip-text {
    font-size: 12px;
    line-height: 1.6;
}

.tip-text strong {
    color: var(--color-warning);
}

/* ---- Leave Button ---- */

.leave-btn {
    margin-top: 4px;
}

/* ---- Waiting Dots ---- */

.waiting-dots {
    position: absolute;
    bottom: 30px;
    display: flex;
    gap: 8px;
}

.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-dim);
    opacity: 0.3;
    animation: dot-bounce 1.4s ease-in-out infinite;
}

.dot-1 {
    animation-delay: 0s;
}

.dot-2 {
    animation-delay: 0.2s;
}

.dot-3 {
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

/* ---- Responsive ---- */

@media (max-width: 500px) {
    .lobby-title {
        font-size: 26px;
    }

    .player-slots {
        grid-template-columns: repeat(5, 1fr);
    }

    .countdown-ring {
        width: 110px;
        height: 110px;
    }

    .countdown-time {
        font-size: 26px;
    }
}
</style>
