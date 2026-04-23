import type { Vec2 } from '../types'
import { ResourceType } from '../types'

let _nextId = 0

type ResourceSpec = {
  food: number
  materials: number
  size: 1 | 2
  threatLevel: 0 | 1 | 2 | 3
  requiredWorkers: number
  requiredWarriors: number
  color: number
}

export const RESOURCE_SPECS: Record<ResourceType, ResourceSpec> = {
  [ResourceType.EARTHWORM]:   { food: 500, materials: 0, size: 1, threatLevel: 0, requiredWorkers: 1, requiredWarriors: 0, color: 0xc78f4e },
  [ResourceType.BEETLE]:      { food: 300, materials: 0, size: 1, threatLevel: 1, requiredWorkers: 1, requiredWarriors: 2, color: 0x6a4a2f },
  [ResourceType.SEED_PILE]:   { food: 200, materials: 0, size: 2, threatLevel: 0, requiredWorkers: 1, requiredWarriors: 0, color: 0xb59a4c },
  [ResourceType.DEAD_INSECT]: { food: 150, materials: 0, size: 1, threatLevel: 0, requiredWorkers: 1, requiredWarriors: 0, color: 0x7b3a2d },
  [ResourceType.MUSHROOM]:    { food: 60, materials: 0,  size: 1, threatLevel: 2, requiredWorkers: 2, requiredWarriors: 2, color: 0xa07ac7 },
  [ResourceType.PEBBLE_CACHE]:{ food: 0,  materials: 50, size: 2, threatLevel: 0, requiredWorkers: 4, requiredWarriors: 0, color: 0x8c8c8c },
  [ResourceType.TWIG_PILE]:   { food: 0,  materials: 30, size: 1, threatLevel: 0, requiredWorkers: 1, requiredWarriors: 0, color: 0x8b5a2b },
  [ResourceType.BRANCH]:      { food: 0,  materials: 80, size: 2, threatLevel: 0, requiredWorkers: 2, requiredWarriors: 0, color: 0x6b4226 },
  [ResourceType.LEAF_PILE]:   { food: 0,  materials: 20, size: 1, threatLevel: 0, requiredWorkers: 1, requiredWarriors: 0, color: 0x4e8b3a },
}

export class Resource {
  readonly id: string
  readonly type: ResourceType
  pos: Vec2
  tiles: Vec2[]
  foodAmount: number
  materialsAmount: number
  threatLevel: 0 | 1 | 2 | 3
  guardianCount: number
  isNeutralized: boolean
  readonly requiredWorkers: number
  readonly requiredWarriors: number
  readonly spawnedAt: number
  readonly expiresAt: number
  assignedWorkers = new Set<string>()
  assignedWarriors = new Set<string>()

  constructor(type: ResourceType, pos: Vec2, spawnedAt: number, tiles?: Vec2[]) {
    const spec = RESOURCE_SPECS[type]
    this.id = `res_${_nextId++}`
    this.type = type
    this.pos = { ...pos }
    this.tiles = tiles ? tiles.map(t => ({ ...t })) : [{ ...pos }]
    this.foodAmount = spec.food
    this.materialsAmount = spec.materials
    this.threatLevel = spec.threatLevel
    this.guardianCount = type === ResourceType.MUSHROOM ? 1 : 0
    this.isNeutralized = this.threatLevel === 0 && this.guardianCount === 0
    this.requiredWorkers = spec.requiredWorkers
    this.requiredWarriors = spec.requiredWarriors
    this.spawnedAt = spawnedAt
    this.expiresAt = Number.MAX_SAFE_INTEGER
  }

  get color(): number {
    return RESOURCE_SPECS[this.type].color
  }

  get isHeavy(): boolean {
    return this.requiredWorkers > 1
  }

  get isDangerous(): boolean {
    return this.threatLevel > 0 || this.guardianCount > 0
  }

  get lifeRatio(): number {
    const span = this.expiresAt - this.spawnedAt
    if (span <= 0) return 0
    return Math.max(0, Math.min(1, 1 - (Date.now() - this.spawnedAt) / span))
  }

  updateNeutralization(): void {
    if (this.requiredWarriors <= 0) {
      this.threatLevel = 0
      this.isNeutralized = this.guardianCount <= 0
      return
    }
    const pressure = this.assignedWarriors.size
    if (pressure >= this.requiredWarriors) {
      this.threatLevel = 0
      this.guardianCount = 0
      this.isNeutralized = true
    }
  }

  harvest(workerCount: number): { food: number; materials: number } {
    if (!this.isNeutralized || workerCount <= 0) return { food: 0, materials: 0 }
    if (workerCount < this.requiredWorkers) return { food: 0, materials: 0 }
    const woodTypes = new Set<ResourceType>([ResourceType.TWIG_PILE, ResourceType.BRANCH, ResourceType.LEAF_PILE])
    const isWood = woodTypes.has(this.type)
    const food = isWood ? 0 : Math.min(this.foodAmount, 10)
    const materials = isWood ? Math.min(this.materialsAmount, 5) : 0
    this.foodAmount -= food
    this.materialsAmount -= materials
    return { food, materials }
  }

  isExpired(now: number): boolean {
    return now >= this.expiresAt
  }

  isDepleted(): boolean {
    return this.foodAmount <= 0 && this.materialsAmount <= 0
  }
}
