import type { BuildingType, PlayerSide } from '../types'

let _nextId = 0

export interface BuildingEffect {
  foodGain?: number
}

export class Building {
  readonly id: string
  readonly type: BuildingType
  readonly tileX: number
  readonly tileY: number
  readonly width: number
  readonly height: number
  hp: number
  readonly maxHp: number
  readonly owner: PlayerSide

  constructor(
    type: BuildingType,
    tileX: number, tileY: number,
    width: number, height: number,
    owner: PlayerSide,
    maxHp: number
  ) {
    this.id     = `bld_${_nextId++}`
    this.type   = type
    this.tileX  = tileX
    this.tileY  = tileY
    this.width  = width
    this.height = height
    this.maxHp  = maxHp
    this.hp     = maxHp
    this.owner  = owner
  }

  isAlive(): boolean { return this.hp > 0 }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount)
  }

  update(delta: number, _consumeFood: (amount: number) => boolean): BuildingEffect {
    if (!this.isAlive()) return {}
    return {}
  }
}
