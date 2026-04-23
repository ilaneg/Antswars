import Phaser from 'phaser'
import {
  MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_SCROLL_SPEED,
  TILE_COLORS, START_BASES, CANVAS_HEIGHT,
  BUILDING_CONFIG, BASE_BUILDING_LAYOUT,
} from '../config/constants'
import { TileType, AntType, AntState } from '../types'
import type { PlayerSide } from '../types'
import { Colony } from '../entities/Colony'
import { Building } from '../entities/Building'
import { Ant } from '../entities/Ant'
import { TunnelSystem } from '../systems/TunnelSystem'
import { ResourceSystem } from '../systems/ResourceSystem'
import { CombatSystem } from '../systems/CombatSystem'
import { SpawnSystem } from '../systems/SpawnSystem'
import { netplay } from '../systems/Netplay'
import type { NetAction, NetRole } from '../systems/Netplay'
import { ResourceType } from '../types'
import { PheromoneSystem, pheroColor, pheroIcon, pheroRadiusTiles, tileToWorld } from '../systems/PheromoneSystem'

const T = TileType

// No-rock buffer around each base
const BASE_GUARD_W = 13
const BASE_GUARD_H = 12
const HUD_H        = 90
const DIRT_VARIANT_COUNT = 16
const ROCK_VARIANT_COUNT = 12
const FLASH_MS = 200

type HitFlash = { x: number; y: number; expiresAt: number }
type CorpseTask = { corpseId: string; workerId: string; phase: 'toCorpse' | 'toCemetery' }

export class GameScene extends Phaser.Scene {
  // ── Public (read by UIScene / future systems) ─────────────────────────────
  mapData: number[][] = []
  playerColony!: Colony
  aiColony!: Colony
  tunnelSystem!: TunnelSystem
  resourceSystem!: ResourceSystem
  pheromoneSystem = new PheromoneSystem()
  aiPheromoneSystem = new PheromoneSystem()
  combatSystem = new CombatSystem()
  spawnSystem = new SpawnSystem()
  selectedBuilding: Building | null = null
  frontlineCol = MAP_WIDTH / 2
  isColonyInDanger = false
  localColony!: Colony
  enemyColony!: Colony

  // ── Private ───────────────────────────────────────────────────────────────
  private tilemapLayer!: Phaser.Tilemaps.TilemapLayer
  private antGfx!:       Phaser.GameObjects.Graphics
  private drawGfx!:      Phaser.GameObjects.Graphics
  private buildingGfx!:  Phaser.GameObjects.Graphics
  private resourceGfx!: Phaser.GameObjects.Graphics
  private combatGfx!: Phaser.GameObjects.Graphics
  private pheroGfx!: Phaser.GameObjects.Graphics
  private pheroTextGroup: Phaser.GameObjects.Text[] = []
  private buildingLabels: Phaser.GameObjects.Text[] = []
  private dirtVariantStart = TILE_COLORS.length
  private rockVariantStart = TILE_COLORS.length + DIRT_VARIANT_COUNT

  private isDrawing = false
  private drawPath: { col: number; row: number }[] = []
  private dustTick  = 0

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private keyW!: Phaser.Input.Keyboard.Key
  private keyA!: Phaser.Input.Keyboard.Key
  private keyS!: Phaser.Input.Keyboard.Key
  private keyD!: Phaser.Input.Keyboard.Key
  private keyF!: Phaser.Input.Keyboard.Key
  private keyR!: Phaser.Input.Keyboard.Key
  private hitFlashes: HitFlash[] = []
  private corpseTasks: CorpseTask[] = []
  private audioCtx: AudioContext | null = null
  private lastAlertAt = 0
  private role: NetRole = 'host'
  private multiplayer = false
  private mapSeed = 1337
  private seededRand = mulberry32(1337)
  private pendingRemoteActions: { action: NetAction; applyAt: number }[] = []
  private lastMoveSyncAt = 0
  private prevEnemyBuildingHp = new Map<string, number>()
  private prevLocalFood = 0
  private draggingPheroId: string | null = null
  private dragMoved = false
  private hoveredPheroId: string | null = null
  private pheroCursor!: Phaser.GameObjects.Graphics

  constructor() { super({ key: 'GameScene' }) }

  init(data: { role: 'host' | 'guest'; seed?: number; multiplayer?: boolean }): void {
    this.role = data.role
    this.multiplayer = !!data.multiplayer
    if (typeof data.seed === 'number') {
      this.mapSeed = data.seed
      this.seededRand = mulberry32(this.mapSeed)
    }
  }

  // ─── Assets ────────────────────────────────────────────────────────────────

  preload(): void {
    this.load.image('dirt-texture', '/dirt-texture.png')
    this.load.image('rock-texture', '/rock-texture.png')
  }

