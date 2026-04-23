import { AntType, AntState } from '../types'
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../config/constants'

let _nextId = 0

type Passable = (col: number, row: number) => boolean
type TilePos   = { col: number; row: number }
export type PheromoneType = 'FOOD' | 'ATTACK' | 'RALLY'

export class Ant {
  readonly id: string
  readonly type: AntType
  state: AntState

  x: number   // pixel position (smooth movement)
  y: number

  hp: number
  readonly maxHp: number
  readonly speed: number      // px/s
  readonly homePos: TilePos   // warriors guard this; workers home base

  carryingResource = false
  resourceAssignmentId: string | null = null
  combatAssignmentId: string | null = null
  attackMoveTarget: TilePos | null = null
  carryingCorpseId: string | null = null
  netTargetX: number | null = null
  netTargetY: number | null = null
  pheromoneId: string | null = null
  pheromoneType: PheromoneType | null = null
  waitingForTunnel = false
  digTarget: TilePos | null = null   // set by TunnelSystem when assigned a dig task

  private path: TilePos[] = []
  private behaviorTimer = 0

  constructor(type: AntType, startCol: number, startRow: number, homePos: TilePos, forcedId?: string) {
    this.id    = forcedId ?? `ant_${_nextId++}`
    this.type  = type
    this.state = AntState.IDLE
    this.x     = startCol * TILE_SIZE + TILE_SIZE / 2
    this.y     = startRow * TILE_SIZE + TILE_SIZE / 2
    this.homePos = homePos

    if (type === AntType.WORKER) { this.maxHp = 30; this.speed = 60 }
    else                          { this.maxHp = 80; this.speed = 90 }
    this.hp = this.maxHp
  }

  // ─── Tile getters ──────────────────────────────────────────────────────────

