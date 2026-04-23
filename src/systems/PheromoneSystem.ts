import { AntType, AntState, TileType } from '../types'
import type { Ant, PheromoneType } from '../entities/Ant'
import type { Colony } from '../entities/Colony'
import type { ResourceSystem } from './ResourceSystem'
import { Ant as AntEntity } from '../entities/Ant'
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../config/constants'

export type PheroKind = PheromoneType

export interface PheromonePoint {
  id: string
  kind: PheroKind
  col: number
  row: number
}

type Passable = (col: number, row: number) => boolean
type TilePos = { col: number; row: number }

const LIMITS: Record<PheroKind, number> = { FOOD: 5, ATTACK: 3, RALLY: 1 }

let _id = 0

export class PheromoneSystem {
  points: PheromonePoint[] = []
  assignedCounts = new Map<string, number>()
  dashOffset = 0
  mode: PheroKind | null = null
  warningMessage = ''

  private trailPathCache = new Map<string, { fromC: number; fromR: number; toC: number; toR: number; path: TilePos[] }>()

  setMode(mode: PheroKind | null): void { this.mode = mode }

  invalidateTrailCache(): void {
    this.trailPathCache.clear()
  }

  count(kind: PheroKind): number { return this.points.filter(p => p.kind === kind).length }
  limit(kind: PheroKind): number { return LIMITS[kind] }

  addPoint(kind: PheroKind, col: number, row: number): boolean {
    if (kind === 'RALLY') this.points = this.points.filter(p => p.kind !== 'RALLY')
    if (this.count(kind) >= LIMITS[kind]) return false
    this.points.push({ id: `phero_${_id++}`, kind, col, row })
    this.invalidateTrailCache()
    return true
  }

  clearAll(): void {
    this.points = []
    this.assignedCounts.clear()
    this.invalidateTrailCache()
  }

  pointAt(col: number, row: number): PheromonePoint | null {
    return this.points.find(p => Math.abs(p.col - col) <= 1 && Math.abs(p.row - row) <= 1) ?? null
  }

  removePoint(id: string): void {
    this.points = this.points.filter(p => p.id !== id)
    this.assignedCounts.delete(id)
    this.invalidateTrailCache()
  }

  movePoint(id: string, col: number, row: number): void {
    const p = this.points.find(x => x.id === id)
    if (!p) return
    p.col = col
    p.row = row
    this.invalidateTrailCache()
  }

  update(
    delta: number,
    now: number,
    colony: Colony,
    enemyColony: Colony,
    resourceSystem: ResourceSystem,
    passable: Passable
  ): void {
    this.warningMessage = ''
    this.dashOffset = (this.dashOffset + delta * 0.04) % 16
    this.assignedCounts.clear()

    const rally = this.points.find(p => p.kind === 'RALLY')
    const workers = colony.ants.filter(a => a.type === AntType.WORKER && a.state !== AntState.DEAD && !a.digTarget)
    const warriors = colony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    const all = colony.ants.filter(a => a.state !== AntState.DEAD)

    if (rally) {
      this.assignEqually(all, [rally], passable)
      return
    }

    this.assignEqually(workers, this.points.filter(p => p.kind === 'FOOD'), passable)
    this.assignEqually(warriors, this.points.filter(p => p.kind === 'ATTACK'), passable)

    // Apply FOOD behavior loop: gather within 4 tiles and return.
    for (const ant of workers) {
      if (!ant.pheromoneId) continue
      const p = this.points.find(x => x.id === ant.pheromoneId && x.kind === 'FOOD')
      if (!p) continue
      const nearby = resourceSystem.resources.find(r =>
        Math.abs(r.pos.col - p.col) + Math.abs(r.pos.row - p.row) <= 4 && !r.isDepleted()
      )
      if (!nearby) continue
      const stand = this.closestStandTile(nearby, ant, passable)
      if (!stand) continue
      if (!ant.carryingResource) {
        ant.navigateTo(stand, passable)
        if (ant.col === stand.col && ant.row === stand.row) {
          const readyWorkers = workers.filter(w => !w.carryingResource && this.isAtResourceStand(w, nearby, passable)).length
          const haul = nearby.harvest(readyWorkers)
          if (haul.food > 0 || haul.materials > 0) {
            ant.carryingResource = true
            colony.addResources(haul.food, haul.materials, now)
            const center = colony.getDropoffBuilding()
            if (center) ant.navigateTo({ col: center.tileX + 1, row: center.tileY + 1 }, passable)
          }
        }
      } else {
        const center = colony.getDropoffBuilding()
        if (center && ant.col === center.tileX + 1 && ant.row === center.tileY + 1) {
          ant.carryingResource = false
          ant.navigateTo({ col: p.col, row: p.row }, passable)
        }
      }
    }

    // ATTACK hold radius (5 tiles) around pheromone.
    for (const ant of warriors) {
      if (!ant.pheromoneId) continue
      const p = this.points.find(x => x.id === ant.pheromoneId && x.kind === 'ATTACK')
      if (!p) continue
      const enemyNear = enemyColony.ants.find(e =>
        e.state !== AntState.DEAD &&
        Math.hypot(e.col - p.col, e.row - p.row) <= 5
      )
      if (enemyNear) ant.navigateTo({ col: enemyNear.col, row: enemyNear.row }, passable)
    }
  }

