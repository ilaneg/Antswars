import type { BuildingType, PlayerSide } from '../types'
import { AntType } from '../types'
import { Ant } from './Ant'
import { Building } from './Building'
import { BUILDING_CONFIG, MAX_ANTS, START_BASES } from '../config/constants'

type Passable = (col: number, row: number) => boolean

export class Colony {
  readonly side: PlayerSide
  readonly baseCol: number
  readonly baseDepth: number

  ants: Ant[] = []
  buildings: Building[] = []
  resources = { food: 0, wood: 0 }
  private storageFullWarnUntil = 0
  private nextStorageFullWarnAt = 0
  /** Si défini (mode BETA), remplace les plafonds nourriture / bois calculés par les entrepôts. */
  private sandboxResourceCaps: { food: number; wood: number } | null = null

  workerRatio = 0.8

  constructor(side: PlayerSide, baseIndex: 0 | 1) {
    this.side       = side
    this.baseCol    = START_BASES[baseIndex].col
    this.baseDepth  = START_BASES[baseIndex].depth
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get workerCount():  number { return this.ants.filter(a => a.type === AntType.WORKER).length }
  get warriorCount(): number { return this.ants.filter(a => a.type === AntType.WARRIOR).length }
  get totalAnts():    number { return this.ants.length }

  get storageCount(): number { return this.buildings.filter(b => b.type === 'STORAGE' && b.isAlive()).length }
  get maxFood(): number {
    return this.sandboxResourceCaps?.food ?? (100 + (this.storageCount * 500))
  }
  get maxWood(): number {
    return this.sandboxResourceCaps?.wood ?? (20 + (this.storageCount * 100))
  }

  /** Plafonds fixes pour tester (beaucoup de ressources sans construire d’entrepôts). */
  enableSandboxResourceCaps(maxFood: number, maxWood: number): void {
    this.sandboxResourceCaps = { food: maxFood, wood: maxWood }
  }

  // ─── Spawning ──────────────────────────────────────────────────────────────

  initColony(): void {
    const throneCfg = BUILDING_CONFIG.QUEEN_THRONE
    const queenThrone = new Building(
      'QUEEN_THRONE',
      this.baseCol + 5,
      this.baseDepth + 1,
      throneCfg.width,
      throneCfg.height,
      this.side,
      throneCfg.hp
    )
    this.addBuilding(queenThrone)

    for (let i = 0; i < 4; i++) this.spawnAnt(AntType.WORKER)
    this.spawnAnt(AntType.WARRIOR)
  }

  spawnAnt(type: AntType, forcedId?: string): Ant | null {
    if (this.ants.length >= MAX_ANTS) return null
    const shaftCol  = this.baseCol + 3
    const guardPost = { col: shaftCol, row: 2 }
    const ant = new Ant(type, shaftCol, this.baseDepth, guardPost, forcedId)
    this.ants.push(ant)
    return ant
  }

  nextSpawnType(): AntType {
    if (this.totalAnts === 0) return AntType.WORKER
    const currentWorkerRatio = this.workerCount / this.totalAnts
    return currentWorkerRatio < this.workerRatio ? AntType.WORKER : AntType.WARRIOR
  }

  // ─── Ratio control ─────────────────────────────────────────────────────────

  updateRatio(workerPercent: number): void {
    this.workerRatio = Math.max(0, Math.min(100, workerPercent)) / 100
  }

  // ─── Buildings ─────────────────────────────────────────────────────────────

  addBuilding(building: Building): void {
    this.buildings.push(building)
  }

  getQueenThrone(): Building | undefined {
    return this.buildings.find(b => b.type === 'QUEEN_THRONE')
  }

  getDropoffBuilding(): Building | undefined {
    return this.buildings.find(b => b.type === 'STORAGE' && b.isAlive())
      ?? this.buildings.find(b => b.type === 'RESOURCE_CENTER' && b.isAlive())
      ?? this.buildings.find(b => b.type === 'QUEEN_THRONE' && b.isAlive())
  }

  addResources(food: number, wood: number, now: number): void {
    const foodIn = Math.max(0, food)
    const woodIn = Math.max(0, wood)
    const foodOverflow = this.resources.food + foodIn > this.maxFood
    const woodOverflow = this.resources.wood + woodIn > this.maxWood
    this.resources.food = Math.min(this.maxFood, this.resources.food + foodIn)
    this.resources.wood = Math.min(this.maxWood, this.resources.wood + woodIn)
    if ((foodOverflow || woodOverflow) && now >= this.nextStorageFullWarnAt) {
      this.storageFullWarnUntil = now + 3000
      this.nextStorageFullWarnAt = now + 10000
    }
  }

  getStorageWarning(now: number): string {
    return now <= this.storageFullWarnUntil ? 'Stockage plein !' : ''
  }

  canPlaceBuilding(type: BuildingType, tileX: number, tileY: number, passable: Passable): boolean {
    if (type !== 'STORAGE') return false
    const cfg = BUILDING_CONFIG.STORAGE
    for (let y = tileY; y < tileY + cfg.height; y++) {
      for (let x = tileX; x < tileX + cfg.width; x++) {
        if (!passable(x, y)) return false
        if (this.buildings.some(b => x >= b.tileX && x < b.tileX + b.width && y >= b.tileY && y < b.tileY + b.height)) return false
      }
    }
    return true
  }

  /** Returns 1.2 if queen throne is alive (warriors get +20% attack), else 1.0 */
  getThroneBuff(): number {
    return this.getQueenThrone()?.isAlive() ? 1.2 : 1.0
  }

  isDefeated(): boolean {
    const throne = this.getQueenThrone()
    return !throne || throne.hp <= 0
  }

  // ─── Game loop ─────────────────────────────────────────────────────────────

  update(delta: number, passable: Passable): void {
    for (const building of this.buildings) {
      const effect = building.update(delta, (amount) => {
        if (this.resources.food < amount) return false
        this.resources.food -= amount
        return true
      })
      if (effect.foodGain) this.resources.food = Math.min(this.maxFood, this.resources.food + effect.foodGain)
    }

    for (const ant of this.ants) {
      ant.update(delta, passable)
    }
  }
}
