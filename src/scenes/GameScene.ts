import Phaser from 'phaser'
import {
  MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_SCROLL_SPEED,
  TILE_COLORS, START_BASES, CANVAS_HEIGHT,
  BUILDING_CONFIG,
  BETA_SANDBOX_MAX_FOOD, BETA_SANDBOX_MAX_WOOD,
  BETA_SANDBOX_START_FOOD, BETA_SANDBOX_START_WOOD,
} from '../config/constants'
import { TileType, AntType, AntState } from '../types'
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
import { RESOURCE_SPECS } from '../entities/Resource'
import { PheromoneSystem, pheroColor, pheroIcon, pheroRadiusTiles, tileToWorld } from '../systems/PheromoneSystem'

const T = TileType

// No-rock buffer around each base
const BASE_GUARD_W = 13
const BASE_GUARD_H = 12
const HUD_H        = 90
const DIRT_VARIANT_COUNT = 16
const ROCK_VARIANT_COUNT = 12
const FLASH_MS = 200
const FOG_UPDATE_MS = 200
const STORAGE_WOOD_COST = 50

type HitFlash = { x: number; y: number; expiresAt: number }
type CorpseTask = { corpseId: string; workerId: string; phase: 'toCorpse' | 'toCemetery' }
type DigFlash = { tileX: number; tileY: number; expiresAt: number }

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
  private fogGfx!: Phaser.GameObjects.Graphics
  /** Reused labels — avoid creating/destroying Text every frame. */
  private pheroLabelById = new Map<string, { icon: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text }>()
  private resourceEmojiByKey = new Map<string, Phaser.GameObjects.Text>()
  private fogGfxDirty = true
  private buildingLabels = new Map<string, Phaser.GameObjects.Text>()
  private workerSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private warriorSprites = new Map<string, Phaser.GameObjects.Sprite>()
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
  /** Solo test : beaucoup de ressources, pas d’IA ni de combat. */
  betaSandbox = false
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
  private fogVisible: Uint8Array = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
  private fogExplored: Uint8Array = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
  private discoveredEnemyBuildingIds = new Set<string>()
  private discoveredResourceIds = new Set<string>()
  private lastFogRecalcAt = -FOG_UPDATE_MS
  private pendingSpawnSyncIds = new Set<string>()
  private buildModeOpen = false
  private placingStorage = false
  private buildPreviewCol = 0
  private buildPreviewRow = 0
  private buildPreviewGfx!: Phaser.GameObjects.Graphics
  private buildFloatingTexts: Phaser.GameObjects.Text[] = []
  private destroyedStorageReleased = new Set<string>()
  private diggerPanelOpen = false
  private digFlashes: DigFlash[] = []

  constructor() { super({ key: 'GameScene' }) }

  init(data: {
    role: 'host' | 'guest'
    seed?: number
    multiplayer?: boolean
    betaSandbox?: boolean
  }): void {
    if (data.betaSandbox) {
      this.betaSandbox = true
      this.role = 'host'
      this.multiplayer = false
    } else {
      this.betaSandbox = false
      this.role = data.role
      this.multiplayer = !!data.multiplayer
    }
    if (typeof data.seed === 'number') {
      this.mapSeed = data.seed
      this.seededRand = mulberry32(this.mapSeed)
    }
  }

  // ─── Assets ────────────────────────────────────────────────────────────────

  preload(): void {
    this.load.image('dirt-texture', '/dirt-texture.png')
    this.load.image('rock-texture', '/rock-texture.png')
    this.load.image('worker-ant-1', '/worker-ant-1.png')
    this.load.image('worker-ant-2', '/worker-ant-2.png')
    this.load.image('warrior-ant-1', '/warrior-ant-1.png')
    this.load.image('warrior-ant-2', '/warrior-ant-2.png')
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
    this.ensureWorkerAnimation()
    this.ensureWarriorAnimation()
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
    this.fogGfx      = this.add.graphics().setDepth(8.9)
    this.buildPreviewGfx = this.add.graphics().setDepth(9.2)

    this.setupCamera()
    this.setupInput()
    this.setupColonies()
    this.localColony = this.role === 'host' ? this.playerColony : this.aiColony
    this.enemyColony = this.role === 'host' ? this.aiColony : this.playerColony
    if (this.betaSandbox) {
      this.playerColony.enableSandboxResourceCaps(BETA_SANDBOX_MAX_FOOD, BETA_SANDBOX_MAX_WOOD)
      this.playerColony.resources.food = BETA_SANDBOX_START_FOOD
      this.playerColony.resources.wood = BETA_SANDBOX_START_WOOD
      this.aiColony.ants = []
    }
    this.recalculateFogOfWar(this.time.now)
    this.centerCameraOnLocalQueenThrone()
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
    } else if (!this.betaSandbox) {
      this.aiPheromoneSystem.addPoint('FOOD', this.aiColony.baseCol + 8, this.aiColony.baseDepth + 8)
      this.aiPheromoneSystem.addPoint('ATTACK', this.playerColony.baseCol + 6, this.playerColony.baseDepth + 6)
    }
    this.events.once('shutdown', () => {
      for (const sprite of this.workerSprites.values()) sprite.destroy()
      for (const sprite of this.warriorSprites.values()) sprite.destroy()
      for (const label of this.buildingLabels.values()) label.destroy()
      for (const t of this.buildFloatingTexts) t.destroy()
      for (const pair of this.pheroLabelById.values()) {
        pair.icon.destroy()
        pair.badge.destroy()
      }
      for (const t of this.resourceEmojiByKey.values()) t.destroy()
      this.workerSprites.clear()
      this.warriorSprites.clear()
      this.buildingLabels.clear()
      this.buildFloatingTexts = []
      this.pheroLabelById.clear()
      this.resourceEmojiByKey.clear()
    })
    this.scene.launch('UIScene')
  }

  private centerCameraOnLocalQueenThrone(): void {
    const myColony = this.role === 'host' ? this.playerColony : this.aiColony
    const throne = myColony.getQueenThrone()
    if (!throne) return
    const x = (throne.tileX + throne.width / 2) * TILE_SIZE
    const y = (throne.tileY + throne.height / 2) * TILE_SIZE
    this.cameras.main.centerOn(x, y)
  }

  private ensureWorkerAnimation(): void {
    if (this.anims.exists('worker-ant-walk')) return
    this.anims.create({
      key: 'worker-ant-walk',
      frames: [{ key: 'worker-ant-1' }, { key: 'worker-ant-2' }],
      frameRate: 6,
      repeat: -1,
    })
  }

  private ensureWarriorAnimation(): void {
    if (this.anims.exists('warrior-ant-walk')) return
    this.anims.create({
      key: 'warrior-ant-walk',
      frames: [{ key: 'warrior-ant-1' }, { key: 'warrior-ant-2' }],
      frameRate: 7,
      repeat: -1,
    })
  }

  private syncWorkerSprites(now: number): void {
    const workerIds = new Set<string>()
    const enemyAntIds = new Set(this.enemyColony.ants.map(a => a.id))
    for (const ant of [...this.playerColony.ants, ...this.aiColony.ants]) {
      if (ant.type !== AntType.WORKER) continue
      workerIds.add(ant.id)
      let sprite = this.workerSprites.get(ant.id)
      if (!sprite) {
        sprite = this.add.sprite(ant.x, ant.y, 'worker-ant-1').setDepth(7.1)
        sprite.setScale(1.25)
        sprite.play('worker-ant-walk')
        this.workerSprites.set(ant.id, sprite)
      }
      const prevX = (sprite.getData('prevX') as number | undefined) ?? ant.x
      if (Math.abs(ant.x - prevX) > 0.1) sprite.setFlipX(ant.x < prevX)
      sprite.setData('prevX', ant.x)
      const wobble = ant.digTarget && ant.state === AntState.WORKING
      const jSeed = ant.id.length * 17 + ant.id.charCodeAt(0)
      const jitterX = wobble ? Math.sin(now * 0.011 + jSeed) * 1.1 : 0
      const jitterY = wobble ? Math.cos(now * 0.013 + jSeed * 2) * 1.1 : 0
      sprite.setPosition(ant.x + jitterX, ant.y + jitterY)
      if (enemyAntIds.has(ant.id)) sprite.setVisible(this.isTileVisible(ant.col, ant.row))
      else sprite.setVisible(true)
      sprite.setAlpha(ant.state === AntState.DEAD ? 0.45 : 1)
      if (ant.state === AntState.DEAD) sprite.stop()
      else if (!sprite.anims.isPlaying) sprite.play('worker-ant-walk')
    }

    for (const [id, sprite] of this.workerSprites.entries()) {
      if (workerIds.has(id)) continue
      sprite.destroy()
      this.workerSprites.delete(id)
    }
  }

  private syncWarriorSprites(): void {
    const warriorIds = new Set<string>()
    const enemyAntIds = new Set(this.enemyColony.ants.map(a => a.id))
    for (const ant of [...this.playerColony.ants, ...this.aiColony.ants]) {
      if (ant.type !== AntType.WARRIOR) continue
      warriorIds.add(ant.id)
      let sprite = this.warriorSprites.get(ant.id)
      if (!sprite) {
        sprite = this.add.sprite(ant.x, ant.y, 'warrior-ant-1').setDepth(7.1)
        sprite.setScale(1.35)
        sprite.play('warrior-ant-walk')
        this.warriorSprites.set(ant.id, sprite)
      }
      const prevX = (sprite.getData('prevX') as number | undefined) ?? ant.x
      if (Math.abs(ant.x - prevX) > 0.1) sprite.setFlipX(ant.x < prevX)
      sprite.setData('prevX', ant.x)
      sprite.setPosition(ant.x, ant.y)
      if (enemyAntIds.has(ant.id)) sprite.setVisible(this.isTileVisible(ant.col, ant.row))
      else sprite.setVisible(true)
      sprite.setAlpha(ant.state === AntState.DEAD ? 0.45 : 1)
      if (ant.state === AntState.DEAD) sprite.stop()
      else if (!sprite.anims.isPlaying) sprite.play('warrior-ant-walk')
    }

    for (const [id, sprite] of this.warriorSprites.entries()) {
      if (warriorIds.has(id)) continue
      sprite.destroy()
      this.warriorSprites.delete(id)
    }
  }

  // ─── Colonies & buildings ──────────────────────────────────────────────────

  private setupColonies(): void {
    this.playerColony = new Colony('PLAYER1', 0)
    this.aiColony     = new Colony('PLAYER2', 1)

    this.playerColony.initColony()
    this.aiColony.initColony()

    this.placeBuildings(this.playerColony)
    this.placeBuildings(this.aiColony)
  }

  private placeBuildings(colony: Colony): void {
    for (const building of colony.buildings) {
      this.placeBuildingLabel(building)
    }
  }

  private placeBuildingLabel(building: Building): void {
    const cfg = BUILDING_CONFIG[building.type]
    const px = building.tileX * TILE_SIZE + (cfg.width * TILE_SIZE) / 2
    const py = building.tileY * TILE_SIZE + (cfg.height * TILE_SIZE) / 2
    const label = this.add.text(px, py, cfg.label, {
      fontSize: '8px', color: '#ffffff', fontFamily: 'monospace',
      align: 'center', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0.5).setDepth(8)
    this.buildingLabels.set(building.id, label)
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
    for (const colony of [this.playerColony, this.aiColony]) {
      for (const ant of colony.ants) {
        if (ant.hasPathTile(tileX, tileY)) ant.clearPath()
      }
    }
    this.invalidatePheroTrailCaches()
    if (this.multiplayer) netplay.sendAction({ type: 'tunnel', x: tileX, y: tileY })
  }

  private invalidatePheroTrailCaches(): void {
    this.pheromoneSystem.invalidateTrailCache()
    this.aiPheromoneSystem.invalidateTrailCache()
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
      this.buildPreviewCol = col
      this.buildPreviewRow = row
      this.updatePheromoneModeFromKeys()

      if (this.placingStorage) {
        this.confirmStoragePlacement(col, row)
        return
      }

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
      this.buildPreviewCol = col
      this.buildPreviewRow = row
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
      if (this.placingStorage) this.cancelStoragePlacement()
      else if (this.isDrawing) this.cancelDraw()
      else this.selectedBuilding = null
    })
    this.input.keyboard!.on('keydown-B', () => {
      this.toggleBuildModePanel()
    })
    this.input.keyboard!.on('keydown-D', (event: KeyboardEvent) => {
      if (event.repeat) return
      this.toggleDiggersPanel()
    })
    this.input.keyboard!.on('keydown-DELETE',    () => this.pheromoneSystem.clearAll())
    this.input.keyboard!.on('keydown-BACKSPACE', () => this.pheromoneSystem.clearAll())
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

    const pulse = 1 + 0.15 * (0.5 + 0.5 * Math.sin(now / 750))
    const center = this.localColony.getDropoffBuilding()
    const nestCol = center ? center.tileX + 1 : this.localColony.baseCol + 3
    const nestRow = center ? center.tileY + 1 : this.localColony.baseDepth
    const pointer = this.input.activePointer
    this.updatePheromoneModeFromKeys()

    const seenPheroIds = new Set<string>()
    for (const p of this.pheromoneSystem.points) {
      seenPheroIds.add(p.id)
      const { x, y } = tileToWorld(p.col, p.row)
      const color = pheroColor(p.kind)
      this.pheroGfx.fillStyle(color, 0.85)
      this.pheroGfx.fillCircle(x, y, 24)
      this.pheroGfx.lineStyle(2, color, 0.9)
      this.pheroGfx.strokeCircle(x, y, 24 * pulse)

      let labels = this.pheroLabelById.get(p.id)
      if (!labels) {
        labels = {
          icon: this.add.text(x, y, pheroIcon(p.kind), {
            fontSize: '18px', color: '#ffffff', fontFamily: 'monospace', stroke: '#000', strokeThickness: 4,
          }).setOrigin(0.5).setDepth(8.5),
          badge: this.add.text(x + 18, y - 18, '', {
            fontSize: '12px', color: '#111', backgroundColor: '#fff', fontFamily: 'monospace',
          }).setOrigin(0.5).setDepth(8.5),
        }
        this.pheroLabelById.set(p.id, labels)
      }
      labels.icon.setText(pheroIcon(p.kind))
      labels.icon.setPosition(x, y)
      labels.badge.setPosition(x + 18, y - 18)
      labels.badge.setText(`×${this.pheromoneSystem.assignedCounts.get(p.id) ?? 0}`)

      if (this.hoveredPheroId === p.id && pheroRadiusTiles(p.kind) > 0) {
        this.drawDashedCircle(this.pheroGfx, x, y, pheroRadiusTiles(p.kind) * TILE_SIZE, color)
      }

      const path = this.pheromoneSystem.getTrailPath(
        nestCol, nestRow, p.col, p.row,
        (c, r) => this.isPassable(c, r),
        p.id
      )
      this.drawDashedTrail(path, color, this.pheromoneSystem.dashOffset)
    }

    for (const id of [...this.pheroLabelById.keys()]) {
      if (seenPheroIds.has(id)) continue
      const pair = this.pheroLabelById.get(id)!
      pair.icon.destroy()
      pair.badge.destroy()
      this.pheroLabelById.delete(id)
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
      if (!Number.isFinite(len) || len <= 0.0001) continue
      const dash = 8; const gap = 6
      let p = -offset
      let guard = 0
      while (p < len && guard++ < 256) {
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
    if (this.betaSandbox) return
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
          this.invalidatePheroTrailCaches()
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
        if (ant) {
          const col = Math.floor(action.x / TILE_SIZE)
          const row = Math.floor(action.y / TILE_SIZE)
          if (this.isTileVisible(col, row)) ant.setNetworkTarget(action.x, action.y)
        }
      } else if (action.type === 'resource') {
        this.enemyColony.resources.food = Math.min(this.enemyColony.maxFood, this.enemyColony.resources.food + action.amount)
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
      if (!this.isTileVisibleToEnemy(ant.col, ant.row)) continue
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
      const isEnemy = this.enemyColony.buildings.includes(b)
      if (isEnemy) {
        if (this.isBuildingExplored(b)) this.discoveredEnemyBuildingIds.add(b.id)
        const known = this.discoveredEnemyBuildingIds.has(b.id)
        const label = this.buildingLabels.get(b.id)
        if (label) label.setVisible(known)
        if (!known) continue
      }
      const label = this.buildingLabels.get(b.id)
      if (label) label.setVisible(true)
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
    const seenEmojiKeys = new Set<string>()
    for (const resource of this.resourceSystem.resources) {
      const isVisibleNow = resource.tiles.some(t => this.isTileVisible(t.col, t.row))
      if (isVisibleNow) this.discoveredResourceIds.add(resource.id)
      if (!this.discoveredResourceIds.has(resource.id)) continue
      const life = Phaser.Math.Clamp((resource.expiresAt - now) / (resource.expiresAt - resource.spawnedAt), 0, 1)
      const color = this.blendColor(resource.color, 0x444444, 1 - life)
      let ti = 0
      for (const tile of resource.tiles) {
        const px = tile.col * S
        const py = tile.row * S
        this.resourceGfx.fillStyle(color, 0.8)
        this.resourceGfx.fillRect(px + 4, py + 4, S - 8, S - 8)
        this.resourceGfx.lineStyle(1.5, 0x111111, 0.7)
        this.resourceGfx.strokeRect(px + 4, py + 4, S - 8, S - 8)
        this.drawResourceIcon(resource.type, px + S / 2, py + S / 2)
        if (
          resource.type === ResourceType.TWIG_PILE ||
          resource.type === ResourceType.BRANCH ||
          resource.type === ResourceType.LEAF_PILE
        ) {
          const ek = `${resource.id}-${ti++}`
          seenEmojiKeys.add(ek)
          let txt = this.resourceEmojiByKey.get(ek)
          if (!txt) {
            txt = this.add.text(px + S / 2, py + S / 2, '🪵', {
              fontSize: '13px', color: '#ffffff', fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(6.7)
            this.resourceEmojiByKey.set(ek, txt)
          }
          txt.setPosition(px + S / 2, py + S / 2)
          txt.setVisible(true)
        }
      }

      if (resource.threatLevel > 0 || resource.guardianCount > 0) {
        const marker = resource.tiles[0]
        this.resourceGfx.fillStyle(0xcc3333, 1)
        this.resourceGfx.fillCircle(marker.col * S + S * 0.8, marker.row * S + S * 0.2, 4)
      }

      const marker = resource.tiles[0]
      const initialFood = Math.max(1, RESOURCE_SPECS[resource.type].food)
      const ratio = Phaser.Math.Clamp(resource.foodAmount / initialFood, 0, 1)
      const bw = S * 1.6
      const bh = 4
      const bx = marker.col * S + (S - bw) / 2
      const by = marker.row * S - 7
      this.resourceGfx.fillStyle(0x111111, 0.85)
      this.resourceGfx.fillRect(bx, by, bw, bh)
      this.resourceGfx.fillStyle(0x66dd66, 0.95)
      this.resourceGfx.fillRect(bx, by, bw * ratio, bh)
    }

    for (const ek of [...this.resourceEmojiByKey.keys()]) {
      if (seenEmojiKeys.has(ek)) continue
      this.resourceEmojiByKey.get(ek)!.destroy()
      this.resourceEmojiByKey.delete(ek)
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
      case ResourceType.TWIG_PILE:
        this.resourceGfx.fillRect(x - 4, y - 1, 8, 2)
        break
      case ResourceType.BRANCH:
        this.resourceGfx.fillRect(x - 5, y - 1, 10, 2)
        this.resourceGfx.fillRect(x - 2, y - 3, 2, 6)
        break
      case ResourceType.LEAF_PILE:
        this.resourceGfx.fillTriangle(x - 3, y + 3, x + 3, y + 3, x, y - 3)
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
      if (task.progress <= 0) {
        this.drawGfx.fillStyle(0xf59342, 0.22)
        this.drawGfx.fillRect(px, py, S, S)
        this.strokeDashed(px, py, S, S, 0xf59342)
        continue
      }
      const pulse = 0.3 + 0.2 * Math.sin(this.dustTick * 0.15)
      this.drawGfx.fillStyle(0xf59342, pulse)
      this.drawGfx.fillRect(px, py, S, S)
      const barW = S - 4; const barH = 4
      const bx = px + 2;  const by = py + S - barH - 2
      this.drawGfx.fillStyle(0x111111, 0.8)
      this.drawGfx.fillRect(bx, by, barW, barH)
      this.drawGfx.fillStyle(0x44ee44, 1)
      this.drawGfx.fillRect(bx, by, barW * task.progress / 100, barH)
      if (this.dustTick % 3 === 0) {
        for (let i = 0; i < 4; i++) {
          const rx = px + Math.random() * S
          const ry = py + Math.random() * S
          this.drawGfx.fillStyle(0xd4a054, 0.3 + Math.random() * 0.5)
          this.drawGfx.fillRect(rx, ry, 2, 2)
        }
      }
    }
    this.digFlashes = this.digFlashes.filter(f => f.expiresAt > this.time.now)
    for (const f of this.digFlashes) {
      this.drawGfx.fillStyle(0xffffff, 0.55)
      this.drawGfx.fillRect(f.tileX * S, f.tileY * S, S, S)
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
      const isEnemy = this.enemyColony.ants.includes(ant)
      if (isEnemy && !this.isTileVisible(ant.col, ant.row)) continue
      const isWorker = ant.type === AntType.WORKER
      const radius   = isWorker ? 5 : 7
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
        const wy = ant.y - radius - 10
        this.antGfx.fillStyle(0xffcc44, 1)
        this.antGfx.fillTriangle(ant.x, wy - 6, ant.x - 6, wy + 4, ant.x + 6, wy + 4)
        this.antGfx.lineStyle(1.5, 0x000000, 0.85)
        this.antGfx.strokeTriangle(ant.x, wy - 6, ant.x - 6, wy + 4, ant.x + 6, wy + 4)
      }
    }
  }

  // ─── Game loop ─────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    const dt = Math.min(Math.max(0, delta), 80)
    const now = this.time.now
    if (now - this.lastFogRecalcAt >= FOG_UPDATE_MS) this.recalculateFogOfWar(now)
    this.updatePheromoneModeFromKeys()
    const cam   = this.cameras.main
    const speed = CAMERA_SCROLL_SPEED * (dt / 1000) / cam.zoom
    const inPheroPlacement = this.pheromoneSystem.mode !== null
    const inBuildPlacement = this.placingStorage
    if (!inPheroPlacement && !inBuildPlacement) {
      if (this.cursors.left.isDown  || this.keyA.isDown) cam.scrollX -= speed
      if (this.cursors.right.isDown || this.keyD.isDown) cam.scrollX += speed
      if (this.cursors.up.isDown    || this.keyW.isDown) cam.scrollY -= speed
      if (this.cursors.down.isDown  || this.keyS.isDown) cam.scrollY += speed
    }

    this.tunnelSystem.update(
      dt,
      this.localColony,
      (c, r) => this.isPassable(c, r),
      (x, y) => {
        this.completeTile(x, y)
        this.digFlashes.push({ tileX: x, tileY: y, expiresAt: this.time.now + 180 })
      }
    )

    const beforeSpawnIds = new Set(this.localColony.ants.map(a => a.id))
    this.localColony.update(dt, (c, r) => this.isPassable(c, r))
    if (!this.multiplayer && !this.betaSandbox) this.enemyColony.update(dt, (c, r) => this.isPassable(c, r))
    this.spawnSystem.update(this.localColony, now, false)
    if (!this.multiplayer && !this.betaSandbox) this.spawnSystem.update(this.enemyColony, now, true)
    for (const ant of this.localColony.ants) {
      if (!beforeSpawnIds.has(ant.id) && this.multiplayer) {
        if (this.isTileVisibleToEnemy(ant.col, ant.row)) netplay.sendAction({ type: 'spawn', antType: ant.type, id: ant.id })
        else this.pendingSpawnSyncIds.add(ant.id)
      }
    }
    if (this.multiplayer) this.flushPendingSpawnSync()
    this.updateCombat(now)
    this.releaseDestroyedStorageTiles()
    this.pheromoneSystem.update(
      dt,
      now,
      this.localColony,
      this.enemyColony,
      this.resourceSystem,
      (c, r) => this.isPassable(c, r)
    )
    if (!this.multiplayer && !this.betaSandbox) {
      this.aiPheromoneSystem.update(
        dt,
        now,
        this.enemyColony,
        this.localColony,
        this.resourceSystem,
        (c, r) => this.isPassable(c, r)
      )
    }
    if (!this.betaSandbox) this.updateCorpseHandling()
    this.updateFrontLineAndAlerts(now)
    this.resourceSystem.update(
      now,
      dt,
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
    this.syncWorkerSprites(now)
    this.syncWarriorSprites()

    if (!this.betaSandbox && this.enemyColony.isDefeated()) {
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
    this.renderBuildPlacementPreview()
    this.renderFogOfWar()
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

  getSpawnWarningText(): string {
    return this.spawnSystem.getWarning(this.localColony, this.time.now)
  }

  getStorageWarningText(): string {
    return this.localColony.getStorageWarning(this.time.now)
  }

  getConstructionData(): {
    open: boolean
    storageCost: number
    canAffordStorage: boolean
    tooltip: string
    placingStorage: boolean
  } {
    const canAfford = this.localColony.resources.wood >= STORAGE_WOOD_COST
    return {
      open: this.buildModeOpen,
      storageCost: STORAGE_WOOD_COST,
      canAffordStorage: canAfford,
      tooltip: canAfford ? '' : '50 bois requis',
      placingStorage: this.placingStorage,
    }
  }

  getDiggersData(): {
    open: boolean
    assigned: number
    max: number
    queue: number
    estimateSec: number
    activeDiggers: number
  } {
    return {
      open: this.diggerPanelOpen,
      assigned: this.tunnelSystem.getDedicatedWorkers(),
      max: this.localColony.workerCount,
      queue: this.tunnelSystem.queueLength,
      estimateSec: this.tunnelSystem.getEstimatedSeconds(this.localColony),
      activeDiggers: this.tunnelSystem.getActiveDiggersCount(this.localColony),
    }
  }

  toggleDiggersPanel(): void {
    this.diggerPanelOpen = !this.diggerPanelOpen
  }

  changeDiggers(delta: number): void {
    const next = Math.max(0, Math.min(this.localColony.workerCount, this.tunnelSystem.getDedicatedWorkers() + delta))
    this.tunnelSystem.setDedicatedWorkers(next)
  }

  toggleBuildModePanel(): void {
    this.buildModeOpen = !this.buildModeOpen
    if (!this.buildModeOpen) this.cancelStoragePlacement()
  }

  activateStoragePlacement(): void {
    this.buildModeOpen = true
    if (this.localColony.resources.wood < STORAGE_WOOD_COST) return
    this.placingStorage = true
    this.pheromoneSystem.setMode(null)
    this.cancelDraw()
  }

  cancelStoragePlacement(): void {
    this.placingStorage = false
    this.buildPreviewGfx.clear()
  }

  activatePheromoneMode(kind: 'FOOD' | 'ATTACK' | 'RALLY'): void {
    this.cancelStoragePlacement()
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
    return t === T.TUNNEL || t === T.GRASS || t === T.BUILDING
  }

  private canPlaceStorageAt(col: number, row: number): boolean {
    const cfg = BUILDING_CONFIG.STORAGE
    if (col < 0 || row < 0 || col + cfg.width > MAP_WIDTH || row + cfg.height > MAP_HEIGHT) return false
    for (let y = row; y < row + cfg.height; y++) {
      for (let x = col; x < col + cfg.width; x++) {
        if (this.getTile(x, y) !== T.TUNNEL) return false
        if (this.findBuildingAt(x, y)) return false
      }
    }
    return true
  }

  private confirmStoragePlacement(col: number, row: number): void {
    if (!this.placingStorage) return
    if (this.localColony.resources.wood < STORAGE_WOOD_COST) return
    if (!this.canPlaceStorageAt(col, row)) return
    this.localColony.resources.wood -= STORAGE_WOOD_COST
    const cfg = BUILDING_CONFIG.STORAGE
    const building = new Building('STORAGE', col, row, cfg.width, cfg.height, this.localColony.side, cfg.hp)
    this.localColony.addBuilding(building)
    this.placeBuildingLabel(building)
    for (let y = row; y < row + cfg.height; y++) {
      for (let x = col; x < col + cfg.width; x++) {
        this.mapData[y][x] = T.BUILDING
        this.tilemapLayer.putTileAt(T.BUILDING, x, y)
      }
    }
    const text = this.add.text((col + 1.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE, '+500 🍖 +100 🪵', {
      fontSize: '14px', color: '#66ff88', fontFamily: 'monospace', stroke: '#002200', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(9.4)
    this.buildFloatingTexts.push(text)
    this.time.delayedCall(1200, () => {
      text.destroy()
      this.buildFloatingTexts = this.buildFloatingTexts.filter(t => t !== text)
    })
    this.cancelStoragePlacement()
    this.buildModeOpen = false
  }

  private renderBuildPlacementPreview(): void {
    this.buildPreviewGfx.clear()
    if (!this.placingStorage) return
    const cfg = BUILDING_CONFIG.STORAGE
    const valid = this.canPlaceStorageAt(this.buildPreviewCol, this.buildPreviewRow)
    const color = valid ? 0x44dd66 : 0xdd4444
    this.buildPreviewGfx.lineStyle(2, color, 0.95)
    this.buildPreviewGfx.fillStyle(color, 0.18)
    this.buildPreviewGfx.fillRect(this.buildPreviewCol * TILE_SIZE, this.buildPreviewRow * TILE_SIZE, cfg.width * TILE_SIZE, cfg.height * TILE_SIZE)
    this.buildPreviewGfx.strokeRect(this.buildPreviewCol * TILE_SIZE, this.buildPreviewRow * TILE_SIZE, cfg.width * TILE_SIZE, cfg.height * TILE_SIZE)
  }

  private releaseDestroyedStorageTiles(): void {
    for (const b of [...this.playerColony.buildings, ...this.aiColony.buildings]) {
      if (b.type !== 'STORAGE' || b.isAlive() || this.destroyedStorageReleased.has(b.id)) continue
      for (let y = b.tileY; y < b.tileY + b.height; y++) {
        for (let x = b.tileX; x < b.tileX + b.width; x++) {
          if (this.mapData[y][x] === T.BUILDING) {
            this.mapData[y][x] = T.TUNNEL
            this.tilemapLayer.putTileAt(T.TUNNEL, x, y)
          }
        }
      }
      this.destroyedStorageReleased.add(b.id)
    }
  }

  private fogIdx(col: number, row: number): number {
    return row * MAP_WIDTH + col
  }

  private isTileVisible(col: number, row: number): boolean {
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return false
    return this.fogVisible[this.fogIdx(col, row)] === 1
  }

  private isTileExplored(col: number, row: number): boolean {
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return false
    return this.fogExplored[this.fogIdx(col, row)] === 1
  }

  private isBuildingExplored(building: Building): boolean {
    for (let y = building.tileY; y < building.tileY + building.height; y++) {
      for (let x = building.tileX; x < building.tileX + building.width; x++) {
        if (this.isTileExplored(x, y)) return true
      }
    }
    return false
  }

  private revealCircle(centerCol: number, centerRow: number, radiusTiles: number): void {
    const r2 = radiusTiles * radiusTiles
    for (let y = centerRow - radiusTiles; y <= centerRow + radiusTiles; y++) {
      for (let x = centerCol - radiusTiles; x <= centerCol + radiusTiles; x++) {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) continue
        const dx = x - centerCol
        const dy = y - centerRow
        if ((dx * dx + dy * dy) > r2) continue
        const idx = this.fogIdx(x, y)
        this.fogVisible[idx] = 1
        this.fogExplored[idx] = 1
      }
    }
  }

  private recalculateFogOfWar(now: number): void {
    this.lastFogRecalcAt = now
    this.fogVisible.fill(0)
    const localThrone = this.localColony.getQueenThrone()
    if (localThrone) this.revealCircle(localThrone.tileX + Math.floor(localThrone.width / 2), localThrone.tileY + Math.floor(localThrone.height / 2), 8)
    for (const ant of this.localColony.ants) {
      if (ant.state !== AntState.DEAD) this.revealCircle(ant.col, ant.row, 4)
    }
    for (const b of this.localColony.buildings) {
      if (!b.isAlive()) continue
      this.revealCircle(b.tileX + Math.floor(b.width / 2), b.tileY + Math.floor(b.height / 2), 5)
    }
    this.fogGfxDirty = true
  }

  private renderFogOfWar(): void {
    if (!this.fogGfxDirty) return
    this.fogGfx.clear()
    for (let row = 0; row < MAP_HEIGHT; row++) {
      let runStart = -1
      let runAlpha = 0
      const flush = (endCol: number) => {
        if (runStart < 0) return
        this.fogGfx.fillStyle(0x000000, runAlpha)
        this.fogGfx.fillRect(runStart * TILE_SIZE, row * TILE_SIZE, (endCol - runStart) * TILE_SIZE, TILE_SIZE)
        runStart = -1
      }
      for (let col = 0; col < MAP_WIDTH; col++) {
        if (this.isTileVisible(col, row)) { flush(col); continue }
        const alpha = this.isTileExplored(col, row) ? 0.5 : 1
        if (runStart >= 0 && alpha !== runAlpha) flush(col)
        if (runStart < 0) { runStart = col; runAlpha = alpha }
      }
      flush(MAP_WIDTH)
    }
    this.fogGfxDirty = false
  }

  private isTileVisibleToEnemy(col: number, row: number): boolean {
    const throne = this.enemyColony.getQueenThrone()
    const visionFrom = (x: number, y: number, r: number): boolean => (x - col) * (x - col) + (y - row) * (y - row) <= r * r
    if (throne && visionFrom(throne.tileX + Math.floor(throne.width / 2), throne.tileY + Math.floor(throne.height / 2), 8)) return true
    for (const ant of this.enemyColony.ants) {
      if (ant.state !== AntState.DEAD && visionFrom(ant.col, ant.row, 4)) return true
    }
    for (const b of this.enemyColony.buildings) {
      if (!b.isAlive()) continue
      if (visionFrom(b.tileX + Math.floor(b.width / 2), b.tileY + Math.floor(b.height / 2), 5)) return true
    }
    return false
  }

  private flushPendingSpawnSync(): void {
    for (const id of [...this.pendingSpawnSyncIds]) {
      const ant = this.localColony.ants.find(a => a.id === id)
      if (!ant) {
        this.pendingSpawnSyncIds.delete(id)
        continue
      }
      if (!this.isTileVisibleToEnemy(ant.col, ant.row)) continue
      netplay.sendAction({ type: 'spawn', antType: ant.type, id: ant.id })
      this.pendingSpawnSyncIds.delete(id)
    }
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
