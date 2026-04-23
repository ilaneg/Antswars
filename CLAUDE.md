# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ants Wars** — 2D real-time strategy game about ant colonies. Two players compete to destroy the enemy queen's throne. The map is a diggable underground grid (Terraria-style). Each player manages workers (dig tunnels, collect resources) and warriors (combat).

No build step, no framework, no package manager. Open `index.html` directly in a browser or serve locally.

## Running the Game

```bash
# Option 1: Python simple server (if Python is installed)
python -m http.server 8080
# then open http://localhost:8080

# Option 2: Open index.html directly in the browser (file://)
# Note: PeerJS P2P works on file:// for local testing but requires a server for cross-machine play
```

## Tech Stack

- **Rendering**: HTML5 Canvas 2D API (no game engine, no framework)
- **Multiplayer**: [PeerJS](https://peerjs.com/) via CDN — WebRTC P2P, no dedicated server
- **Language**: Vanilla JavaScript (ES6 modules)
- **No dependencies to install** — all loaded via CDN in `index.html`

## Architecture

### Game Loop (`src/main.js`)
Fixed-timestep update loop (`requestAnimationFrame`). Separates update (game logic) from render (canvas draw). Owns the top-level state machine: `MENU → LOBBY → PLAYING → GAMEOVER`.

### Map System (`src/map.js`)
Grid of cells, each with a `type` (GRASS, DIRT, ROCK, TUNNEL, VOID) and owner. Digging changes DIRT → TUNNEL. The surface row is always GRASS. Serializes to a flat `Uint8Array` for network sync.

### Colony & Ants (`src/colony.js`, `src/ant.js`)
Each player owns one `Colony`. Ants are entities with a `role` (WORKER | WARRIOR) and a `task` (IDLE, DIG, CARRY, ATTACK, PATROL). Workers use A* pathfinding to reach dig targets or resource drops. Warriors path toward enemies.

### Buildings (`src/buildings.js`)
Placed inside TUNNEL cells. Types: `EGG_CHAMBER` (spawns ants), `RESOURCE_CENTER` (stores food), `QUEEN_THRONE` (win condition — destroy the enemy's). Each building has HP.

### Renderer (`src/renderer.js`)
Stateless — takes world state, draws to canvas. Camera is a viewport offset (scroll + zoom). Draws map cells first, then buildings, then ants, then HUD overlay.

### Networking (`src/network.js`)
PeerJS wrapper. One player hosts (gets a Peer ID = room code), the other connects using that code. After connection, both peers exchange a full state snapshot on join, then send delta updates each tick (input commands, not full state). Host is authoritative for conflict resolution.

### UI (`src/ui.js`)
Manages HTML overlays (lobby screen, room code display, HUD). Game canvas is always rendered behind. UI events dispatch into the game loop via an event queue.

## Multiplayer Protocol

All messages are JSON: `{ type: string, payload: any, tick: number }`.

| type | direction | payload |
|------|-----------|---------|
| `SYNC_FULL` | host→guest on join | full serialized world |
| `INPUT` | both→both each tick | player commands (dig, place, assign) |
| `TICK_ACK` | both | confirms tick number for lockstep |
| `GAME_OVER` | host→guest | winner id |

## Key Constraints

- **Authoritative host**: the hosting player resolves conflicts; guest sends inputs, host confirms.
- **Grid coordinates**: all positions are `{col, row}` integers, never pixel floats, except for rendering interpolation.
- **No accounts, no server**: PeerJS signaling server is only used for initial WebRTC handshake; all game data is direct P2P.
