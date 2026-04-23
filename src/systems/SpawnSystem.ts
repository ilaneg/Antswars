import type { Colony } from '../entities/Colony'
import { AntType } from '../types'
import { EGG_SPAWN_INTERVAL, SPAWN_FOOD_DRAIN } from '../config/constants'

export class SpawnSystem {
  private incubating = new Map<string, { startedAt: number; type: AntType }>()
  private warningUntil = new Map<string, number>()
  private aiRecovering = new Set<string>()

  /** Called each tick — egg chamber starts incubation only if food cost is paid. */
  update(colony: Colony, now: number, isAiControlled = false): void {
    if (isAiControlled) {
      if (colony.resources.food < SPAWN_FOOD_DRAIN) this.aiRecovering.add(colony.side)
      if (this.aiRecovering.has(colony.side) && colony.resources.food >= 150) {
        this.aiRecovering.delete(colony.side)
      }
      if (this.aiRecovering.has(colony.side)) return
    }

    for (const building of colony.buildings) {
      if (building.type !== 'EGG_CHAMBER') continue
      if (!building.isAlive()) continue

      const pending = this.incubating.get(building.id)
      if (pending) {
        // If food reserve drops under 50 during incubation, egg is cancelled with no refund.
        if (colony.resources.food < SPAWN_FOOD_DRAIN) {
          this.incubating.delete(building.id)
          continue
        }
        if (now - pending.startedAt < EGG_SPAWN_INTERVAL) continue
        colony.spawnAnt(pending.type)
        this.incubating.delete(building.id)
        continue
      }

      const type = colony.nextSpawnType()
      this.spawnAnt(colony, type, building.id, now)
    }
  }

  spawnAnt(colony: Colony, type: AntType, eggChamberId: string, now: number): boolean {
    if (colony.resources.food < SPAWN_FOOD_DRAIN) {
      this.warningUntil.set(colony.side, now + 2000)
      return false
    }
    colony.resources.food -= SPAWN_FOOD_DRAIN
    this.incubating.set(eggChamberId, { startedAt: now, type })
    return true
  }

  getWarning(colony: Colony, now: number): string {
    const until = this.warningUntil.get(colony.side) ?? 0
    return now <= until ? 'Nourriture insuffisante' : ''
  }
}
