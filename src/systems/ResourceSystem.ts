import { TileType, AntType, AntState, ResourceType } from '../types'
import type { Colony } from '../entities/Colony'
import type { Building } from '../entities/Building'
import type { Ant } from '../entities/Ant'
import { Resource, RESOURCE_SPECS } from '../entities/Resource'
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  RESOURCE_INITIAL_MIN,
  RESOURCE_INITIAL_MAX,
  RESOURCE_RESPAWN_INTERVAL,
  RESOURCE_RESPAWN_MIN,
  RESOURCE_RESPAWN_MAX,
  RESOURCE_BUILDING_MIN_DIST,
} from '../config/constants'

type Passable = (col: number, row: number) => boolean
type TileGetter = (col: number, row: number) => number

const RESOURCE_TYPES = Object.values(ResourceType)

export class ResourceSystem {
  resources: Resource[] = []
  private lastRespawnAt = 0

  init(now: number, tileAt: TileGetter, allBuildings: Building[]): void {
    this.resources = []
    const count = randInt(RESOURCE_INITIAL_MIN, RESOURCE_INITIAL_MAX)
    this.spawnBatch(count, now, tileAt, allBuildings)
    this.lastRespawnAt = now
  }

  update(
    now: number,
    delta: number,
    tileAt: TileGetter,
    allBuildings: Building[],
    colony: Colony,
    passable: Passable
  ): void {
    if (now - this.lastRespawnAt >= RESOURCE_RESPAWN_INTERVAL) {
      this.spawnBatch(randInt(RESOURCE_RESPAWN_MIN, RESOURCE_RESPAWN_MAX), now, tileAt, allBuildings)
      this.lastRespawnAt = now
    }

    for (const resource of this.resources) {
      resource.updateNeutralization()
      this.assignNeutralizers(resource, colony, passable)
      this.assignWorkers(resource, colony, passable)
      this.handleWorkerProgress(resource, colony, passable, delta)
    }

    const assignedIds = new Set(this.resources.map(r => r.id))
    for (const ant of colony.ants) {
      if (ant.resourceAssignmentId && !assignedIds.has(ant.resourceAssignmentId)) {
        ant.resourceAssignmentId = null
        ant.carryingResource = false
      }
      if (ant.combatAssignmentId && !assignedIds.has(ant.combatAssignmentId)) {
        ant.combatAssignmentId = null
      }
    }

    this.resources = this.resources.filter(r => !r.isExpired(now) && !r.isDepleted())
  }

  private assignNeutralizers(resource: Resource, colony: Colony, passable: Passable): void {
    if (!resource.isDangerous || resource.isNeutralized) return
    const warriors = colony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    const available = warriors.filter(a => !a.combatAssignmentId)
    for (const warrior of available) {
      if (resource.assignedWarriors.size >= resource.requiredWarriors) break
      resource.assignedWarriors.add(warrior.id)
      warrior.combatAssignmentId = resource.id
    }

    for (const warrior of warriors) {
      if (warrior.combatAssignmentId !== resource.id) continue
      this.navigateTowardResource(warrior, resource, passable)
    }
  }

  private assignWorkers(resource: Resource, colony: Colony, passable: Passable): void {
    if (!resource.isNeutralized) return
    const workers = colony.ants.filter(a => a.type === AntType.WORKER && a.state !== AntState.DEAD)
    const available = workers.filter(a => !a.resourceAssignmentId && !a.digTarget)
    for (const worker of available) {
      if (resource.assignedWorkers.size >= resource.requiredWorkers) break
      resource.assignedWorkers.add(worker.id)
      worker.resourceAssignmentId = resource.id
      worker.setBehaviorCooldown(300)
    }
    for (const worker of workers) {
      if (worker.resourceAssignmentId !== resource.id) continue
      if (!worker.carryingResource) this.navigateTowardResource(worker, resource, passable)
    }
  }

  private handleWorkerProgress(resource: Resource, colony: Colony, passable: Passable, delta: number): void {
    if (!resource.isNeutralized) return
    const workers = colony.ants.filter(a => a.resourceAssignmentId === resource.id && a.state !== AntState.DEAD)
    if (workers.length === 0) return

    let onSite = 0
    for (const worker of workers) {
      const standTile = this.closestStandTile(worker, resource, passable)
      if (!standTile) continue
      if (worker.col === standTile.col && worker.row === standTile.row && !worker.carryingResource) {
        onSite++
      }
    }
    if (onSite <= 0) return

    const ticks = Math.max(1, Math.round(delta / 16))
    for (let i = 0; i < ticks; i++) {
      const haul = resource.harvest(onSite)
      if (haul.food <= 0 && haul.materials <= 0) break
      const center = this.getNearestResourceCenter(colony)
      for (const worker of workers) {
        if (center) {
          worker.carryingResource = true
          worker.navigateTo({ col: center.tileX + 1, row: center.tileY + 1 }, passable)
        }
      }
      colony.resources.food += haul.food
      colony.resources.materials += haul.materials
    }

    const center = this.getNearestResourceCenter(colony)
    if (center) {
      for (const worker of workers) {
        if (!worker.carryingResource) continue
        const dropCol = center.tileX + 1
        const dropRow = center.tileY + 1
        if (worker.col === dropCol && worker.row === dropRow) worker.carryingResource = false
      }
    }

    if (resource.isDepleted()) {
      for (const worker of workers) {
        worker.resourceAssignmentId = null
        worker.carryingResource = false
      }
      for (const warrior of colony.ants.filter(a => a.combatAssignmentId === resource.id)) {
        warrior.combatAssignmentId = null
      }
    }
  }