  get col(): number { return Math.floor(this.x / TILE_SIZE) }
  get row(): number { return Math.floor(this.y / TILE_SIZE) }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount)
    if (this.hp === 0) this.state = AntState.DEAD
  }

  // ─── Main update ───────────────────────────────────────────────────────────

  update(delta: number, passable: Passable): void {
    if (this.state === AntState.DEAD) return

    this.behaviorTimer -= delta

    if (this.path.length > 0) {
      this.state = AntState.MOVING
      this.stepAlongPath(delta)
    } else {
      this.chooseBehavior(passable)
    }
  }

  // ─── Movement ──────────────────────────────────────────────────────────────

  private stepAlongPath(delta: number): void {
    const next = this.path[0]
    const tx   = next.col * TILE_SIZE + TILE_SIZE / 2
    const ty   = next.row * TILE_SIZE + TILE_SIZE / 2
    const dx   = tx - this.x
    const dy   = ty - this.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const step = this.speed * (delta / 1000)

    if (dist <= step) {
      this.x = tx; this.y = ty
      this.path.shift()
    } else {
      this.x += (dx / dist) * step
      this.y += (dy / dist) * step
    }
  }

  /** Navigate to a tile immediately (used by TunnelSystem / external callers). */
  navigateTo(goal: TilePos, passable: Passable): void {
    this.path = Ant.aStar({ col: this.col, row: this.row }, goal, passable)
  }

  setBehaviorCooldown(ms: number): void {
    this.behaviorTimer = ms
  }

  clearPath(): void {
    this.path = []
  }

  setNetworkTarget(x: number, y: number): void {
    this.netTargetX = x
    this.netTargetY = y
  }

  setPheromoneAssignment(id: string | null, type: PheromoneType | null): void {
    this.pheromoneId = id
    this.pheromoneType = type
  }

  updateNetworkInterpolation(delta: number): void {
    if (this.netTargetX === null || this.netTargetY === null || this.state === AntState.DEAD) return
    const alpha = Math.min(1, delta / 100)
    this.x += (this.netTargetX - this.x) * alpha
    this.y += (this.netTargetY - this.y) * alpha
  }

  // ─── Behaviour AI ──────────────────────────────────────────────────────────

  private chooseBehavior(passable: Passable): void {
    if (this.behaviorTimer > 0) {
      this.state = AntState.IDLE
      return
    }
    if (this.type === AntType.WORKER) this.workerBehavior(passable)
    else                               this.warriorBehavior(passable)
  }

  /**
   * Worker priorities:
   * 1. Dig assigned target (set by TunnelSystem)
   * 2. (carry resource – future prompt)
   * 3. Wander nearby tunnels
   */
  private workerBehavior(passable: Passable): void {
    if (this.pheromoneId) {
      this.state = this.carryingResource ? AntState.CARRYING : AntState.WORKING
      return
    }
    if (this.resourceAssignmentId) {
      this.state = this.carryingResource ? AntState.CARRYING : AntState.WORKING
      return
    }

    if (this.digTarget) {
      // Already adjacent → stay and work
      if (this.adjacentTo(this.digTarget)) {
        this.state = AntState.WORKING
        return
      }
      // Navigate to the tile adjacent to the dig target
      if (this.behaviorTimer <= 0) {
        const workPos = this.adjacentPassable(this.digTarget, passable)
        if (workPos) this.path = Ant.aStar({ col: this.col, row: this.row }, workPos, passable)
        this.behaviorTimer = 600   // retry at most ~twice per second
      }
      return
    }

    // No pheromone/task -> stay idle in nest.
    this.state = AntState.IDLE
    this.behaviorTimer = 250
  }

  /**
   * Warrior priorities:
   * 1. (enemy detection – future prompt)
   * 2. Patrol around homePos
   */
  private warriorBehavior(passable: Passable): void {
    if (this.pheromoneId) {
      this.state = AntState.FIGHTING
      return
    }
    if (this.combatAssignmentId) {
      this.state = AntState.FIGHTING
      return
    }

    if (this.attackMoveTarget) {
      if (Math.abs(this.col - this.attackMoveTarget.col) + Math.abs(this.row - this.attackMoveTarget.row) <= 1) {
        this.attackMoveTarget = null
      } else if (this.behaviorTimer <= 0) {
        this.navigateTo(this.attackMoveTarget, passable)
        this.behaviorTimer = 500
        return
      }
    }

    this.state = AntState.IDLE
    this.behaviorTimer = 250
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private adjacentTo(pos: TilePos): boolean {
    return Math.abs(this.col - pos.col) + Math.abs(this.row - pos.row) === 1
  }

  private adjacentPassable(pos: TilePos, passable: Passable): TilePos | null {
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]] as [number,number][]) {
      const nc = pos.col + dc; const nr = pos.row + dr
      if (passable(nc, nr)) return { col: nc, row: nr }
    }
    return null
  }

  // ─── A* pathfinding ────────────────────────────────────────────────────────

  static aStar(start: TilePos, goal: TilePos, passable: Passable): TilePos[] {
    if (!passable(goal.col, goal.row)) return []
    if (start.col === goal.col && start.row === goal.row) return []

    const key = (c: number, r: number) => c + r * MAP_WIDTH
    const startKey = key(start.col, start.row)
    const goalKey  = key(goal.col,  goal.row)

    const gScore   = new Map<number, number>([[startKey, 0]])
    const fScore   = new Map<number, number>([[startKey, Ant.h(start, goal)]])
    const parentOf = new Map<number, number>()
    const tileOf   = new Map<number, TilePos>([[startKey, start]])
    const openSet  = new Set<number>([startKey])
    const closed   = new Set<number>()

    let iter = 0
    while (openSet.size > 0 && iter++ < 2500) {
      let current = -1; let bestF = Infinity
      for (const k of openSet) {
        const f = fScore.get(k) ?? Infinity
        if (f < bestF) { bestF = f; current = k }
      }

      if (current === goalKey) return Ant.reconstruct(current, startKey, parentOf, tileOf)

      openSet.delete(current); closed.add(current)
      const cur = tileOf.get(current)!
      const g   = gScore.get(current)!

      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]] as [number,number][]) {
        const nc = cur.col + dc; const nr = cur.row + dr
        if (nc < 0 || nc >= MAP_WIDTH || nr < 0 || nr >= MAP_HEIGHT) continue
        if (!passable(nc, nr)) continue
        const nk = key(nc, nr)
        if (closed.has(nk)) continue
        const ng = g + 1
        if (ng < (gScore.get(nk) ?? Infinity)) {
          const nb: TilePos = { col: nc, row: nr }
          parentOf.set(nk, current); gScore.set(nk, ng)
          fScore.set(nk, ng + Ant.h(nb, goal))
          tileOf.set(nk, nb); openSet.add(nk)
        }
      }
    }
    return []
  }

  private static h(a: TilePos, b: TilePos): number {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
  }

  private static reconstruct(
    goalKey: number, startKey: number,
    parentOf: Map<number, number>, tileOf: Map<number, TilePos>
  ): TilePos[] {
    const path: TilePos[] = []
    let k: number | undefined = goalKey
    while (k !== undefined && k !== startKey) { path.unshift(tileOf.get(k)!); k = parentOf.get(k) }
    return path
  }
}
