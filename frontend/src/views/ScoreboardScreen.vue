<script setup lang="ts">
import { computed } from "vue";
import { useGameStore } from "../stores/gameStore";

const store = useGameStore();

const result = computed(() => store.matchResult);

const formattedDuration = computed(() => {
    if (!result.value) return "0:00";
    const totalSecs = Math.round(result.value.duration);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
});

const winner = computed(() => {
    if (!result.value || !result.value.winnerId) return null;
    return result.value.scores.find(
        (s) => s.playerId === result.value!.winnerId,
    );
});

const isMyWin = computed(() => {
    if (!result.value || !store.playerId) return false;
    return result.value.winnerId === store.playerId;
});

const myPlacement = computed(() => {
    if (!result.value || !store.playerId) return 0;
    const entry = result.value.scores.find(
        (s) => s.playerId === store.playerId,
    );
    return entry?.placement ?? 0;
});

const myScore = computed(() => {
    if (!result.value || !store.playerId) return null;
    return (
        result.value.scores.find((s) => s.playerId === store.playerId) ?? null
    );
});

function placementSuffix(n: number): string {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    switch (n % 10) {
        case 1:
            return "st";
        case 2:
            return "nd";
        case 3:
            return "rd";
        default:
            return "th";
    }
}

function placementText(n: number): string {
    return `${n}${placementSuffix(n)}`;
}

function placementClass(n: number): string {
    if (n === 1) return "placement-1st";
    if (n === 2) return "placement-2nd";
    if (n === 3) return "placement-3rd";
    return "placement-other";
}

function handlePlayAgain() {
    store.goToLanding();
}
</script>