  private buildTilesetTexture(): void {
    const canvas = document.createElement('canvas')
    canvas.width  = TILE_SIZE * (TILE_COLORS.length + DIRT_VARIANT_COUNT + ROCK_VARIANT_COUNT)
    canvas.height = TILE_SIZE
    const ctx = canvas.getContext('2d')!
    TILE_COLORS.forEach((color, i) => {
      ctx.fillStyle = color
      ctx.fillRect(i * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE)
    })

    // Replace DIRT tile with the provided full texture and generate variants.
    const dirtImage = this.textures.get('dirt-texture')?.getSourceImage() as CanvasImageSource | undefined
    if (dirtImage) {
      const dirtX = TileType.DIRT * TILE_SIZE
      ctx.drawImage(dirtImage, 0, 0, TILE_SIZE, TILE_SIZE, dirtX, 0, TILE_SIZE, TILE_SIZE)
      this.applyColorGrade(ctx, dirtX, 0, TILE_SIZE, TILE_SIZE, '#8a3f1d', 0.16, '#f0a36a', 0.08)

      // Build a small atlas of dirt variants to avoid identical repetition.
      for (let i = 0; i < DIRT_VARIANT_COUNT; i++) {
        const tx = (this.dirtVariantStart + i) * TILE_SIZE
        ctx.save()
        ctx.translate(tx + TILE_SIZE / 2, TILE_SIZE / 2)
        if (i % 2 === 1) ctx.scale(-1, 1)
        if (i % 4 >= 2) ctx.scale(1, -1)
        ctx.drawImage(dirtImage, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE)
        ctx.restore()
        this.applyColorGrade(ctx, tx, 0, TILE_SIZE, TILE_SIZE, '#8a3f1d', 0.16, '#f0a36a', 0.08)
      }
    }

    // Replace ROCK tile with the provided full texture and generate variants.
    const rockImage = this.textures.get('rock-texture')?.getSourceImage() as CanvasImageSource | undefined
    if (rockImage) {
      const rockX = TileType.ROCK * TILE_SIZE
      ctx.drawImage(rockImage, 0, 0, TILE_SIZE, TILE_SIZE, rockX, 0, TILE_SIZE, TILE_SIZE)
      this.applyColorGrade(ctx, rockX, 0, TILE_SIZE, TILE_SIZE, '#33404f', 0.2, '#a9b1bb', 0.06)
      for (let i = 0; i < ROCK_VARIANT_COUNT; i++) {
        const tx = (this.rockVariantStart + i) * TILE_SIZE
        ctx.save()
        ctx.translate(tx + TILE_SIZE / 2, TILE_SIZE / 2)
        if (i % 2 === 1) ctx.scale(-1, 1)
        if (i % 3 === 2) ctx.scale(1, -1)
        ctx.drawImage(rockImage, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE)
        ctx.restore()
        this.applyColorGrade(ctx, tx, 0, TILE_SIZE, TILE_SIZE, '#33404f', 0.2, '#a9b1bb', 0.06)
      }
    }

    this.textures.addCanvas('tileset', canvas)
  }

  // ─── Scene setup ───────────────────────────────────────────────────────────

