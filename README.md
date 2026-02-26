# ⚔️ Fractured Crowns

**Real-Time Multiplayer Browser Strategy Game**

Fractured Crowns is a 20–30 minute real-time multiplayer strategy game where up to 20 players compete for dominance on a procedurally generated map. Players expand territory, capture gold mines, build structures, train armies, and wage war — all in real-time through the browser.

No accounts required. No database. Just enter a username and play.

---

## 🎮 Gameplay Overview

### Match Flow

1. **Landing Page** — Enter a username and click "Play"
2. **Matchmaking Queue** — Wait for players (3-minute countdown or instant at 20 players)
3. **Spawn Selection** — Choose your starting position on the procedural map (15 seconds)
4. **Real-Time Gameplay** — Expand, build, train, fight (up to 25 minutes)
5. **Scoreboard** — Match results and stats

### Core Mechanics

| System | Description |
|--------|-------------|
| **Territory** | Capture neutral/enemy tiles by moving units onto them |
| **Economy** | Gold mines generate income; territory generates passive gold |
| **Expansion Penalty** | Income multiplier decreases as territory grows: `1 / (1 + (tiles/50)^1.2)` |
| **Supply Lines** | Territory disconnected from your castle becomes inactive (flood-fill from capital each tick) |
| **Buildings** | Castle, Barracks, Wall, Tower, Mine Upgrade, Road |
| **Units** | Militia, Soldier, Knight, Archer, Siege Ram — organized in squads |
| **Combat** | Automatic when opposing squads overlap; towers auto-fire at enemies in range |
| **Fog of War** | Limited visibility around owned territory and units |
| **Bots** | AI opponents fill empty slots with behavior-tree-style decision making |

### Unit Stats

| Unit | HP | Damage | Speed | Cost | Range | Train Time |
|------|----|--------|-------|------|-------|------------|
| Militia | 40 | 5 | 2.5 | 20g | 1 | 3s |
| Soldier | 70 | 10 | 2.0 | 50g | 1 | 5s |
| Knight | 120 | 18 | 3.0 | 120g | 1 | 8s |
| Archer | 35 | 12 | 2.0 | 60g | 4 | 5s |
| Siege Ram | 200 | 40 | 1.0 | 200g | 1 | 12s |

### Building Costs

| Structure | Cost | HP | Special |
|-----------|------|----|---------|
| Barracks | 150g | 200 | 30% faster unit training |
| Wall | 40g | 300 | Blocks movement |
| Tower | 100g | 150 | Auto-attacks enemies (range 3) |
| Mine Upgrade | 200g | 100 | +5 gold/sec per level |
| Road | 15g | 30 | 50% movement bonus |

### Win Conditions

- **Last one standing** — All other players eliminated (castle destroyed)
- **Timer expires** — Highest score wins after 25 minutes

---

## 🏗️ Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 20+, TypeScript, Express, Socket.IO |
| **Frontend** | Vue 3, Vite, TypeScript, Canvas 2D, Pinia |
| **Networking** | WebSocket (Socket.IO) with server-authoritative model |
| **Infrastructure** | Docker, Docker Compose, nginx |
| **Database** | None — all state in memory |

