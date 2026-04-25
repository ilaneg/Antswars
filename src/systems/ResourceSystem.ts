import { TileType, AntType, AntState, ResourceType } from '../types'
import type { Colony } from '../entities/Colony'
import type { Building } from '../entities/Building'
import type { Ant } from '../entities/Ant'
import { Resource, RESOURCE_SPECS } from '../entities/Resource'
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  START_BASES,
} from '../config/constants'

type Passable = (col: number, row: number) => boolean
type TileGetter = (col: number, row: number) => number

const WOOD_RESOURCE_TYPES_WEIGHTED = [
  ResourceType.LEAF_PILE,
  ResourceType.LEAF_PILE,
  ResourceType.LEAF_PILE,
  ResourceType.LEAF_PILE,
  ResourceType.LEAF_PILE,
  ResourceType.TWIG_PILE,
  ResourceType.TWIG_PILE,
  ResourceType.TWIG_PILE,
  ResourceType.TWIG_PILE,
  ResourceType.BRANCH,
]

const EXTRACTION_TIME_MS = 10_000

export class ResourceSystem {
  resources: Resource[] = []
  private extractionTimers = new Map<string, number>()  // resourceId → startedAt

  init(now: number, tileAt: TileGetter, allBuildings: Building[]): void {
    this.resources = []
    this.spawnExact(ResourceType.EARTHWORM,   30, now, tileAt, allBuildings)
    this.spawnExact(ResourceType.SEED_PILE,   20, now, tileAt, allBuildings)
    this.spawnExact(ResourceType.DEAD_INSECT, 15, now, tileAt, allBuildings)
    this.spawnExact(ResourceType.BEETLE,      10, now, tileAt, allBuildings)
    this.spawnSurfaceWoodBatch(15, now, tileAt)
  }

