import type { Colony } from '../entities/Colony'
import { EGG_SPAWN_INTERVAL, SPAWN_FOOD_DRAIN } from '../config/constants'

export class SpawnSystem {
  private lastSpawn = new Map<string, number>()

  /** Called each tick — spawns one ant per egg chamber if food allows. */
  update(colony: Colony, now: number): void {
    for (const building of colony.buildings) {
      if (building.type !== 'EGG_CHAMBER') continue
      if (!building.isAlive()) continue

      const last = this.lastSpawn.get(building.id) ?? 0
      if (now - last < EGG_SPAWN_INTERVAL) continue
      if (colony.resources.food < SPAWN_FOOD_DRAIN) continue

      colony.resources.food -= SPAWN_FOOD_DRAIN
      colony.spawnAnt(colony.nextSpawnType())
      this.lastSpawn.set(building.id, now)
    }
  }
}