### Server Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Express + Socket.IO                     │
│                      (server.ts)                          │
├──────────────┬──────────────┬────────────────────────────┤
│ SocketHandler│ LobbyManager │       GameManager           │
│  (network)   │   (queue)    │    (match lifecycle)        │
├──────────────┴──────────────┼────────────────────────────┤
│                              │         Match              │
│                              │    (game simulation)       │
│                              ├────────────────────────────┤
│                              │ MapGenerator │ SpatialHash  │
│                              │ BotAI        │ Pathfinding  │
│                              │ Economy      │ Combat       │
│                              │ Territory    │ Supply Lines │
└──────────────────────────────┴────────────────────────────┘
```

### Simulation Loop (15 ticks/sec)

```
tick() {
  1. processPlayerCommands()   // Validate and apply player inputs
  2. runBots()                 // Bot AI decision-making
  3. updateTraining()          // Process unit training queues
  4. updateUnitMovement()      // A* pathfinding, squad movement
  5. resolveCombat()           // Squad vs squad damage resolution
  6. updateTowers()            // Tower auto-attacks
  7. updateTerritory()         // Tile capture progress
  8. updateSupplyLines()       // Flood-fill connectivity (throttled)
  9. calculateEconomy()        // Gold income with expansion penalty
  10. updateScores()           // Score calculation
  11. checkEndConditions()     // Win/loss checks
  12. broadcastState()         // Send visible state to each player
}
```

### Client Architecture

```
┌──────────────────────────────────────────┐
│                Vue 3 App                  │
├──────────────┬───────────────────────────┤
│   Views      │   Pinia Store (gameStore) │
│  • Landing   │   • App state             │
│  • Lobby     │   • Game state            │
│  • Spawn     │   • Selection             │
│  • Game      │   • Camera                │
│  • Scoreboard│   • Commands              │
├──────────────┼───────────────────────────┤
│ Canvas       │   Socket.IO Client        │
│ Renderer     │   (network/socket.ts)     │
│ • Map tiles  │   • Queue management      │
│ • Squads     │   • Command sending       │
│ • Buildings  │   • State receiving       │
│ • Fog of war │   • Reconnection          │
│ • Minimap    │                           │
│ • Selection  │                           │
└──────────────┴───────────────────────────┘
```

### Network Model

- **Server authoritative** — all game logic runs on the server
- **Clients send commands only** — move, build, train, spawn selection
- **Server broadcasts state snapshots** — visible tiles, squads, economy per player
- **Interest management** — each player only receives data within their fog-of-war visibility
- **Spatial hashing** — efficient collision/proximity queries for combat resolution

---

## 📁 Project Structure

```
FracturedCrowns/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Entry point (Express + Socket.IO)
│   │   ├── types/
│   │   │   └── game.ts            # Shared type definitions
│   │   ├── game/
│   │   │   ├── Match.ts           # Core game simulation engine
│   │   │   ├── GameManager.ts     # Match lifecycle management
│   │   │   ├── MapGenerator.ts    # Procedural map generation + A* pathfinding
│   │   │   ├── SpatialHash.ts     # Spatial partitioning for entity lookups
│   │   │   └── BotAI.ts           # Bot behavior tree AI
│   │   ├── lobby/
│   │   │   └── LobbyManager.ts    # Matchmaking queue system
│   │   └── network/
│   │       └── SocketHandler.ts   # Socket.IO event handling
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── main.ts                # Vue app entry point
│   │   ├── App.vue                # Root component + global styles
│   │   ├── types/
│   │   │   └── game.ts            # Client-side type definitions
│   │   ├── network/
│   │   │   └── socket.ts          # Socket.IO client wrapper
│   │   ├── stores/
│   │   │   └── gameStore.ts       # Pinia state management
│   │   ├── game/
│   │   │   └── Renderer.ts        # Canvas 2D game renderer
│   │   ├── views/
│   │   │   ├── LandingPage.vue    # Username input + join
│   │   │   ├── LobbyScreen.vue    # Queue countdown
│   │   │   ├── SpawnSelection.vue # Map + spawn picker
│   │   │   ├── GameScreen.vue     # Main game HUD
│   │   │   └── ScoreboardScreen.vue # Match results
│   │   └── components/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vite.config.ts
│   └── package.json
│
├── docker-compose.dev.yml         # Development (hot reload)
├── docker-compose.prod.yml        # Production (nginx + optimized)
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** and **npm** (for local development)
- **Docker** and **Docker Compose** (for containerized deployment)

### Option 1: Local Development (without Docker)

```bash
# Clone the repository
git clone <repo-url>
cd FracturedCrowns

# Install and start backend
cd backend
npm install
npm run dev
# Backend runs on http://localhost:3000

# In a new terminal — install and start frontend
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

### Option 2: Docker Development (hot reload)

```bash
cd FracturedCrowns

# Start both services with hot reload
docker compose -f docker-compose.dev.yml up --build

# Frontend: http://localhost:5173
# Backend:  http://localhost:3000
# Health:   http://localhost:3000/api/health
```

### Option 3: Docker Production

```bash
cd FracturedCrowns

# Build and start production containers
docker compose -f docker-compose.prod.yml up --build -d

# App served at http://localhost:80
# API proxied through nginx to backend
# WebSocket proxied through nginx to backend
```

### Verify It's Running

```bash
# Check backend health
curl http://localhost:3000/api/health

# Check server stats
curl http://localhost:3000/api/stats

