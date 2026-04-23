export enum TileType {
  GRASS  = 0,
  DIRT   = 1,
  ROCK   = 2,
  TUNNEL = 3,
  EMPTY  = 4,
  BUILDING = 5,
}

export enum AntType {
  WORKER  = 'WORKER',
  WARRIOR = 'WARRIOR',
}

export enum AntState {
  IDLE     = 'IDLE',
  MOVING   = 'MOVING',
  WORKING  = 'WORKING',
  FIGHTING = 'FIGHTING',
  CARRYING = 'CARRYING',
  DEAD     = 'DEAD',
}

export enum ResourceType {
  EARTHWORM = 'EARTHWORM',
  BEETLE = 'BEETLE',
  SEED_PILE = 'SEED_PILE',
  DEAD_INSECT = 'DEAD_INSECT',
  MUSHROOM = 'MUSHROOM',
  PEBBLE_CACHE = 'PEBBLE_CACHE',
  TWIG_PILE = 'TWIG_PILE',
  BRANCH = 'BRANCH',
  LEAF_PILE = 'LEAF_PILE',
}

export type BuildingType = 'EGG_CHAMBER' | 'RESOURCE_CENTER' | 'QUEEN_THRONE' | 'CEMETERY' | 'STORAGE'

export type PlayerSide = 'PLAYER1' | 'PLAYER2'

export interface TileData {
  type: TileType
  owner: PlayerSide | null
  hp: number
}

export interface Vec2 {
  col: number
  row: number
}

export interface AntData {
  id: string
  type: AntType
  state: AntState
  pos: Vec2
  target: Vec2 | null
  hp: number
  maxHp: number
  owner: PlayerSide
}

export interface BuildingData {
  id: string
  type: BuildingType
  pos: Vec2
  hp: number
  maxHp: number
  owner: PlayerSide
}

export interface ColonyData {
  side: PlayerSide
  food: number
  ants: AntData[]
  buildings: BuildingData[]
}

export interface GameState {
  tick: number
  map: Uint8Array
  colonies: Record<PlayerSide, ColonyData>
  phase: 'LOBBY' | 'PLAYING' | 'GAMEOVER'
  winner: PlayerSide | null
}

export interface NetworkMessage {
  type: 'SYNC_FULL' | 'INPUT' | 'TICK_ACK' | 'GAME_OVER'
  payload: unknown
  tick: number
}