  getTrailPath(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    passable: Passable,
    cacheKey?: string
  ): TilePos[] {
    if (cacheKey) {
      const hit = this.trailPathCache.get(cacheKey)
      if (hit && hit.fromC === fromCol && hit.fromR === fromRow && hit.toC === toCol && hit.toR === toRow) return hit.path
    }
    const path = AntEntity.aStar({ col: fromCol, row: fromRow }, { col: toCol, row: toRow }, passable)
    if (cacheKey) this.trailPathCache.set(cacheKey, { fromC: fromCol, fromR: fromRow, toC: toCol, toR: toRow, path })
    return path
  }

  private assignEqually(ants: Ant[], points: PheromonePoint[], passable: Passable): void {
    if (points.length === 0) {
      for (const ant of ants) ant.setPheromoneAssignment(null, null)
      return
    }
    const sorted = [...ants].sort((a, b) => a.id.localeCompare(b.id))
    for (let i = 0; i < sorted.length; i++) {
      const p = points[i % points.length]
      const ant = sorted[i]
      const sameTarget =
        ant.pheromoneId === p.id &&
        ant.pheromoneGoalCol === p.col &&
        ant.pheromoneGoalRow === p.row

      ant.setPheromoneAssignment(p.id, p.kind)
      ant.pheromoneGoalCol = p.col
      ant.pheromoneGoalRow = p.row
      this.assignedCounts.set(p.id, (this.assignedCounts.get(p.id) ?? 0) + 1)

      if (sameTarget && ant.path.length > 0) continue
      if (sameTarget && ant.col === p.col && ant.row === p.row) continue

      const path = AntEntity.aStar({ col: ant.col, row: ant.row }, { col: p.col, row: p.row }, passable)
      if (path.length === 0 && (ant.col !== p.col || ant.row !== p.row)) {
        ant.waitingForTunnel = true
        ant.clearPath()
        this.warningMessage = 'Aucun tunnel vers ce point — creusez d\'abord'
      } else {
        ant.waitingForTunnel = false
        ant.navigateTo({ col: p.col, row: p.row }, passable)
      }
    }
  }

  private closestStandTile(
    resource: { tiles: { col: number; row: number }[] },
    ant: Ant,
    passable: Passable
  ): { col: number; row: number } | null {
    let best: { col: number; row: number } | null = null
    let bestDist = Infinity
    for (const tile of resource.tiles) {
      const options = [
        { col: tile.col, row: tile.row },
        { col: tile.col + 1, row: tile.row },
        { col: tile.col - 1, row: tile.row },
        { col: tile.col, row: tile.row + 1 },
        { col: tile.col, row: tile.row - 1 },
      ]
      for (const opt of options) {
        if (!validTile(opt.col, opt.row) || !passable(opt.col, opt.row)) continue
        const d = Math.abs(opt.col - ant.col) + Math.abs(opt.row - ant.row)
        if (d < bestDist) {
          bestDist = d
          best = opt
        }
      }
    }
    return best
  }

  private isAtResourceStand(
    ant: Ant,
    resource: { tiles: { col: number; row: number }[] },
    passable: Passable
  ): boolean {
    const stand = this.closestStandTile(resource, ant, passable)
    return !!stand && ant.col === stand.col && ant.row === stand.row
  }
}

export function pheroColor(kind: PheroKind): number {
  if (kind === 'FOOD') return 0x4CAF50
  if (kind === 'ATTACK') return 0xF44336
  return 0xFFC107
}

export function pheroRadiusTiles(kind: PheroKind): number {
  if (kind === 'FOOD') return 4
  if (kind === 'ATTACK') return 5
  return 0
}

export function pheroIcon(kind: PheroKind): string {
  if (kind === 'FOOD') return '❧'
  if (kind === 'ATTACK') return '⚔'
  return '⬇'
}

export function tileToWorld(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 }
}

export function validTile(col: number, row: number): boolean {
  return col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT
}

export function canStand(tile: number): boolean {
  return tile === TileType.TUNNEL || tile === TileType.GRASS
}