<template>
    <div class="scoreboard-screen">
        <div class="scoreboard-bg">
            <div class="bg-grid"></div>
            <div class="bg-glow bg-glow-1"></div>
            <div class="bg-glow bg-glow-2"></div>
            <div class="bg-glow bg-glow-3"></div>
        </div>

        <div class="scoreboard-content">
            <!-- Result Header -->
            <div class="result-header">
                <template v-if="isMyWin">
                    <div class="result-icon victory">👑</div>
                    <h1 class="result-title victory-title">Victory!</h1>
                    <p class="result-subtitle">
                        Your kingdom stands supreme. All challengers have
                        fallen.
                    </p>
                </template>
                <template v-else-if="myPlacement > 0 && myPlacement <= 3">
                    <div class="result-icon podium">🏆</div>
                    <h1 class="result-title podium-title">
                        {{ placementText(myPlacement) }} Place!
                    </h1>
                    <p class="result-subtitle">
                        A worthy effort. Your kingdom made its mark on history.
                    </p>
                </template>
                <template v-else>
                    <div class="result-icon defeat">⚔️</div>
                    <h1 class="result-title defeat-title">Match Over</h1>
                    <p class="result-subtitle">
                        The dust settles. Review the final standings below.
                    </p>
                </template>
            </div>

            <!-- Match Stats Summary -->
            <div class="match-summary">
                <div class="summary-item">
                    <span class="summary-value">{{ formattedDuration }}</span>
                    <span class="summary-label">Duration</span>
                </div>
                <div class="summary-divider"></div>
                <div class="summary-item" v-if="winner">
                    <span class="summary-value winner-name">
                        <span
                            class="winner-dot"
                            :style="{
                                backgroundColor: result?.scores.find(
                                    (s) => s.playerId === winner!.playerId,
                                )?.playerId
                                    ? '#ffd700'
                                    : '#888',
                            }"
                        ></span>
                        {{ winner.username }}
                    </span>
                    <span class="summary-label">Winner</span>
                </div>
                <div class="summary-divider"></div>
                <div class="summary-item" v-if="result">
                    <span class="summary-value">{{
                        result.scores.length
                    }}</span>
                    <span class="summary-label">Players</span>
                </div>
            </div>

            <!-- Your Stats Card -->
            <div v-if="myScore" class="my-stats-card panel">
                <div class="my-stats-header">
                    <div
                        class="my-placement"
                        :class="placementClass(myScore.placement)"
                    >
                        <span class="placement-number">{{
                            myScore.placement
                        }}</span>
                        <span class="placement-suffix">{{
                            placementSuffix(myScore.placement)
                        }}</span>
                    </div>
                    <div class="my-stats-name">
                        <span class="my-username">{{ myScore.username }}</span>
                        <span class="my-score-label">
                            Score: <span class="gold">{{ myScore.score }}</span>
                        </span>
                    </div>
                </div>
                <div class="my-stats-grid">
                    <div class="my-stat">
                        <span class="my-stat-icon">🗺️</span>
                        <span class="my-stat-value">{{
                            myScore.territoryCaptured
                        }}</span>
                        <span class="my-stat-label">Territory</span>
                    </div>
                    <div class="my-stat">
                        <span class="my-stat-icon">⚔️</span>
                        <span class="my-stat-value">{{
                            myScore.unitsKilled
                        }}</span>
                        <span class="my-stat-label">Kills</span>
                    </div>
                    <div class="my-stat">
                        <span class="my-stat-icon">💀</span>
                        <span class="my-stat-value">{{
                            myScore.unitsLost
                        }}</span>
                        <span class="my-stat-label">Losses</span>
                    </div>
                    <div class="my-stat">
                        <span class="my-stat-icon">💰</span>
                        <span class="my-stat-value gold">{{
                            myScore.goldEarned
                        }}</span>
                        <span class="my-stat-label">Gold Earned</span>
                    </div>
                </div>
            </div>

            <!-- Full Scoreboard Table -->
            <div class="full-scoreboard panel" v-if="result">
                <div class="panel-title">Final Standings</div>
                <div class="table-wrapper">
                    <table class="scoreboard-table">
                        <thead>
                            <tr>
                                <th class="th-rank">#</th>
                                <th class="th-player">Player</th>
                                <th class="th-score">Score</th>
                                <th class="th-territory">Territory</th>
                                <th class="th-kills">Kills</th>
                                <th class="th-losses">Losses</th>
                                <th class="th-gold">Gold</th>
                                <th class="th-status">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="entry in result.scores"
                                :key="entry.playerId"
                                :class="{
                                    'my-row': entry.playerId === store.playerId,
                                    'dead-row': !entry.alive,
                                    'winner-row': entry.placement === 1,
                                }"
                            >
                                <td class="td-rank">
                                    <span
                                        class="rank-badge"
                                        :class="placementClass(entry.placement)"
                                    >
                                        {{ entry.placement }}
                                    </span>
                                </td>
                                <td class="td-player">
                                    <span class="player-username">{{
                                        entry.username
                                    }}</span>
                                    <span v-if="entry.isBot" class="bot-badge"
                                        >BOT</span
                                    >
                                    <span
                                        v-if="entry.playerId === store.playerId"
                                        class="you-badge"
                                        >YOU</span
                                    >
                                </td>
                                <td class="td-score">
                                    <span class="score-value gold">{{
                                        entry.score
                                    }}</span>
                                </td>
                                <td class="td-stat">
                                    {{ entry.territoryCaptured }}
                                </td>
                                <td class="td-stat">{{ entry.unitsKilled }}</td>
                                <td class="td-stat">{{ entry.unitsLost }}</td>
                                <td class="td-stat">
                                    <span class="gold-value">{{
                                        entry.goldEarned
                                    }}</span>
                                </td>
                                <td class="td-status">
                                    <span
                                        v-if="entry.alive"
                                        class="status-survived"
                                        >Survived</span
                                    >
                                    <span v-else class="status-eliminated"
                                        >Eliminated</span
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Play Again -->
            <div class="actions-section">
                <button
                    class="btn-primary play-again-btn"
                    @click="handlePlayAgain"
                >
                    <span class="btn-icon">⚔️</span>
                    Play Again
                </button>
                <p class="action-hint text-dim">
                    Return to the landing page to join a new match
                </p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.scoreboard-screen {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
}

/* ---- Background Effects ---- */

.scoreboard-bg {
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
}

.bg-grid {
    position: absolute;
    inset: 0;
    background-image:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 60px 60px;
}

.bg-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(140px);
    opacity: 0.1;
}

.bg-glow-1 {
    width: 600px;
    height: 600px;
    background: #ffd700;
    top: -200px;
    left: 50%;
    transform: translateX(-50%);
    animation: float 12s ease-in-out infinite;
}

.bg-glow-2 {
    width: 400px;
    height: 400px;
    background: var(--color-primary);
    bottom: -100px;
    left: -100px;
    animation: float 16s ease-in-out infinite reverse;
}

.bg-glow-3 {
    width: 350px;
    height: 350px;
    background: #3498db;
    bottom: -100px;
    right: -100px;
    animation: float 14s ease-in-out infinite;
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

.scoreboard-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    z-index: 1;
    max-width: 800px;
    width: 100%;
    padding: 40px 24px 60px;
}

/* ---- Result Header ---- */

.result-header {
    text-align: center;
    animation: header-appear 0.6s ease-out;
}