  create(): void {
    this.buildTilesetTexture()
    this.mapData = this.generateMap()
    this.buildTilemap()
    this.buildingGfx = this.add.graphics().setDepth(5)
    this.resourceGfx = this.add.graphics().setDepth(6)
    this.drawGfx     = this.add.graphics().setDepth(6)
    this.combatGfx   = this.add.graphics().setDepth(6.8)
    this.pheroGfx    = this.add.graphics().setDepth(6.6)
    this.antGfx      = this.add.graphics().setDepth(7)
    this.pheroCursor = this.add.graphics().setDepth(9)

    this.setupCamera()
    this.setupInput()
    this.setupColonies()
    this.localColony = this.role === 'host' ? this.playerColony : this.aiColony
    this.enemyColony = this.role === 'host' ? this.aiColony : this.playerColony
    this.prevLocalFood = this.localColony.resources.food
    this.prevEnemyBuildingHp.clear()
    for (const b of this.enemyColony.buildings) this.prevEnemyBuildingHp.set(b.type, b.hp)
    this.tunnelSystem = new TunnelSystem()
    this.resourceSystem = new ResourceSystem()
    this.resourceSystem.init(this.time.now, (c, r) => this.getTile(c, r), [
      ...this.playerColony.buildings,
      ...this.aiColony.buildings,
    ])
    if (this.multiplayer) {
      netplay.onAction = (action) => {
        this.pendingRemoteActions.push({ action, applyAt: Date.now() + 100 })
      }
      netplay.onDisconnected = () => {
        this.scene.pause()
        this.add.text(this.cameras.main.midPoint.x, 54, 'Connexion perdue, en attente...', {
          fontSize: '26px', color: '#ff6666', fontFamily: 'monospace', stroke: '#000', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(60).setScrollFactor(0)
      }
    } else {
      this.aiPheromoneSystem.addPoint('FOOD', this.aiColony.baseCol + 8, this.aiColony.baseDepth + 8)
      this.aiPheromoneSystem.addPoint('ATTACK', this.playerColony.baseCol + 6, this.playerColony.baseDepth + 6)
    }
    this.scene.launch('UIScene')
  }

  // ─── Colonies & buildings ──────────────────────────────────────────────────

  private setupColonies(): void {
    this.playerColony = new Colony('PLAYER1', 0)
    this.aiColony     = new Colony('PLAYER2', 1)

    for (let i = 0; i < 7; i++) this.playerColony.spawnAnt(AntType.WORKER)
    for (let i = 0; i < 3; i++) this.playerColony.spawnAnt(AntType.WARRIOR)
    this.playerColony.ants.forEach((ant, i) => {
      (ant as unknown as { behaviorTimer: number }).behaviorTimer = i * 130
    })

    this.placeBuildings(this.playerColony, 0)
    this.placeBuildings(this.aiColony, 1)
  }

  private placeBuildings(colony: Colony, baseIndex: 0 | 1): void {
    const base = START_BASES[baseIndex]
    const side = colony.side as PlayerSide

    for (const layout of BASE_BUILDING_LAYOUT) {
      const cfg = BUILDING_CONFIG[layout.type]
      const building = new Building(
        layout.type,
        base.col + layout.dx,
        base.depth + layout.dy,
        cfg.width, cfg.height,
        side,
        cfg.hp
      )
      colony.addBuilding(building)

      // Label centered over building footprint in world space
      const px = (base.col + layout.dx) * TILE_SIZE + (cfg.width  * TILE_SIZE) / 2
      const py = (base.depth + layout.dy) * TILE_SIZE + (cfg.height * TILE_SIZE) / 2
      const label = this.add.text(px, py, cfg.label, {
        fontSize: '8px', color: '#ffffff', fontFamily: 'monospace',
        align: 'center', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 0.5).setDepth(8)
      this.buildingLabels.push(label)
    }
  }

  // ─── Map generation ────────────────────────────────────────────────────────

  private generateMap(): number[][] {
    const grid: number[][] = Array.from({ length: MAP_HEIGHT }, (_, row) =>
      new Array<number>(MAP_WIDTH).fill(row === 0 ? T.GRASS : T.DIRT)
    )
    for (let row = 2; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        if (grid[row][col] === T.DIRT && !this.inBaseZone(col, row) && this.seededRand() < 0.08)
          this.growCluster(grid, row, col)
      }
    }
    for (const base of START_BASES) this.carveBase(grid, base.col, base.depth)
    return grid
  }

  private inBaseZone(col: number, row: number): boolean {
    return START_BASES.some(
      b => col >= b.col - 2 && col <= b.col + BASE_GUARD_W &&
           row >= 1 && row <= b.depth + BASE_GUARD_H
    )
  }

  private growCluster(grid: number[][], startRow: number, startCol: number): void {
    const target = 3 + Math.floor(this.seededRand() * 6)
    const frontier: [number, number][] = [[startRow, startCol]]
    let placed = 0
    while (frontier.length > 0 && placed < target) {
      const idx = Math.floor(this.seededRand() * frontier.length)
      const [r, c] = frontier.splice(idx, 1)[0]
      if (r < 2 || r >= MAP_HEIGHT || c < 0 || c >= MAP_WIDTH) continue
      if (grid[r][c] !== T.DIRT || this.inBaseZone(c, r)) continue
      grid[r][c] = T.ROCK; placed++
      frontier.push([r-1,c],[r+1,c],[r,c-1],[r,c+1])
    }
  }

  /**
   * Layout (col = base.col, d = base.depth):
   *   shaft:          col+3, rows 1..d
   *   top corridor:   row d,   cols col..col+10
   *   EGG_CHAMBER:    rows d+1..d+4, cols col..col+4   (5×4)
   *   QUEEN_THRONE:   rows d+1..d+4, cols col+5..col+10 (6×4)
   *   mid corridor:   row d+5, cols col..col+10
   *   RESOURCE_CENTER:rows d+6..d+8, cols col..col+3   (4×3)
   *   CEMETERY:       rows d+6..d+7, cols col+5..col+7  (3×2)
   */
  private carveBase(grid: number[][], col: number, depth: number): void {
    const d = depth
    const shaft = col + 3
    for (let row = 1; row <= d; row++) this.setTunnel(grid, row, shaft)

    for (let c = col; c <= col + 10; c++) this.setTunnel(grid, d, c)

    for (let r = d + 1; r <= d + 4; r++)
      for (let c = col; c <= col + 10; c++) this.setTunnel(grid, r, c)

    for (let c = col; c <= col + 10; c++) this.setTunnel(grid, d + 5, c)

    for (let r = d + 6; r <= d + 8; r++)
      for (let c = col; c <= col + 3; c++) this.setTunnel(grid, r, c)

    for (let r = d + 6; r <= d + 7; r++)
      for (let c = col + 5; c <= col + 7; c++) this.setTunnel(grid, r, c)
  }

  private setTunnel(grid: number[][], row: number, col: number): void {
    if (row >= 0 && row < MAP_HEIGHT && col >= 0 && col < MAP_WIDTH)
      grid[row][col] = T.TUNNEL
  }

  // ─── Tilemap ───────────────────────────────────────────────────────────────

  private buildTilemap(): void {
    const map = this.make.tilemap({ data: this.mapData, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE })
    const ts  = map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, 0, 0, 0)!
    this.tilemapLayer = map.createLayer(0, ts, 0, 0)!

    // Swap visual index for DIRT cells to textured variants while gameplay data stays TileType.DIRT.
    for (let row = 0; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        if (this.mapData[row][col] === T.DIRT) {
          this.tilemapLayer.putTileAt(this.getDirtVisualIndex(col, row), col, row)
          continue
        }
        if (this.mapData[row][col] === T.ROCK) {
          this.tilemapLayer.putTileAt(this.getRockVisualIndex(col, row), col, row)
        }
      }
    }
  }

  private completeTile(tileX: number, tileY: number): void {
    this.mapData[tileY][tileX] = T.TUNNEL
    this.tilemapLayer.putTileAt(T.TUNNEL, tileX, tileY)
    if (this.multiplayer) netplay.sendAction({ type: 'tunnel', x: tileX, y: tileY })
  }

  private getDirtVisualIndex(col: number, row: number): number {
    const hash = ((col * 73856093) ^ (row * 19349663)) >>> 0
    return this.dirtVariantStart + (hash % DIRT_VARIANT_COUNT)
  }

  private getRockVisualIndex(col: number, row: number): number {
    const hash = ((col * 83492791) ^ (row * 2971215073)) >>> 0
    return this.rockVariantStart + (hash % ROCK_VARIANT_COUNT)
  }

