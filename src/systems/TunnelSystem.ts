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
  private assignedIds = new Set<string>()
  private assignment = new Map<string, number>() // antId -> queue index
  private dedicatedWorkers = 0

  // ─── Queue management ──────────────────────────────────────────────────────

  addTiles(tiles: { col: number; row: number }[]): void {
    for (const t of tiles) {
      if (!this.isQueued(t.col, t.row)) {
        this.queue.push({ tileX: t.col, tileY: t.row, progress: 0 })
      }
    }
  }

  isQueued(col: number, row: number): boolean {
    return this.queue.some(t => t.tileX === col && t.tileY === row)
  }

  get queueLength(): number {
    return this.queue.length
  }

  getActive(): TunnelTask | null { return this.queue.find(t => t.progress > 0) ?? this.queue[0] ?? null }
  getQueue(): readonly TunnelTask[] { return this.queue }
  getDedicatedWorkers(): number { return this.dedicatedWorkers }

  setDedicatedWorkers(value: number): void {
    this.dedicatedWorkers = Math.max(0, Math.floor(value))
  }

  getActiveDiggersCount(colony: Colony): number {
    return colony.ants.filter(a => this.assignedIds.has(a.id) && a.type === AntType.WORKER && a.state !== AntState.DEAD).length
  }

  getEstimatedSeconds(colony: Colony): number {
    const assigned = Math.min(this.dedicatedWorkers, colony.workerCount)
    if (assigned <= 0 || this.queue.length === 0) return 0
    const remaining = this.queue.reduce((sum, t) => sum + (100 - t.progress), 0)
    const percentPerSecond = (assigned * 1000 * 100) / TUNNEL_BUILD_TIME_BASE
    return Math.max(1, Math.ceil((remaining / percentPerSecond) * 1000))
  }

  clearQueue(colony: Colony): void {
    this.queue = []
    for (const ant of colony.ants) {
      if (this.assignedIds.has(ant.id)) ant.digTarget = null
    }
    this.assignedIds.clear()
    this.assignment.clear()
  }

  // ─── Game-loop update ──────────────────────────────────────────────────────

  update(
    delta: number,
    colony: Colony,
    passable: (col: number, row: number) => boolean,
    onComplete: (tileX: number, tileY: number) => void
  ): void {
    const aliveWorkers = colony.ants.filter(
      a => a.type === AntType.WORKER && a.state !== AntState.DEAD
    )
    const targetDiggers = Math.min(this.dedicatedWorkers, aliveWorkers.length)

    const selected = aliveWorkers
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, targetDiggers)
    const selectedIds = new Set(selected.map(a => a.id))

    for (const worker of aliveWorkers) {
      if (selectedIds.has(worker.id)) continue
      if (this.assignedIds.has(worker.id)) {
        worker.digTarget = null
        this.assignment.delete(worker.id)
      }
    }
    this.assignedIds = selectedIds

    if (this.queue.length === 0 || targetDiggers === 0) {
      for (const worker of selected) {
        worker.digTarget = null
        this.assignment.delete(worker.id)
      }
      return
    }

    const taskCount = this.queue.length
    if (taskCount >= targetDiggers) {
      for (let i = 0; i < selected.length; i++) this.assignment.set(selected[i].id, i)
    } else {
      for (const worker of selected) this.assignment.set(worker.id, 0)
    }

    const workersPerTask = new Map<number, number>()
    for (const worker of selected) {
      const idx = this.assignment.get(worker.id) ?? 0
      workersPerTask.set(idx, (workersPerTask.get(idx) ?? 0) + 1)
      const task = this.queue[idx]
      if (!task) continue
      worker.digTarget = { col: task.tileX, row: task.tileY }
      const workPos = this.findWorkPos({ col: task.tileX, row: task.tileY }, passable)
      if (workPos && (worker.col !== workPos.col || worker.row !== workPos.row)) {
        worker.navigateTo(workPos, passable)
      }
    }

    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i]
      const assignedOnTask = workersPerTask.get(i) ?? 0
      if (assignedOnTask <= 0) continue
      const onSite = selected.filter(a => {
        if ((this.assignment.get(a.id) ?? -1) !== i) return false
        return a.state === AntState.WORKING && !!a.digTarget && a.digTarget.col === task.tileX && a.digTarget.row === task.tileY
      }).length
      if (onSite <= 0) continue
      task.progress = Math.min(100, task.progress + (delta * onSite * 100) / TUNNEL_BUILD_TIME_BASE)
    }

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i]
      if (task.progress < 100) continue
      onComplete(task.tileX, task.tileY)
      this.queue.splice(i, 1)
      for (const [antId, idx] of this.assignment.entries()) {
        if (idx === i) this.assignment.delete(antId)
        else if (idx > i) this.assignment.set(antId, idx - 1)
      }
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
