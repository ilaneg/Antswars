// Tile & Map
export const TILE_SIZE = 32
export const MAP_WIDTH = 160   // tiles
export const MAP_HEIGHT = 80   // tiles

// Ant speeds (pixels per second)
export const ANT_WORKER_SPEED = 60
export const ANT_WARRIOR_SPEED = 90

// Colony limits
export const MAX_ANTS = 200

// Construction
export const TUNNEL_BUILD_TIME_BASE = 3000  // ms per tile, divided by active worker count

// Resources
export const FOOD_PER_CARRY = 10
export const FOOD_WORKER_COST = 50
export const FOOD_WARRIOR_COST = 80
export const RESOURCE_INITIAL_MIN = 15
export const RESOURCE_INITIAL_MAX = 20
export const RESOURCE_RESPAWN_INTERVAL = 45000
export const RESOURCE_RESPAWN_MIN = 2
export const RESOURCE_RESPAWN_MAX = 3
export const RESOURCE_LIFETIME_MS = 120000
export const RESOURCE_BUILDING_MIN_DIST = 15

// Combat
export const WORKER_DAMAGE = 5
export const WARRIOR_DAMAGE = 20
export const ATTACK_RANGE = 1.5   // tiles
export const ATTACK_COOLDOWN = 800 // ms

// Ant HP
export const WORKER_HP = 30
export const WARRIOR_HP = 80

// Tile HP
export const DIRT_HP = 100
export const ROCK_HP = 500

// Spawn
export const EGG_SPAWN_INTERVAL = 8000 // ms per ant from egg chamber
export const SPAWN_FOOD_DRAIN = 50      // food per spawned ant

// Camera
export const CAMERA_SCROLL_SPEED = 400
export const CAMERA_ZOOM_MIN = 0.4
export const CAMERA_ZOOM_MAX = 2.0

// Network
export const TICK_RATE = 20 // ms per game tick (50 tps)

// Canvas
export const CANVAS_WIDTH = 1280
export const CANVAS_HEIGHT = 720
export const BG_COLOR = '#1a0f00'

// Tile colors (flat, no texture)
export const TILE_COLORS = ['#4a7c3f', '#6b3a1f', '#3d3d3d', '#2a1505', '#1a0f00', '#2f1d0d'] // indexed by TileType value

// Starting base positions [col, depth] for each player
export const START_BASES = [
  { col: 10,  depth: 5 },  // Player 1 – left side
  { col: 142, depth: 5 },  // Player 2 – right side
] as const

// Building config: dimensions (tiles), HP, fill color (hex), display label
export const BUILDING_CONFIG: Record<string, {
  width: number; height: number; hp: number; color: number; label: string
}> = {
  EGG_CHAMBER:     { width: 5, height: 4, hp: 200, color: 0x3a6b2a, label: 'Chambre\ndes Œufs' },
  QUEEN_THRONE:    { width: 6, height: 4, hp: 500, color: 0x6a2a8c, label: 'Trône de\nla Reine' },
  RESOURCE_CENTER: { width: 4, height: 3, hp: 150, color: 0x8c5a1a, label: 'Réserves' },
  CEMETERY:        { width: 3, height: 2, hp: 100, color: 0x2a2a3a, label: 'Cimetière' },
  STORAGE:         { width: 3, height: 3, hp: 150, color: 0x5c3317, label: 'Entrepôt\n📦' },
}

// Layout of buildings relative to base (col + dx, depth + dy)
export const BASE_BUILDING_LAYOUT = [
  { type: 'EGG_CHAMBER'     as const, dx: 0, dy: 1 },
  { type: 'QUEEN_THRONE'    as const, dx: 5, dy: 1 },
  { type: 'RESOURCE_CENTER' as const, dx: 0, dy: 6 },
  { type: 'CEMETERY'        as const, dx: 5, dy: 6 },
] as const