@keyframes header-appear {
    from {
        opacity: 0;
        transform: translateY(-20px) scale(0.95);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.result-icon {
    font-size: 64px;
    margin-bottom: 10px;
}

.result-icon.victory {
    animation: crown-bounce 2s ease-in-out infinite;
}

@keyframes crown-bounce {
    0%,
    100% {
        transform: translateY(0) rotate(0deg);
    }
    25% {
        transform: translateY(-8px) rotate(3deg);
    }
    75% {
        transform: translateY(-4px) rotate(-3deg);
    }
}

.result-icon.podium {
    animation: trophy-shine 3s ease-in-out infinite;
}

@keyframes trophy-shine {
    0%,
    100% {
        filter: brightness(1);
    }
    50% {
        filter: brightness(1.3);
    }
}

.result-title {
    font-size: 48px;
    font-weight: 900;
    letter-spacing: -1px;
    line-height: 1.1;
    margin-bottom: 8px;
}

.victory-title {
    background: linear-gradient(135deg, #ffd700, #ffaa00, #ffd700);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
}

.podium-title {
    background: linear-gradient(135deg, #c0c0c0, #e0e0e0, #c0c0c0);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.defeat-title {
    color: var(--color-text-bright);
}

.result-subtitle {
    font-size: 16px;
    color: var(--color-text-dim);
    font-weight: 400;
    max-width: 400px;
    margin: 0 auto;
    line-height: 1.5;
}

/* ---- Match Summary ---- */

.match-summary {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 16px 32px;
    background: rgba(22, 33, 62, 0.6);
    border-radius: var(--border-radius);
    border: 1px solid var(--color-border);
    animation: summary-appear 0.6s ease-out 0.15s both;
}

@keyframes summary-appear {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.summary-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

.summary-value {
    font-size: 22px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
}

.winner-name {
    font-family: var(--font-main);
    font-size: 18px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.winner-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
}

.summary-label {
    font-size: 11px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.summary-divider {
    width: 1px;
    height: 36px;
    background: var(--color-border);
}

/* ---- My Stats Card ---- */

.my-stats-card {
    width: 100%;
    max-width: 560px;
    padding: 20px 24px;
    animation: stats-appear 0.6s ease-out 0.3s both;
}

@keyframes stats-appear {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.my-stats-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--color-border);
}

.my-placement {
    display: flex;
    align-items: baseline;
    gap: 1px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    justify-content: center;
    flex-shrink: 0;
}

.my-placement.placement-1st {
    background: linear-gradient(
        135deg,
        rgba(255, 215, 0, 0.2),
        rgba(255, 170, 0, 0.2)
    );
    border: 2px solid #ffd700;
}

.my-placement.placement-2nd {
    background: linear-gradient(
        135deg,
        rgba(192, 192, 192, 0.15),
        rgba(160, 160, 160, 0.15)
    );
    border: 2px solid #c0c0c0;
}

.my-placement.placement-3rd {
    background: linear-gradient(
        135deg,
        rgba(205, 127, 50, 0.15),
        rgba(185, 107, 30, 0.15)
    );
    border: 2px solid #cd7f32;
}

.my-placement.placement-other {
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid var(--color-border);
}

.placement-number {
    font-size: 24px;
    font-weight: 900;
    color: var(--color-text-bright);
    font-family: var(--font-mono);
}

.placement-suffix {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-dim);
    margin-bottom: 4px;
}

.my-stats-name {
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.my-username {
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-bright);
}

.my-score-label {
    font-size: 14px;
    color: var(--color-text-dim);
    font-weight: 500;
}

.my-score-label .gold {
    font-weight: 800;
    font-size: 16px;
}

.my-stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
}

.my-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    transition: all 0.2s ease;
}

.my-stat:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.08);
}

.my-stat-icon {
    font-size: 20px;
}

.my-stat-value {
    font-size: 20px;
    font-weight: 800;
    color: var(--color-text-bright);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
}

.my-stat-value.gold {
    color: var(--color-accent);
}

.my-stat-label {
    font-size: 10px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: center;
}

/* ---- Full Scoreboard ---- */

.full-scoreboard {
    width: 100%;
    padding: 16px;
    animation: table-appear 0.6s ease-out 0.45s both;
}

@keyframes table-appear {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.table-wrapper {
    overflow-x: auto;
}

.scoreboard-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px;
}

.scoreboard-table th {
    text-align: left;
    padding: 8px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-dim);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
}

.scoreboard-table td {
    padding: 8px 10px;
    font-size: 13px;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
    white-space: nowrap;
}