  private navigateTowardResource(ant: Ant, resource: Resource, passable: Passable): void {
    const target = this.closestStandTile(ant, resource, passable)
    if (!target) return
    if (ant.col !== target.col || ant.row !== target.row) {
      ant.navigateTo(target, passable)
    }
  }

  private closestStandTile(ant: Ant, resource: Resource, passable: Passable): { col: number; row: number } | null {
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
        if (opt.col < 0 || opt.col >= MAP_WIDTH || opt.row < 0 || opt.row >= MAP_HEIGHT) continue
        if (!passable(opt.col, opt.row)) continue
        const d = Math.abs(opt.col - ant.col) + Math.abs(opt.row - ant.row)
        if (d < bestDist) {
          best = opt
          bestDist = d
        }
      }
    }
    return best
  }

  private spawnBatch(count: number, now: number, tileAt: TileGetter, allBuildings: Building[]): void {
    for (let i = 0; i < count; i++) {
      const type = RESOURCE_TYPES[Math.floor(Math.random() * RESOURCE_TYPES.length)]
      if (type === ResourceType.MUSHROOM) {
        this.spawnMushroomCluster(now, tileAt, allBuildings)
      } else {
        const resource = this.trySpawnOne(type, now, tileAt, allBuildings)
        if (resource) this.resources.push(resource)
      }
    }
  }

  private spawnMushroomCluster(now: number, tileAt: TileGetter, allBuildings: Building[]): void {
    const anchor = this.pickValidTile(RESOURCE_SPECS[ResourceType.MUSHROOM].size, tileAt, allBuildings)
    if (!anchor) return
    const count = randInt(3, 5)
    const spots = [{ ...anchor }]
    const frontier = [{ ...anchor }]
    while (frontier.length > 0 && spots.length < count) {
      const current = frontier.shift()!
      const nexts = [
        { col: current.col + 1, row: current.row },
        { col: current.col - 1, row: current.row },
        { col: current.col, row: current.row + 1 },
        { col: current.col, row: current.row - 1 },
      ]
      for (const n of nexts) {
        if (spots.length >= count) break
        if (spots.some(s => s.col === n.col && s.row === n.row)) continue
        if (!this.isTileValid(n.col, n.row, 1, tileAt, allBuildings)) continue
        spots.push(n)
        frontier.push(n)
      }
    }
    for (const pos of spots) {
      this.resources.push(new Resource(ResourceType.MUSHROOM, pos, now))
    }
  }

  private trySpawnOne(type: ResourceType, now: number, tileAt: TileGetter, allBuildings: Building[]): Resource | null {
    const spec = RESOURCE_SPECS[type]
    const pos = this.pickValidTile(spec.size, tileAt, allBuildings)
    if (!pos) return null
    const tiles = spec.size === 2 ? [{ ...pos }, { col: pos.col + 1, row: pos.row }] : [{ ...pos }]
    return new Resource(type, pos, now, tiles)
  }

  private pickValidTile(size: 1 | 2, tileAt: TileGetter, allBuildings: Building[]): { col: number; row: number } | null {
    for (let tries = 0; tries < 600; tries++) {
      const col = Math.floor(Math.random() * (MAP_WIDTH - (size === 2 ? 1 : 0)))
      const row = 1 + Math.floor(Math.random() * (MAP_HEIGHT - 1))
      if (!this.isTileValid(col, row, size, tileAt, allBuildings)) continue
      return { col, row }
    }
    return null
  }

  private isTileValid(col: number, row: number, size: 1 | 2, tileAt: TileGetter, allBuildings: Building[]): boolean {
    for (let i = 0; i < size; i++) {
      const c = col + i
      if (c < 0 || c >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return false
      const tile = tileAt(c, row)
      if (tile !== TileType.DIRT && tile !== TileType.TUNNEL) return false
      if (this.resources.some(r => r.tiles.some(t => t.col === c && t.row === row))) return false
      for (const b of allBuildings) {
        const bx = PhaserMath.clamp(c, b.tileX, b.tileX + b.width - 1)
        const by = PhaserMath.clamp(row, b.tileY, b.tileY + b.height - 1)
        const dist = Math.abs(c - bx) + Math.abs(row - by)
        if (dist < RESOURCE_BUILDING_MIN_DIST) return false
      }
    }
    return true
  }

  private getNearestResourceCenter(colony: Colony): Building | null {
    const center = colony.buildings.find(b => b.type === 'RESOURCE_CENTER' && b.isAlive())
    return center ?? null
  }
}

const PhaserMath = {
  clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  },
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}