  update(
    now: number,
    delta: number,
    _tileAt: TileGetter,
    _allBuildings: Building[],
    colony: Colony,
    passable: Passable,
    autoCollect = true
  ): void {
    if (autoCollect) {
      for (const resource of this.resources) {
        resource.updateNeutralization()
        this.assignNeutralizers(resource, colony, passable)
        this.assignWorkers(resource, colony, passable)
        this.handleWorkerProgress(resource, colony, passable, delta, now)
      }
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

    this.resources = this.resources.filter(r => !r.isDepleted())
    for (const id of [...this.extractionTimers.keys()]) {
      if (!assignedIds.has(id)) this.extractionTimers.delete(id)
    }
  }

  private assignNeutralizers(resource: Resource, colony: Colony, passable: Passable): void {
    const livingWarriorIds = new Set(
      colony.ants
        .filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
        .map(a => a.id)
    )
    for (const id of [...resource.assignedWarriors]) {
      if (!livingWarriorIds.has(id)) resource.assignedWarriors.delete(id)
    }
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
    const livingWorkerIds = new Set(
      colony.ants
        .filter(a => a.type === AntType.WORKER && a.state !== AntState.DEAD)
        .map(a => a.id)
    )
    for (const id of [...resource.assignedWorkers]) {
      if (!livingWorkerIds.has(id)) resource.assignedWorkers.delete(id)
    }
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

  private handleWorkerProgress(resource: Resource, colony: Colony, passable: Passable, _delta: number, now: number): void {
    if (!resource.isNeutralized) return
    const workers = colony.ants.filter(a => a.resourceAssignmentId === resource.id && a.state !== AntState.DEAD)
    if (workers.length === 0) { this.extractionTimers.delete(resource.id); return }

    const center = this.getNearestDropoff(colony)

    // Drop-off: workers that arrived at storage reset carry flag
    if (center) {
      const dropCol = center.tileX + 1
      const dropRow = center.tileY + 1
      for (const worker of workers) {
        if (worker.carryingResource && worker.col === dropCol && worker.row === dropRow)
          worker.carryingResource = false
      }
    }

    // Count workers on site (not carrying)
    let onSite = 0
    for (const worker of workers) {
      const stand = this.closestStandTile(worker, resource, passable)
      if (stand && worker.col === stand.col && worker.row === stand.row && !worker.carryingResource) onSite++
    }

    if (onSite >= resource.requiredWorkers) {
      if (!this.extractionTimers.has(resource.id)) this.extractionTimers.set(resource.id, now)
      const elapsed = now - (this.extractionTimers.get(resource.id) ?? now)
      if (elapsed >= EXTRACTION_TIME_MS) {
        const haul = resource.harvest(onSite)
        this.extractionTimers.delete(resource.id)
        if ((haul.food > 0 || haul.materials > 0) && center) {
          colony.addResources(haul.food, haul.materials, now)
          for (const worker of workers) {
            if (!worker.carryingResource) {
              worker.carryingResource = true
              worker.navigateTo({ col: center.tileX + 1, row: center.tileY + 1 }, passable)
            }
          }
        }
      }
    } else {
      this.extractionTimers.delete(resource.id)
    }

    if (resource.isDepleted()) {
      this.extractionTimers.delete(resource.id)
      for (const ant of colony.ants) {
        if (ant.resourceAssignmentId === resource.id) { ant.resourceAssignmentId = null; ant.carryingResource = false }
        if (ant.combatAssignmentId === resource.id) ant.combatAssignmentId = null
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

  private spawnExact(type: ResourceType, count: number, now: number, tileAt: TileGetter, allBuildings: Building[]): void {
    for (let i = 0; i < count; i++) {
      const resource = this.trySpawnOne(type, now, tileAt, allBuildings)
      if (resource) this.resources.push(resource)
    }
  }

  private spawnSurfaceWoodBatch(count: number, now: number, tileAt: TileGetter): void {
    for (let i = 0; i < count; i++) {
      const type = WOOD_RESOURCE_TYPES_WEIGHTED[Math.floor(Math.random() * WOOD_RESOURCE_TYPES_WEIGHTED.length)]
      const spec = RESOURCE_SPECS[type]
      const pos = this.pickValidSurfaceTile(spec.size, tileAt)
      if (!pos) continue
      const tiles = spec.size === 2 ? [{ ...pos }, { col: pos.col + 1, row: pos.row }] : [{ ...pos }]
      this.resources.push(new Resource(type, pos, now, tiles))
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

  private isTileValid(col: number, row: number, size: 1 | 2, tileAt: TileGetter, _allBuildings: Building[]): boolean {
    for (let i = 0; i < size; i++) {
      const c = col + i
      if (c < 0 || c >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return false
      const tile = tileAt(c, row)
      if (tile !== TileType.DIRT && tile !== TileType.TUNNEL) return false
      if (this.resources.some(r => r.tiles.some(t => t.col === c && t.row === row))) return false
      for (const base of START_BASES) {
        const dist = Math.abs(c - base.col) + Math.abs(row - base.depth)
        if (dist < 10) return false
      }
    }
    return true
  }

  private pickValidSurfaceTile(size: 1 | 2, tileAt: TileGetter): { col: number; row: number } | null {
    for (let tries = 0; tries < 500; tries++) {
      const col = Math.floor(Math.random() * (MAP_WIDTH - (size === 2 ? 1 : 0)))
      const row = 0
      let ok = true
      for (let i = 0; i < size; i++) {
        const c = col + i
        if (tileAt(c, row) !== TileType.GRASS) { ok = false; break }
        if (this.resources.some(r => r.tiles.some(t => t.col === c && t.row === row))) { ok = false; break }
        for (const base of START_BASES) {
          const dist = Math.abs(c - base.col) + Math.abs(row - base.depth)
          if (dist < 8) { ok = false; break }
        }
      }
      if (ok) return { col, row }
    }
    return null
  }

  private getNearestDropoff(colony: Colony): Building | null {
    const dropoff = colony.getDropoffBuilding()
    return dropoff ?? null
  }
}