.scoreboard-table tr {
    transition: background-color 0.15s ease;
}

.scoreboard-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
}

.scoreboard-table tr.my-row {
    background: rgba(233, 69, 96, 0.08);
}

.scoreboard-table tr.my-row:hover {
    background: rgba(233, 69, 96, 0.12);
}

.scoreboard-table tr.dead-row {
    opacity: 0.6;
}

.scoreboard-table tr.winner-row td {
    border-bottom-color: rgba(255, 215, 0, 0.15);
}

.th-rank {
    width: 44px;
    text-align: center;
}

.th-score,
.th-territory,
.th-kills,
.th-losses,
.th-gold,
.th-status {
    text-align: center;
    width: 75px;
}

.td-rank {
    text-align: center;
}

.rank-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-weight: 800;
    font-size: 12px;
    font-family: var(--font-mono);
}

.rank-badge.placement-1st {
    background: linear-gradient(
        135deg,
        rgba(255, 215, 0, 0.25),
        rgba(255, 170, 0, 0.25)
    );
    color: #ffd700;
    border: 1px solid rgba(255, 215, 0, 0.4);
}

.rank-badge.placement-2nd {
    background: rgba(192, 192, 192, 0.12);
    color: #d0d0d0;
    border: 1px solid rgba(192, 192, 192, 0.3);
}

.rank-badge.placement-3rd {
    background: rgba(205, 127, 50, 0.12);
    color: #cd7f32;
    border: 1px solid rgba(205, 127, 50, 0.3);
}

.rank-badge.placement-other {
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-dim);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.td-player {
    display: flex;
    align-items: center;
    gap: 8px;
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
.td-stat,
.td-status {
    text-align: center;
    font-family: var(--font-mono);
    font-size: 13px;
}

.score-value {
    font-weight: 700;
    font-size: 14px;
}

.gold-value {
    color: var(--color-accent);
}

.status-survived {
    color: var(--color-success);
    font-weight: 600;
    font-size: 11px;
    font-family: var(--font-main);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.status-eliminated {
    color: var(--color-danger);
    font-weight: 600;
    font-size: 11px;
    font-family: var(--font-main);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ---- Actions Section ---- */

.actions-section {
    text-align: center;
    animation: actions-appear 0.6s ease-out 0.6s both;
}

@keyframes actions-appear {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.play-again-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 40px;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.5px;
    box-shadow: 0 4px 24px rgba(233, 69, 96, 0.3);
    transition: all 0.2s ease;
}

.play-again-btn:hover {
    box-shadow: 0 6px 32px rgba(233, 69, 96, 0.45);
    transform: translateY(-2px);
}

.play-again-btn:active {
    transform: translateY(0);
    box-shadow: 0 2px 16px rgba(233, 69, 96, 0.3);
}

.btn-icon {
    font-size: 20px;
}

.action-hint {
    margin-top: 10px;
    font-size: 12px;
}

/* ---- Responsive ---- */

@media (max-width: 700px) {
    .scoreboard-content {
        padding: 28px 16px 48px;
        gap: 22px;
    }

    .result-title {
        font-size: 36px;
    }

    .result-subtitle {
        font-size: 14px;
    }

    .result-icon {
        font-size: 48px;
    }

    .match-summary {
        gap: 16px;
        padding: 12px 20px;
    }

    .summary-value {
        font-size: 18px;
    }

    .my-stats-card {
        padding: 16px;
    }

    .my-stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
    }

    .my-stat-value {
        font-size: 18px;
    }

    .my-placement {
        width: 46px;
        height: 46px;
    }

    .placement-number {
        font-size: 20px;
    }

    .my-username {
        font-size: 17px;
    }

    .full-scoreboard {
        padding: 12px;
    }

    .scoreboard-table th,
    .scoreboard-table td {
        padding: 6px 6px;
        font-size: 11px;
    }

    .play-again-btn {
        padding: 12px 32px;
        font-size: 16px;
    }
}

@media (max-width: 480px) {
    .result-title {
        font-size: 28px;
    }

    .match-summary {
        flex-direction: column;
        gap: 10px;
    }

    .summary-divider {
        width: 60px;
        height: 1px;
    }

    .my-stats-header {
        flex-direction: column;
        text-align: center;
    }

    .my-stats-name {
        align-items: center;
    }

    .winner-name {
        font-size: 16px;
    }

    .th-kills,
    .th-losses,
    .th-gold {
        display: none;
    }

    .td-stat:nth-child(5),
    .td-stat:nth-child(6),
    .td-stat:nth-child(7) {
        display: none;
    }
}
</style>