  private applyColorGrade(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    shadowColor: string,
    shadowAlpha: number,
    lightColor: string,
    lightAlpha: number
  ): void {
    ctx.save()
    ctx.fillStyle = shadowColor
    ctx.globalAlpha = shadowAlpha
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = lightColor
    ctx.globalAlpha = lightAlpha
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  // ─── Camera & input ────────────────────────────────────────────────────────

  private setupCamera(): void {
    const cam = this.cameras.main
    cam.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE)
    cam.setZoom(1.5)
    cam.centerOn((START_BASES[0].col + 3) * TILE_SIZE, START_BASES[0].depth * TILE_SIZE)
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W)
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A)
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S)
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    this.keyF = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F)
    this.keyR = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R)

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX))
    })

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (!this.audioCtx) this.audioCtx = new window.AudioContext()
      if (ptr.rightButtonDown()) {
        this.cancelDraw()
        return
      }
      if (!ptr.leftButtonDown()) return
      if (ptr.y >= CANVAS_HEIGHT - HUD_H) return

      const { col, row } = this.ptrToTile(ptr)
      this.updatePheromoneModeFromKeys()

      const hitPhero = this.pheromoneSystem.pointAt(col, row)
      if (hitPhero) {
        this.draggingPheroId = hitPhero.id
        this.dragMoved = false
        return
      }

      if (this.pheromoneSystem.mode) {
        this.pheromoneSystem.addPoint(this.pheromoneSystem.mode, col, row)
        return
      }

      // Building selection (buildings are on TUNNEL tiles, so check first)
      const hit = this.findBuildingAt(col, row)
      if (hit) {
        this.selectedBuilding = this.selectedBuilding === hit ? null : hit
        return
      }

      if (this.getTile(col, row) !== T.DIRT) return
      if (!this.touchesTunnel(col, row)) return

      this.isDrawing = true
      this.drawPath  = [{ col, row }]
    })

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      const { col, row } = this.ptrToTile(ptr)
      this.hoveredPheroId = this.pheromoneSystem.pointAt(col, row)?.id ?? null
      if (this.draggingPheroId && ptr.isDown) {
        this.pheromoneSystem.movePoint(this.draggingPheroId, col, row)
        this.dragMoved = true
      }
      if (!this.isDrawing || !ptr.isDown) return

      const last = this.drawPath[this.drawPath.length - 1]
      if (col === last.col && row === last.row) return
      if (Math.abs(col - last.col) + Math.abs(row - last.row) !== 1) return
      if (this.getTile(col, row) !== T.DIRT) return
      if (this.drawPath.some(t => t.col === col && t.row === row)) return

      this.drawPath.push({ col, row })
    })

    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (this.draggingPheroId) {
        if (!this.dragMoved) this.pheromoneSystem.removePoint(this.draggingPheroId)
        this.draggingPheroId = null
      }
      if (ptr.leftButtonReleased() && this.isDrawing) this.confirmDraw()
    })

    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.isDrawing) this.cancelDraw()
      else this.selectedBuilding = null
    })
    this.input.keyboard!.on('keydown-DELETE', () => {
      if (window.confirm('Effacer tous les points ? O/N')) this.pheromoneSystem.clearAll()
    })
    this.input.keyboard!.on('keydown-BACKSPACE', () => {
      if (window.confirm('Effacer tous les points ? O/N')) this.pheromoneSystem.clearAll()
    })
  }

  // ─── Drawing helpers ───────────────────────────────────────────────────────

  private ptrToTile(ptr: Phaser.Input.Pointer): { col: number; row: number } {
    const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y)
    return { col: Math.floor(wp.x / TILE_SIZE), row: Math.floor(wp.y / TILE_SIZE) }
  }

  private updatePheromoneModeFromKeys(): void {
    if (this.keyF.isDown) this.pheromoneSystem.setMode('FOOD')
    else if (this.keyA.isDown) this.pheromoneSystem.setMode('ATTACK')
    else if (this.keyR.isDown) this.pheromoneSystem.setMode('RALLY')
    else this.pheromoneSystem.setMode(null)
  }

  private renderPheromones(now: number): void {
    this.pheroGfx.clear()
    this.pheroCursor.clear()
    for (const txt of this.pheroTextGroup) txt.destroy()
    this.pheroTextGroup = []

    const pulse = 1 + 0.15 * (0.5 + 0.5 * Math.sin(now / 750))
    const center = this.localColony.buildings.find(b => b.type === 'RESOURCE_CENTER')
    const nestCol = center ? center.tileX + 1 : this.localColony.baseCol + 3
    const nestRow = center ? center.tileY + 1 : this.localColony.baseDepth
    const pointer = this.input.activePointer
    this.updatePheromoneModeFromKeys()

    for (const p of this.pheromoneSystem.points) {
      const { x, y } = tileToWorld(p.col, p.row)
      const color = pheroColor(p.kind)
      this.pheroGfx.fillStyle(color, 0.85)
      this.pheroGfx.fillCircle(x, y, 24)
      this.pheroGfx.lineStyle(2, color, 0.9)
      this.pheroGfx.strokeCircle(x, y, 24 * pulse)

      const icon = this.add.text(x, y, pheroIcon(p.kind), {
        fontSize: '18px', color: '#ffffff', fontFamily: 'monospace', stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(8.5)
      const badge = this.add.text(x + 18, y - 18, `×${this.pheromoneSystem.assignedCounts.get(p.id) ?? 0}`, {
        fontSize: '12px', color: '#111', backgroundColor: '#fff', fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(8.5)
      this.pheroTextGroup.push(icon, badge)

      if (this.hoveredPheroId === p.id && pheroRadiusTiles(p.kind) > 0) {
        this.drawDashedCircle(this.pheroGfx, x, y, pheroRadiusTiles(p.kind) * TILE_SIZE, color)
      }

      const path = this.pheromoneSystem.getTrailPath(nestCol, nestRow, p.col, p.row, (c, r) => this.isPassable(c, r))
      this.drawDashedTrail(path, color, this.pheromoneSystem.dashOffset)
    }

    if (this.pheromoneSystem.mode) {
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      this.pheroCursor.lineStyle(2, pheroColor(this.pheromoneSystem.mode), 0.95)
      this.pheroCursor.strokeCircle(wp.x, wp.y, 16)
      this.input.setDefaultCursor('copy')
    } else {
      this.input.setDefaultCursor('crosshair')
    }
  }

  private drawDashedTrail(path: { col: number; row: number }[], color: number, offset: number): void {
    if (path.length < 2) return
    this.pheroGfx.lineStyle(2, color, 0.3)
    for (let i = 1; i < path.length; i++) {
      const a = tileToWorld(path[i - 1].col, path[i - 1].row)
      const b = tileToWorld(path[i].col, path[i].row)
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
      const dash = 8; const gap = 6
      let p = -offset
      while (p < len) {
        const s = Math.max(0, p)
        const e = Math.min(len, p + dash)
        if (e > s) {
          const t1 = s / len; const t2 = e / len
          this.pheroGfx.lineBetween(
            Phaser.Math.Linear(a.x, b.x, t1),
            Phaser.Math.Linear(a.y, b.y, t1),
            Phaser.Math.Linear(a.x, b.x, t2),
            Phaser.Math.Linear(a.y, b.y, t2)
          )
        }
        p += dash + gap
      }
    }
  }

  private drawDashedCircle(gfx: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, color: number): void {
    gfx.lineStyle(1.5, color, 0.8)
    const seg = 28
    for (let i = 0; i < seg; i += 2) {
      const a1 = (i / seg) * Math.PI * 2
      const a2 = ((i + 1) / seg) * Math.PI * 2
      gfx.beginPath()
      gfx.arc(x, y, radius, a1, a2, false)
      gfx.strokePath()
    }
  }

  private touchesTunnel(col: number, row: number): boolean {
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]] as [number,number][]) {
      const nc = col + dc; const nr = row + dr
      if (this.getTile(nc, nr) === T.TUNNEL || this.tunnelSystem.isQueued(nc, nr)) return true
    }
    return false
  }

  private confirmDraw(): void {
    if (this.drawPath.length > 0) this.tunnelSystem.addTiles(this.drawPath)
    this.drawPath  = []
    this.isDrawing = false
  }

  private cancelDraw(): void {
    this.drawPath  = []
    this.isDrawing = false
  }

  private updateCombat(now: number): void {
    const killedP = this.combatSystem.resolve(
      this.playerColony.ants,
      this.aiColony.ants,
      this.aiColony.buildings,
      now,
      (x, y) => this.hitFlashes.push({ x, y, expiresAt: now + FLASH_MS })
    )
    const killedAI = this.combatSystem.resolve(
      this.aiColony.ants,
      this.playerColony.ants,
      this.playerColony.buildings,
      now,
      (x, y) => this.hitFlashes.push({ x, y, expiresAt: now + FLASH_MS })
    )
    // Ensure dead state is visible immediately.
    for (const ant of [...killedP, ...killedAI]) ant.state = AntState.DEAD
    if (this.multiplayer) {
      const sentIds = new Set<string>()
      const ownKills = this.role === 'host' ? killedP : killedAI
      for (const dead of ownKills) {
        if (sentIds.has(dead.id)) continue
        sentIds.add(dead.id)
        netplay.sendAction({ type: 'death', id: dead.id })
      }
      for (const b of this.enemyColony.buildings) {
        const prev = this.prevEnemyBuildingHp.get(b.type)
        if (typeof prev === 'number' && prev !== b.hp) {
          netplay.sendAction({ type: 'damage', buildingType: b.type, hp: b.hp })
        }
        this.prevEnemyBuildingHp.set(b.type, b.hp)
      }
    }
  }

  private updateCorpseHandling(): void {
    this.assignCorpseWorkers(this.playerColony)
    this.assignCorpseWorkers(this.aiColony)
    this.advanceCorpseTasks(this.playerColony)
    this.advanceCorpseTasks(this.aiColony)
  }

  private assignCorpseWorkers(colony: Colony): void {
    const cemetery = colony.buildings.find(b => b.type === 'CEMETERY' && b.isAlive())
    if (!cemetery) return
    const deadAnts = colony.ants.filter(a => a.state === AntState.DEAD)
    const assignedCorpseIds = new Set(this.corpseTasks.map(t => t.corpseId))
    for (const corpse of deadAnts) {
      if (assignedCorpseIds.has(corpse.id)) continue
      const worker = colony.ants.find(a =>
        a.type === AntType.WORKER &&
        a.state !== AntState.DEAD &&
        !a.carryingCorpseId &&
        Math.hypot(a.x - corpse.x, a.y - corpse.y) <= TILE_SIZE * 1.5
      )
      if (!worker) continue
      const drop = { col: cemetery.tileX + 1, row: cemetery.tileY + 1 }
      const path = Ant.aStar({ col: worker.col, row: worker.row }, drop, (c, r) => this.isPassable(c, r))
      if (path.length === 0 && (worker.col !== drop.col || worker.row !== drop.row)) continue
      worker.carryingCorpseId = corpse.id
      worker.navigateTo({ col: corpse.col, row: corpse.row }, (c, r) => this.isPassable(c, r))
      this.corpseTasks.push({ corpseId: corpse.id, workerId: worker.id, phase: 'toCorpse' })
    }
  }

  private advanceCorpseTasks(colony: Colony): void {
    const cemetery = colony.buildings.find(b => b.type === 'CEMETERY' && b.isAlive())
    if (!cemetery) return
    const drop = { col: cemetery.tileX + 1, row: cemetery.tileY + 1 }
    this.corpseTasks = this.corpseTasks.filter(task => {
      const worker = colony.ants.find(a => a.id === task.workerId)
      const corpse = colony.ants.find(a => a.id === task.corpseId)
      if (!worker || !corpse) return false
      if (worker.state === AntState.DEAD) return false
      if (task.phase === 'toCorpse') {
        if (Math.hypot(worker.x - corpse.x, worker.y - corpse.y) <= 10) {
          task.phase = 'toCemetery'
          worker.navigateTo(drop, (c, r) => this.isPassable(c, r))
        }
      } else {
        corpse.x = worker.x
        corpse.y = worker.y
        if (worker.col === drop.col && worker.row === drop.row) {
          worker.carryingCorpseId = null
          colony.ants = colony.ants.filter(a => a.id !== corpse.id)
          return false
        }
      }
      return true
    })
  }

  private renderCombatEffects(now: number): void {
    this.combatGfx.clear()
    this.hitFlashes = this.hitFlashes.filter(f => f.expiresAt > now)
    for (const flash of this.hitFlashes) {
      const t = Phaser.Math.Clamp((flash.expiresAt - now) / FLASH_MS, 0, 1)
      this.combatGfx.fillStyle(0xff2222, 0.6 * t)
      this.combatGfx.fillCircle(flash.x, flash.y, 8 + (1 - t) * 8)
    }
  }

  private updateFrontLineAndAlerts(now: number): void {
    const pWarriors = this.playerColony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    const aiWarriors = this.aiColony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    if (pWarriors.length > 0 && aiWarriors.length > 0) {
      const pAvg = pWarriors.reduce((s, a) => s + a.col, 0) / pWarriors.length
      const aAvg = aiWarriors.reduce((s, a) => s + a.col, 0) / aiWarriors.length
      this.frontlineCol = (pAvg + aAvg) / 2
    }

    const localWarriors = this.localColony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    const enemyWarriors = this.enemyColony.ants.filter(a => a.type === AntType.WARRIOR && a.state !== AntState.DEAD)
    const nearNest = enemyWarriors.filter(a => Math.abs(a.col - this.localColony.baseCol) < 16 && Math.abs(a.row - this.localColony.baseDepth) < 14).length
    if (nearNest > 5 && now - this.lastAlertAt > 2500) {
      this.playAlert()
      this.lastAlertAt = now
    }

    const throne = this.localColony.getQueenThrone()
    this.isColonyInDanger = localWarriors.length === 0 && !!throne && throne.hp / throne.maxHp < 0.3
  }

  private playAlert(): void {
    if (!this.audioCtx) return
    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 720
    gain.gain.value = 0.0001
    osc.connect(gain)
    gain.connect(this.audioCtx.destination)
    const now = this.audioCtx.currentTime
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    osc.start(now)
    osc.stop(now + 0.23)
  }

  private applyPendingRemoteActions(): void {
    if (!this.multiplayer) return
    const now = Date.now()
    const due = this.pendingRemoteActions.filter(a => a.applyAt <= now)
    this.pendingRemoteActions = this.pendingRemoteActions.filter(a => a.applyAt > now)
    for (const wrapped of due) {
      const action = wrapped.action
      if (action.type === 'tunnel') {
        if (this.getTile(action.x, action.y) === T.DIRT) {
          this.mapData[action.y][action.x] = T.TUNNEL
          this.tilemapLayer.putTileAt(T.TUNNEL, action.x, action.y)
        }
      } else if (action.type === 'spawn') {
        if (!this.enemyColony.ants.some(a => a.id === action.id)) {
          this.enemyColony.spawnAnt(action.antType === 'WORKER' ? AntType.WORKER : AntType.WARRIOR, action.id)
        }
      } else if (action.type === 'death') {
        const ant = this.enemyColony.ants.find(a => a.id === action.id)
        if (ant) ant.state = AntState.DEAD
      } else if (action.type === 'move') {
        const ant = this.enemyColony.ants.find(a => a.id === action.id)
        if (ant) ant.setNetworkTarget(action.x, action.y)
      } else if (action.type === 'resource') {
        this.enemyColony.resources.food += action.amount
      } else if (action.type === 'damage') {
        const b = this.localColony.buildings.find(build => build.type === action.buildingType)
        if (b) b.hp = Math.max(0, action.hp)
      }
    }
  }

  private syncLocalMoves(now: number): void {
    if (!this.multiplayer || now - this.lastMoveSyncAt < 200) return
    this.lastMoveSyncAt = now
    for (const ant of this.localColony.ants) {
      if (ant.state === AntState.DEAD) continue
      netplay.sendAction({ type: 'move', id: ant.id, x: ant.x, y: ant.y })
    }
  }

  private findBuildingAt(col: number, row: number): Building | null {
    for (const colony of [this.playerColony, this.aiColony]) {
      for (const b of colony.buildings) {
        if (col >= b.tileX && col < b.tileX + b.width &&
            row >= b.tileY && row < b.tileY + b.height) {
          return b
        }
      }
    }
    return null
  }

  // ─── Building rendering ────────────────────────────────────────────────────

  private renderBuildings(): void {
    this.buildingGfx.clear()
    const S = TILE_SIZE

    const allBuildings = [
      ...this.playerColony.buildings,
      ...this.aiColony.buildings,
    ]

    for (const b of allBuildings) {
      const cfg  = BUILDING_CONFIG[b.type]
      const px   = b.tileX * S
      const py   = b.tileY * S
      const w    = b.width  * S
      const h    = b.height * S
      const dead = !b.isAlive()

      const alpha = dead ? 0.15 : 0.45
      this.buildingGfx.fillStyle(cfg.color, alpha)
      this.buildingGfx.fillRect(px, py, w, h)

      const isSelected = b === this.selectedBuilding
      this.buildingGfx.lineStyle(isSelected ? 3 : 1.5, isSelected ? 0xffffff : cfg.color, isSelected ? 1 : 0.8)
      this.buildingGfx.strokeRect(px + 1, py + 1, w - 2, h - 2)

      // HP bar
      if (!dead && b.hp < b.maxHp) {
        const bw = w - 4
        const bx = px + 2; const by = py + h - 4
        this.buildingGfx.fillStyle(0x330000, 0.8)
        this.buildingGfx.fillRect(bx, by, bw, 3)
        this.buildingGfx.fillStyle(0x44ee44, 1)
        this.buildingGfx.fillRect(bx, by, bw * (b.hp / b.maxHp), 3)
      }
    }
  }

  private renderResources(now: number): void {
    this.resourceGfx.clear()
    const S = TILE_SIZE
    for (const resource of this.resourceSystem.resources) {
      const life = Phaser.Math.Clamp((resource.expiresAt - now) / (resource.expiresAt - resource.spawnedAt), 0, 1)
      const color = this.blendColor(resource.color, 0x444444, 1 - life)
      for (const tile of resource.tiles) {
        const px = tile.col * S
        const py = tile.row * S
        this.resourceGfx.fillStyle(color, 0.8)
        this.resourceGfx.fillRect(px + 4, py + 4, S - 8, S - 8)
        this.resourceGfx.lineStyle(1.5, 0x111111, 0.7)
        this.resourceGfx.strokeRect(px + 4, py + 4, S - 8, S - 8)
        this.drawResourceIcon(resource.type, px + S / 2, py + S / 2)
      }

      if (resource.threatLevel > 0 || resource.guardianCount > 0) {
        const marker = resource.tiles[0]
        this.resourceGfx.fillStyle(0xcc3333, 1)
        this.resourceGfx.fillCircle(marker.col * S + S * 0.8, marker.row * S + S * 0.2, 4)
      }
    }
  }

  private drawResourceIcon(type: ResourceType, x: number, y: number): void {
    this.resourceGfx.fillStyle(0xffffff, 0.9)
    switch (type) {
      case ResourceType.EARTHWORM:
        this.resourceGfx.fillCircle(x, y, 3)
        break
      case ResourceType.BEETLE:
        this.resourceGfx.fillCircle(x - 2, y, 2)
        this.resourceGfx.fillCircle(x + 2, y, 2)
        break
      case ResourceType.SEED_PILE:
        this.resourceGfx.fillTriangle(x - 4, y + 3, x + 4, y + 3, x, y - 4)
        break
      case ResourceType.DEAD_INSECT:
        this.resourceGfx.fillRect(x - 4, y - 1, 8, 2)
        break
      case ResourceType.MUSHROOM:
        this.resourceGfx.fillCircle(x, y - 2, 4)
        this.resourceGfx.fillRect(x - 1, y + 2, 2, 3)
        break
      case ResourceType.PEBBLE_CACHE:
        this.resourceGfx.fillCircle(x - 2, y, 2.5)
        this.resourceGfx.fillCircle(x + 2, y - 1, 2)
        break
    }
  }

  private blendColor(from: number, to: number, t: number): number {
    const ratio = Phaser.Math.Clamp(t, 0, 1)
    const fr = (from >> 16) & 0xff
    const fg = (from >> 8) & 0xff
    const fb = from & 0xff
    const tr = (to >> 16) & 0xff
    const tg = (to >> 8) & 0xff
    const tb = to & 0xff
    const r = Math.round(fr + (tr - fr) * ratio)
    const g = Math.round(fg + (tg - fg) * ratio)
    const b = Math.round(fb + (tb - fb) * ratio)
    return (r << 16) | (g << 8) | b
  }

  // ─── Visual feedback ───────────────────────────────────────────────────────

  private updateDrawFeedback(): void {
    this.drawGfx.clear()
    this.dustTick++

    const S = TILE_SIZE

    for (const t of this.drawPath) {
      const px = t.col * S; const py = t.row * S
      this.drawGfx.fillStyle(0xf5c842, 0.45)
      this.drawGfx.fillRect(px, py, S, S)
      this.drawGfx.lineStyle(2, 0xf5c842, 1)
      this.drawGfx.strokeRect(px + 1, py + 1, S - 2, S - 2)
    }

    for (const task of this.tunnelSystem.getQueue()) {
      const px = task.tileX * S; const py = task.tileY * S
      this.drawGfx.fillStyle(0xf59342, 0.25)
      this.drawGfx.fillRect(px, py, S, S)
      this.strokeDashed(px, py, S, S, 0xf59342)
    }

    const active = this.tunnelSystem.getActive()
    if (active) {
      const px = active.tileX * S; const py = active.tileY * S
      const pulse = 0.3 + 0.2 * Math.sin(this.dustTick * 0.15)
      this.drawGfx.fillStyle(0xf59342, pulse)
      this.drawGfx.fillRect(px, py, S, S)

      const barW = S - 4; const barH = 4
      const bx = px + 2;  const by = py + S - barH - 2
      this.drawGfx.fillStyle(0x111111, 0.8)
      this.drawGfx.fillRect(bx, by, barW, barH)
      this.drawGfx.fillStyle(0x44ee44, 1)
      this.drawGfx.fillRect(bx, by, barW * active.progress / 100, barH)

      if (this.dustTick % 3 === 0) {
        for (let i = 0; i < 3; i++) {
          const rx = px + Math.random() * S
          const ry = py + Math.random() * S
          this.drawGfx.fillStyle(0xd4a054, 0.3 + Math.random() * 0.5)
          this.drawGfx.fillCircle(rx, ry, 1 + Math.random() * 2)
        }
      }
    }
  }

  private strokeDashed(x: number, y: number, w: number, h: number, color: number): void {
    const DASH = 5; const GAP = 3
    this.drawGfx.lineStyle(1.5, color, 0.85)
    const seg = (x1: number, y1: number, dx: number, dy: number, len: number) => {
      let p = 0
      while (p < len) {
        const e = Math.min(p + DASH, len)
        this.drawGfx.lineBetween(x1 + dx * p, y1 + dy * p, x1 + dx * e, y1 + dy * e)
        p += DASH + GAP
      }
    }
    seg(x,     y,     1,  0, w)
    seg(x + w, y,     0,  1, h)
    seg(x + w, y + h, -1, 0, w)
    seg(x,     y + h, 0, -1, h)
  }

  // ─── Ant rendering ─────────────────────────────────────────────────────────

  private renderAnts(): void {
    this.antGfx.clear()
    for (const ant of [...this.playerColony.ants, ...this.aiColony.ants]) {
      const isWorker = ant.type === AntType.WORKER
      const isPlayer = this.playerColony.ants.includes(ant)
      const color    = ant.state === AntState.DEAD ? 0x777777 : (isWorker ? (isPlayer ? 0xcc8833 : 0x888833) : (isPlayer ? 0xcc3344 : 0x6633cc))
      const radius   = isWorker ? 5 : 7
      this.antGfx.fillStyle(color, ant.state === AntState.DEAD ? 0.55 : 1)
      this.antGfx.fillCircle(ant.x, ant.y, radius)
      if (ant.carryingResource) {
        this.antGfx.fillStyle(0xffdd66, 1)
        this.antGfx.fillRect(ant.x - 3, ant.y - 3, 6, 6)
      }

      if (ant.hp < ant.maxHp && ant.state !== AntState.DEAD) {
        const bw = 14; const bh = 2
        const bx = ant.x - bw / 2; const by = ant.y - radius - 5
        this.antGfx.fillStyle(0x330000, 1); this.antGfx.fillRect(bx, by, bw, bh)
        this.antGfx.fillStyle(0x00cc44, 1); this.antGfx.fillRect(bx, by, bw * (ant.hp / ant.maxHp), bh)
      }

      if (ant.state === AntState.WORKING) {
        this.antGfx.fillStyle(0xffffff, 0.9)
        this.antGfx.fillCircle(ant.x, ant.y - radius - 3, 2.5)
      }
      if (ant.waitingForTunnel) {
        const warn = this.add.text(ant.x, ant.y - radius - 10, '⚠', {
          fontSize: '12px', color: '#ffcc44', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(8.6)
        this.pheroTextGroup.push(warn)
      }
    }
  }

  // ─── Game loop ─────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    const now = this.time.now
    this.updatePheromoneModeFromKeys()
    const cam   = this.cameras.main
    const speed = CAMERA_SCROLL_SPEED * (delta / 1000) / cam.zoom
    const inPheroPlacement = this.pheromoneSystem.mode !== null
    if (!inPheroPlacement) {
      if (this.cursors.left.isDown  || this.keyA.isDown) cam.scrollX -= speed
      if (this.cursors.right.isDown || this.keyD.isDown) cam.scrollX += speed
      if (this.cursors.up.isDown    || this.keyW.isDown) cam.scrollY -= speed
      if (this.cursors.down.isDown  || this.keyS.isDown) cam.scrollY += speed
    }

    this.tunnelSystem.update(
      delta,
      this.localColony,
      (c, r) => this.isPassable(c, r),
      (x, y) => this.completeTile(x, y)
    )

    const beforeSpawnIds = new Set(this.localColony.ants.map(a => a.id))
    this.localColony.update(delta, (c, r) => this.isPassable(c, r))
    if (!this.multiplayer) this.enemyColony.update(delta, (c, r) => this.isPassable(c, r))
    this.spawnSystem.update(this.localColony, now)
    if (!this.multiplayer) this.spawnSystem.update(this.enemyColony, now)
    for (const ant of this.localColony.ants) {
      if (!beforeSpawnIds.has(ant.id) && this.multiplayer) {
        netplay.sendAction({ type: 'spawn', antType: ant.type, id: ant.id })
      }
    }
    this.updateCombat(now)
    this.pheromoneSystem.update(
      delta,
      this.localColony,
      this.enemyColony,
      this.resourceSystem,
      (c, r) => this.isPassable(c, r)
    )
    if (!this.multiplayer) {
      this.aiPheromoneSystem.update(
        delta,
        this.enemyColony,
        this.localColony,
        this.resourceSystem,
        (c, r) => this.isPassable(c, r)
      )
    }
    this.updateCorpseHandling()
    this.updateFrontLineAndAlerts(now)
    this.resourceSystem.update(
      now,
      delta,
      (c, r) => this.getTile(c, r),
      [...this.playerColony.buildings, ...this.aiColony.buildings],
      this.localColony,
      (c, r) => this.isPassable(c, r),
      false
    )
    if (this.multiplayer && this.localColony.resources.food > this.prevLocalFood) {
      netplay.sendAction({
        type: 'resource',
        resourceId: 'food',
        amount: Math.floor(this.localColony.resources.food - this.prevLocalFood),
      })
    }
    this.prevLocalFood = this.localColony.resources.food

    this.applyPendingRemoteActions()
    if (this.multiplayer) this.syncLocalMoves(now)
    for (const ant of this.enemyColony.ants) ant.updateNetworkInterpolation(delta)

    if (this.enemyColony.isDefeated()) {
      // Immediate player victory when enemy throne is down.
      this.scene.pause('UIScene')
      this.add.text(this.cameras.main.midPoint.x, this.cameras.main.midPoint.y, 'Victoire !', {
        fontSize: '48px', color: '#ffee66', fontFamily: 'monospace', stroke: '#000', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(50).setScrollFactor(0)
      this.scene.pause()
    }

    this.renderBuildings()
    this.renderResources(now)
    this.renderPheromones(now)
    this.renderCombatEffects(now)
    this.updateDrawFeedback()
    this.renderAnts()
  }

  // ─── Public helpers ────────────────────────────────────────────────────────

  getFrontlineCol(): number {
    return this.frontlineCol
  }

  getDangerOverlayText(): string {
    return this.isColonyInDanger ? 'Votre colonie est en danger !' : ''
  }

  getLagText(): string {
    if (!this.multiplayer) return ''
    return netplay.isLagging() ? 'LAG' : ''
  }

  activatePheromoneMode(kind: 'FOOD' | 'ATTACK' | 'RALLY'): void {
    this.pheromoneSystem.setMode(kind)
  }

  getPheromonePanelData(): {
    food: number
    attack: number
    rally: number
    warning: string
  } {
    return {
      food: this.pheromoneSystem.count('FOOD'),
      attack: this.pheromoneSystem.count('ATTACK'),
      rally: this.pheromoneSystem.count('RALLY'),
      warning: this.pheromoneSystem.warningMessage,
    }
  }

  getTile(col: number, row: number): number {
    if (row < 0 || row >= MAP_HEIGHT || col < 0 || col >= MAP_WIDTH) return -1
    return this.mapData[row][col]
  }

  digTile(col: number, row: number): boolean {
    if (this.getTile(col, row) !== T.DIRT) return false
    this.completeTile(col, row)
    return true
  }

  isPassable(col: number, row: number): boolean {
    const t = this.getTile(col, row)
    return t === T.TUNNEL || t === T.GRASS
  }
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
