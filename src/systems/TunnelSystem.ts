import type { Colony } from '../entities/Colony'
import { AntType, AntState } from '../types'
import { TUNNEL_BUILD_TIME_BASE } from '../config/constants'

export interface TunnelTask {
  tileX: number
  tileY: number
  progress: number   // 0–100
}

export class TunnelSystem {
  private queue: TunnelTask[] = []
  private active: TunnelTask | null = null
  private assignedIds = new Set<string>()

  // ─── Queue management ──────────────────────────────────────────────────────

  addTiles(tiles: { col: number; row: number }[]): void {
    for (const t of tiles) {
      if (!this.isQueued(t.col, t.row)) {
        this.queue.push({ tileX: t.col, tileY: t.row, progress: 0 })
      }
    }
  }

  isQueued(col: number, row: number): boolean {
    if (this.active?.tileX === col && this.active?.tileY === row) return true
    return this.queue.some(t => t.tileX === col && t.tileY === row)
  }

  get queueLength(): number {
    return this.queue.length + (this.active ? 1 : 0)
  }

  getActive(): TunnelTask | null { return this.active }
  getQueue(): readonly TunnelTask[] { return this.queue }

  clearQueue(colony: Colony): void {
    this.queue = []
    this.active = null
    for (const ant of colony.ants) {
      if (this.assignedIds.has(ant.id)) ant.digTarget = null
    }
    this.assignedIds.clear()
  }

  // ─── Game-loop update ──────────────────────────────────────────────────────

  update(
    delta: number,
    colony: Colony,
    passable: (col: number, row: number) => boolean,
    onComplete: (tileX: number, tileY: number) => void
  ): void {
    // Promote the next task when idle
    if (!this.active && this.queue.length > 0) {
      this.active = this.queue.shift()!
      this.assignedIds.clear()
    }
    if (!this.active) return

    // ── Worker assignment ──────────────────────────────────────────────────
    const aliveWorkers = colony.ants.filter(
      a => a.type === AntType.WORKER && a.state !== AntState.DEAD
    )
    const target = Math.min(
      Math.max(1, Math.floor(aliveWorkers.length * 0.25)),
      10
    )

    if (this.assignedIds.size < target) {
      const free = aliveWorkers.filter(
        a => !this.assignedIds.has(a.id) && a.digTarget === null
      )
      for (const worker of free) {
        if (this.assignedIds.size >= target) break
        this.assignedIds.add(worker.id)
        worker.digTarget = { col: this.active.tileX, row: this.active.tileY }
        worker.navigateTo(
          this.findWorkPos({ col: this.active.tileX, row: this.active.tileY }, passable) ??
          { col: worker.col, row: worker.row },
          passable
        )
      }
    }

    // ── Progress ───────────────────────────────────────────────────────────
    const onSite = colony.ants.filter(
      a => this.assignedIds.has(a.id) && a.state === AntState.WORKING
    ).length

    if (onSite > 0) {
      // Time per tile = BUILD_TIME / workers → progress rate = delta*workers*100/BUILD_TIME
      this.active.progress = Math.min(
        100,
        this.active.progress + (delta * onSite * 100) / TUNNEL_BUILD_TIME_BASE
      )
    }

    // ── Completion ─────────────────────────────────────────────────────────
    if (this.active.progress >= 100) {
      onComplete(this.active.tileX, this.active.tileY)
      for (const ant of colony.ants) {
        if (this.assignedIds.has(ant.id)) ant.digTarget = null
      }
      this.active = null
      this.assignedIds.clear()
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Find the best adjacent TUNNEL tile for a worker to stand on while digging. */
  private findWorkPos(
    target: { col: number; row: number },
    passable: (col: number, row: number) => boolean
  ): { col: number; row: number } | null {
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
      const nc = target.col + dc
      const nr = target.row + dr
      if (passable(nc, nr)) return { col: nc, row: nr }
    }
    return null
  }
}