# Check game info
curl http://localhost:3000/api/info
```

---

## 🎮 How to Play

### Controls

| Input | Action |
|-------|--------|
| **Left Click** | Select squad / Select building / Place structure |
| **Right Click** | Move selected squads / Attack-move |
| **Click + Drag** | Box select multiple squads |
| **Shift + Click** | Add squad to selection |
| **Scroll Wheel** | Zoom in/out |
| **Middle Mouse Drag** | Pan camera |
| **WASD / Arrow Keys** | Move camera |
| **Escape** | Cancel build mode / Deselect |
| **Tab** | Toggle scoreboard |
| **L** | Toggle event log |
| **1–5** | Train unit (when building selected) |
| **B** | Build Barracks shortcut |
| **T** | Build Tower shortcut |

### Strategy Tips

1. **Capture mines early** — Gold mines are your primary income source
2. **Don't over-expand** — The expansion penalty formula severely reduces income for large territories
3. **Protect your supply lines** — Disconnected territory becomes useless
4. **Build barracks** — They train units 30% faster than your castle
5. **Use towers defensively** — They auto-fire at enemies within range 3
6. **Siege rams** — 3x damage against structures; essential for taking castles
7. **Archers** — Range 4 lets them attack without being hit by melee units
8. **Roads** — 50% movement speed bonus; build them between your castle and front lines
9. **Cut supply lines** — Capturing tiles between an enemy's castle and their territory disables everything

---

## 🤖 Bot AI

Bots use a behavior-tree-style AI with the following states:

| State | Trigger | Behavior |
|-------|---------|----------|
| **Defending** | Enemy squads near capital | Rally all forces to capital, build towers |
| **Attacking** | 12+ units, enough gold, cooldown expired | Send army toward weakest neighbor's capital |
| **Training** | Fewer than 6 total units | Queue units at production buildings |
| **Expanding** | Uncaptured mines nearby | Send squads toward nearest unowned mine |
| **Building** | Excess gold | Upgrade mines, build barracks, place walls on borders |

Bots also run opportunistic training and building regardless of their primary state, ensuring they're always producing units and improving their base when gold permits.

---

## 🔧 Configuration

Key game constants are defined in `backend/src/types/game.ts`:

```typescript
// Match settings
MAX_PLAYERS: 20
MAP_WIDTH: 120
MAP_HEIGHT: 120
TICK_RATE: 15          // ticks per second
SPAWN_PHASE_DURATION: 15  // seconds
MATCH_DURATION: 25 * 60   // 25 minutes
MIN_SPAWN_DISTANCE: 20    // tiles between spawns
FOG_OF_WAR_RADIUS: 8

// Queue settings
QUEUE_WAIT_TIME: 180   // 3 minutes max queue wait
QUEUE_MIN_PLAYERS: 2   // minimum to start (bots fill the rest)

// Economy
BASE_MINE_INCOME: 10   // gold/sec per mine
MINE_UPGRADE_BONUS: 5  // additional gold per upgrade level
PASSIVE_TERRITORY_INCOME: 0.2  // gold per tile per second
STARTING_GOLD: 300
EXPANSION_PENALTY_DIVISOR: 50
EXPANSION_PENALTY_EXPONENT: 1.2
```

To modify these, edit the constants and restart the server. No database migrations needed since everything is in-memory.

---

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check (uptime, memory) |
| `/api/stats` | GET | Game statistics (active matches, players, queue) |
| `/api/info` | GET | Game information and feature list |

---

## 🔌 WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join_queue` | `{ username: string }` | Join matchmaking queue |
| `leave_queue` | — | Leave the queue |
| `game_command` | `{ command: GameCommand }` | Send a game command |
| `request_map` | — | Request full map terrain data |
| `ping` | callback | Measure latency |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `queue_joined` | `{ playerId, lobbyState }` | Queue join confirmation |
| `lobby_update` | `LobbyState` | Queue/lobby status update |
| `match_starting` | `{ matchId, playerId }` | Match is beginning |
| `phase_change` | `{ matchId, phase, data }` | Game phase transition |
| `game_state` | `GameStateSnapshot` | Per-tick game state (filtered by fog of war) |
| `match_ended` | `MatchResult` | Final match results |
| `map_data` | `{ width, height, terrain }` | Full map terrain for spawn selection |
| `error` | `{ message, code }` | Error notification |
| `server_info` | `ServerInfo` | Periodic server status |

---

## 🏛️ Design Decisions

### Why No Database?

Fractured Crowns is designed for session-based gameplay with no persistence. All match state lives in RAM and is garbage collected when matches end. This keeps the architecture simple, fast, and horizontally scalable — each server instance is completely independent.

### Why Server-Authoritative?

In a competitive strategy game, client-authoritative networking would enable trivial cheating. The server validates every command, runs all simulation logic, and only sends each player the state they should be able to see (fog of war filtering).

### Why Canvas 2D Instead of WebGL/PixiJS?

For a tile-based strategy game at this scale (120x120 map), Canvas 2D provides excellent performance without the complexity of WebGL shaders or a rendering framework. The renderer is ~1100 lines of straightforward drawing code that's easy to maintain and debug.

### Why Squads Instead of Individual Units?

Grouping units into squads dramatically reduces the number of entities the server needs to simulate and the network needs to synchronize. Instead of tracking thousands of individual unit positions, we track dozens of squad positions with unit composition metadata.

### Why Spatial Hashing?

Combat resolution requires finding nearby enemy units efficiently. A spatial hash grid provides O(1) average-case lookups for entities within a radius, compared to O(n) brute force. This is critical when running 15 ticks/second with potentially hundreds of squads.

---

## 📜 License

This project is provided as-is for educational and entertainment purposes.