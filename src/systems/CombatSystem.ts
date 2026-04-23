import type { Building } from '../entities/Building'
import type { Ant } from '../entities/Ant'
import { AntType, AntState } from '../types'
import { ATTACK_COOLDOWN, TILE_SIZE } from '../config/constants'

// enemyAnts and enemyBuildings are already pre-filtered to the opposing side,
// so no owner check is needed here.
interface Attackable {
  x: number
  y: number
  isBuilding: boolean
  takeDamage(amount: number): void
  isDead(): boolean
  antRef?: Ant
}

export class CombatSystem {
  private lastAttack = new Map<string, number>()
  static readonly CONTACT_RADIUS_PX = 20

  resolve(
    ants: Ant[],
    enemyAnts: Ant[],
    enemyBuildings: Building[],
    now: number,
    onHit: (x: number, y: number) => void
  ): Ant[] {
    const killed: Ant[] = []

    for (const ant of ants) {
      if (ant.state === AntState.DEAD || ant.type !== AntType.WARRIOR) continue

      const cooldownEnd = (this.lastAttack.get(ant.id) ?? 0) + ATTACK_COOLDOWN
      if (now < cooldownEnd) continue

      const targets: Attackable[] = [
        ...enemyAnts.filter(a => a.state !== AntState.DEAD).map((a) => ({
          x: a.x, y: a.y, isBuilding: false, antRef: a,
          isDead: () => a.state === AntState.DEAD,
          takeDamage: (d: number) => a.takeDamage(d),
        })),
        ...enemyBuildings.filter(b => b.isAlive()).map(b => ({
          x: (b.tileX + b.width / 2) * TILE_SIZE, y: (b.tileY + b.height / 2) * TILE_SIZE,
          isBuilding: true,
          isDead: () => !b.isAlive(),
          takeDamage: (d: number) => b.takeDamage(d),
        })),
      ]

      const nearest = this.findNearest(ant, targets)
      if (!nearest) continue

      if (this.pixelDist(ant, nearest) <= CombatSystem.CONTACT_RADIUS_PX) {
        const dmg = nearest.isBuilding
          ? 5
          : (nearest.antRef?.type === AntType.WARRIOR ? 15 : 25)
        nearest.takeDamage(dmg)
        this.lastAttack.set(ant.id, now)
        onHit(nearest.x, nearest.y)
        if (!nearest.isBuilding && nearest.antRef && nearest.antRef.state === AntState.DEAD) {
          killed.push(nearest.antRef)
        }
      }
    }
    return killed
  }

  private findNearest(from: { x: number; y: number }, targets: Attackable[]): Attackable | null {
    let best: Attackable | null = null
    let bestD = Infinity
    for (const t of targets) {
      const d = this.pixelDist(from, t)
      if (d < bestD) { bestD = d; best = t }
    }
    return best
  }

  private pixelDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  }
}
