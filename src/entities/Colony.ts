import type { PlayerSide } from '../types'
import { AntType } from '../types'
import { Ant } from './Ant'
import { Building } from './Building'
import { MAX_ANTS, START_BASES } from '../config/constants'

type Passable = (col: number, row: number) => boolean

export class Colony {
  readonly side: PlayerSide
  readonly baseCol: number
  readonly baseDepth: number

  ants: Ant[] = []
  buildings: Building[] = []
  resources = { food: 0, materials: 0 }

  workerRatio = 0.7

  constructor(side: PlayerSide, baseIndex: 0 | 1) {
    this.side       = side
    this.baseCol    = START_BASES[baseIndex].col
    this.baseDepth  = START_BASES[baseIndex].depth
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get workerCount():  number { return this.ants.filter(a => a.type === AntType.WORKER).length }
  get warriorCount(): number { return this.ants.filter(a => a.type === AntType.WARRIOR).length }
  get totalAnts():    number { return this.ants.length }

  // ─── Spawning ──────────────────────────────────────────────────────────────

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
      if (effect.foodGain) this.resources.food += effect.foodGain
    }

    for (const ant of this.ants) {
      ant.update(delta, passable)
    }
  }
}
