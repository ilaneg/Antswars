import Phaser from 'phaser'
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT } from '../config/constants'
import { ResourceType } from '../types'
import { RESOURCE_SPECS } from '../entities/Resource'
import type { GameScene } from './GameScene'

const HUD_H    = 90
const HUD_TOP  = CANVAS_HEIGHT - HUD_H       // 630

// Layout zones (x ranges)
const ZONE_L_END  = 220   // left:  construction
const ZONE_C_START= 220   // center: stats/slider
const ZONE_C_END  = 880
const ZONE_R_END  = 1128  // mini-map starts here
const MM_X        = ZONE_R_END + 2   // 1130
const MM_W        = 148
const MM_H        = 74

const SLIDER_CX = (ZONE_C_START + ZONE_C_END) / 2    // ~550
const SLIDER_W  = 260
const SLIDER_Y  = CANVAS_HEIGHT - 18
const SLIDER_L  = SLIDER_CX - SLIDER_W / 2
const SLIDER_R  = SLIDER_CX + SLIDER_W / 2

const BUILDING_LABELS: Record<string, string> = {
  EGG_CHAMBER:     'Chambre des Œufs',
  QUEEN_THRONE:    'Trône de la Reine',
  RESOURCE_CENTER: 'Centre de Réserves',
  CEMETERY:        'Cimetière',
  STORAGE:         'Entrepôt',
}

export class UIScene extends Phaser.Scene {
  private thumb!:           Phaser.GameObjects.Rectangle
  private statsText!:       Phaser.GameObjects.Text
  private ratioText!:       Phaser.GameObjects.Text
  private queueText!:       Phaser.GameObjects.Text
  private clearBtn!:        Phaser.GameObjects.Text
  private bldPanel!:        Phaser.GameObjects.Text
  private foodText!:        Phaser.GameObjects.Text
  private woodText!:        Phaser.GameObjects.Text
  private minimapGfx!:      Phaser.GameObjects.Graphics
  private dangerText!:      Phaser.GameObjects.Text
  private lagText!:         Phaser.GameObjects.Text
  private spawnWarnText!:   Phaser.GameObjects.Text
  private storageWarnText!: Phaser.GameObjects.Text
  private pheroPanel!:      Phaser.GameObjects.Text
  private pheroFoodBtn!:    Phaser.GameObjects.Text
  private pheroAttackBtn!:  Phaser.GameObjects.Text
  private pheroRallyBtn!:   Phaser.GameObjects.Text
  private buildBtn!:        Phaser.GameObjects.Text
  private buildPanel!:      Phaser.GameObjects.Text
  private storageBuildBtn!: Phaser.GameObjects.Text
  private buildTooltip!:    Phaser.GameObjects.Text
  private diggersBtn!:      Phaser.GameObjects.Text
  private diggersPanel!:    Phaser.GameObjects.Text
  private diggersMinusBtn!: Phaser.GameObjects.Text
  private diggersPlusBtn!:  Phaser.GameObjects.Text
  private soundBtn!:        Phaser.GameObjects.Text
  private betaBanner!:      Phaser.GameObjects.Text
  private ambientSound: Phaser.Sound.BaseSound | null = null
  private ambientMuted = false

  private warriorPct = 30

  constructor() { super({ key: 'UIScene' }) }

  preload(): void {
    this.load.audio('bgm-main', '/aria-math-cover.mp3')
  }

  create(): void {
    this.cameras.main.setScroll(0, 0)

    // ── HUD background ──────────────────────────────────────────────────────
    const bg = this.add.graphics()
    bg.fillStyle(0x000000, 0.82)
    bg.fillRect(0, HUD_TOP, CANVAS_WIDTH, HUD_H)
    bg.lineStyle(1, 0x553300, 0.7)
    bg.lineBetween(0, HUD_TOP, CANVAS_WIDTH, HUD_TOP)
    // Zone separators
    bg.lineStyle(1, 0x332211, 0.4)
    bg.lineBetween(ZONE_L_END, HUD_TOP + 4, ZONE_L_END, HUD_TOP + HUD_H - 4)
    bg.lineBetween(ZONE_C_END, HUD_TOP + 4, ZONE_C_END, HUD_TOP + HUD_H - 4)
    bg.lineBetween(ZONE_R_END, HUD_TOP + 4, ZONE_R_END, HUD_TOP + HUD_H - 4)

    // ── LEFT: Construction ──────────────────────────────────────────────────
    this.add.text(14, HUD_TOP + 6, 'CONSTRUCTION', {
      fontSize: '10px', color: '#f59342', fontFamily: 'monospace',
    })
    this.queueText = this.add.text(14, HUD_TOP + 20, 'File : 0 tuile(s)', {
      fontSize: '12px', color: '#ffcc88', fontFamily: 'monospace',
    })
    this.clearBtn = this.add.text(14, HUD_TOP + 38, '[ Vider ]', {
      fontSize: '11px', color: '#cc6622', fontFamily: 'monospace',
    }).setInteractive({ useHandCursor: true })
    this.clearBtn.on('pointerover',  () => this.clearBtn.setColor('#ff9944'))
    this.clearBtn.on('pointerout',   () => this.clearBtn.setColor('#cc6622'))
    this.clearBtn.on('pointerdown',  () => {
      const gs = this.scene.get('GameScene') as GameScene
      gs.tunnelSystem?.clearQueue(gs.localColony)
    })

    // ── CENTER: Stats + slider ──────────────────────────────────────────────
    const cx = SLIDER_CX
    this.ratioText = this.add.text(cx, HUD_TOP + 6, '', {
      fontSize: '11px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    this.statsText = this.add.text(cx, HUD_TOP + 22, '', {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    this.foodText = this.add.text(cx - 64, HUD_TOP + 42, '', {
      fontSize: '11px', color: '#ffcc44', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    this.woodText = this.add.text(cx + 64, HUD_TOP + 42, '', {
      fontSize: '11px', color: '#bbddaa', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    const track = this.add.graphics()
    track.fillStyle(0x333333, 1)
    track.fillRoundedRect(SLIDER_L, SLIDER_Y - 5, SLIDER_W, 10, 5)
    this.add.text(SLIDER_L - 6, SLIDER_Y, '◀ Ouv.', {
      fontSize: '10px', color: '#88dd88', fontFamily: 'monospace',
    }).setOrigin(1, 0.5)
    this.add.text(SLIDER_R + 6, SLIDER_Y, 'Guer. ▶', {
      fontSize: '10px', color: '#dd6666', fontFamily: 'monospace',
    }).setOrigin(0, 0.5)

    const thumbX = SLIDER_L + (this.warriorPct / 100) * SLIDER_W
    this.thumb = this.add.rectangle(thumbX, SLIDER_Y, 16, 24, 0xffcc44)
    this.thumb.setStrokeStyle(2, 0xffffff, 0.7)
    this.thumb.setInteractive({ useHandCursor: true })
    this.input.setDraggable(this.thumb)
    this.input.on('drag', (_p: unknown, obj: Phaser.GameObjects.GameObject, dragX: number) => {
      if (obj !== this.thumb) return
      const cx2 = Phaser.Math.Clamp(dragX, SLIDER_L, SLIDER_R)
      this.thumb.x = cx2
      this.warriorPct = ((cx2 - SLIDER_L) / SLIDER_W) * 100
      this.pushRatio()
    })

    // ── CENTER-BOTTOM: [B] and [D] buttons ──────────────────────────────────
    // Positioned at center-bottom of HUD, separated enough to not overlap popups
    this.buildBtn = this.add.text(cx - 50, CANVAS_HEIGHT - 12, '[B] Construire', {
      fontSize: '12px', color: '#f2e0c8', fontFamily: 'monospace', backgroundColor: '#000000aa',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(7, 4, 7, 4).setInteractive({ useHandCursor: true })

    this.diggersBtn = this.add.text(cx + 80, CANVAS_HEIGHT - 12, '[D] Creuseurs', {
      fontSize: '12px', color: '#f2e0c8', fontFamily: 'monospace', backgroundColor: '#000000aa',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(7, 4, 7, 4).setInteractive({ useHandCursor: true })

    // Build popup (left-center area above HUD, no overlap with diggers)
    this.buildPanel = this.add.text(cx - 130, CANVAS_HEIGHT - 120, '', {
      fontSize: '12px', color: '#f2f2f2', fontFamily: 'monospace', backgroundColor: '#000000cc',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(10, 7, 10, 7).setVisible(false)

    this.storageBuildBtn = this.add.text(cx - 130, CANVAS_HEIGHT - 94, '[📦 Entrepôt · 50 🪵 · 3×3]', {
      fontSize: '12px', color: '#c9a37a', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(8, 5, 8, 5).setVisible(false).setInteractive({ useHandCursor: true })

    this.buildTooltip = this.add.text(cx - 130, CANVAS_HEIGHT - 68, '', {
      fontSize: '11px', color: '#ffcc66', fontFamily: 'monospace',
    }).setOrigin(0.5, 1).setDepth(36).setVisible(false)

    // Diggers popup (right-center area above HUD)
    this.diggersPanel = this.add.text(cx + 160, CANVAS_HEIGHT - 120, '', {
      fontSize: '12px', color: '#f2f2f2', fontFamily: 'monospace', backgroundColor: '#000000cc',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(10, 7, 10, 7).setVisible(false)

    this.diggersMinusBtn = this.add.text(cx + 108, CANVAS_HEIGHT - 94, '[−]', {
      fontSize: '14px', color: '#ffcc88', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(6, 4, 6, 4).setVisible(false).setInteractive({ useHandCursor: true })

    this.diggersPlusBtn = this.add.text(cx + 212, CANVAS_HEIGHT - 94, '[+]', {
      fontSize: '14px', color: '#88ff88', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(6, 4, 6, 4).setVisible(false).setInteractive({ useHandCursor: true })

    this.buildBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).toggleBuildModePanel())
    this.storageBuildBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activateStoragePlacement())
    this.diggersBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).toggleDiggersPanel())
    this.diggersMinusBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).changeDiggers(-1))
    this.diggersPlusBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).changeDiggers(1))

    // ── RIGHT: Building info ─────────────────────────────────────────────────
    this.bldPanel = this.add.text(ZONE_R_END - 6, HUD_TOP + 6, '', {
      fontSize: '11px', color: '#ccbbff', fontFamily: 'monospace', align: 'right',
    }).setOrigin(1, 0)

    // ── MINIMAP (far right, inside HUD) ─────────────────────────────────────
    this.minimapGfx = this.add.graphics().setDepth(20)

    // ── PHEROMONE panel (floats just above HUD on the left) ─────────────────
    this.pheroPanel = this.add.text(14, HUD_TOP - 82, '', {
      fontSize: '12px', color: '#f2f2f2', fontFamily: 'monospace',
      backgroundColor: '#00000099',
    }).setOrigin(0, 0).setDepth(30).setPadding(8, 6, 8, 6)

    this.pheroFoodBtn = this.add.text(22, HUD_TOP - 74, '[F] Collecte', {
      fontSize: '12px', color: '#4CAF50', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })

    this.pheroAttackBtn = this.add.text(22, HUD_TOP - 56, '[A] Attaque', {
      fontSize: '12px', color: '#F44336', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })

    this.pheroRallyBtn = this.add.text(22, HUD_TOP - 38, '[R] Ralliement', {
      fontSize: '12px', color: '#FFC107', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })

    this.pheroFoodBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('FOOD'))
    this.pheroAttackBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('ATTACK'))
    this.pheroRallyBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('RALLY'))

    // ── TOP overlays ─────────────────────────────────────────────────────────
    this.betaBanner = this.add.text(CANVAS_WIDTH / 2, 8, '', {
      fontSize: '13px', color: '#ffdd88', fontFamily: 'monospace', stroke: '#1a0f00', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(120).setScrollFactor(0)

    this.dangerText = this.add.text(CANVAS_WIDTH / 2, 28, '', {
      fontSize: '26px', color: '#ff4444', fontFamily: 'monospace', stroke: '#220000', strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(30)

    this.lagText = this.add.text(CANVAS_WIDTH / 2, 60, '', {
      fontSize: '17px', color: '#ffcc44', fontFamily: 'monospace', stroke: '#221100', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)

    this.spawnWarnText = this.add.text(CANVAS_WIDTH / 2, 84, '', {
      fontSize: '18px', color: '#ff3333', fontFamily: 'monospace', stroke: '#220000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)

    this.storageWarnText = this.add.text(CANVAS_WIDTH / 2, 108, '', {
      fontSize: '17px', color: '#ff9933', fontFamily: 'monospace', stroke: '#221100', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)

    // ── Sound button ─────────────────────────────────────────────────────────
    this.soundBtn = this.add.text(CANVAS_WIDTH - 12, 12, '', {
      fontSize: '11px', color: '#f2dcc3', fontFamily: 'monospace',
      backgroundColor: '#000000aa', padding: { left: 7, right: 7, top: 4, bottom: 4 },
    }).setOrigin(1, 0).setDepth(40).setScrollFactor(0).setInteractive({ useHandCursor: true })
    this.soundBtn.on('pointerdown', () => this.toggleAmbientMute())
    this.soundBtn.on('pointerover', () => this.soundBtn.setColor('#fff2b3'))
    this.soundBtn.on('pointerout',  () => this.soundBtn.setColor('#f2dcc3'))
    this.refreshSoundButton()

    this.tryStartAmbient()
    this.input.once('pointerdown', () => this.tryStartAmbient())
  }

  private tryStartAmbient(): void {
    if (this.sound.locked) return
    if (!this.ambientSound) {
      this.ambientSound = this.sound.get('bgm-main') ?? this.sound.add('bgm-main', { loop: true, volume: 0.35 })
    }
    if (this.ambientMuted) return
    if (this.ambientSound.isPaused) this.ambientSound.resume()
    else if (!this.ambientSound.isPlaying) this.ambientSound.play()
  }

  private toggleAmbientMute(): void {
    this.ambientMuted = !this.ambientMuted
    if (this.ambientMuted) this.ambientSound?.pause()
    else this.tryStartAmbient()
    this.refreshSoundButton()
  }

  private refreshSoundButton(): void {
    this.soundBtn.setText(this.ambientMuted ? 'SON: OFF' : 'SON: ON')
  }

  private pushRatio(): void {
    const gs = this.scene.get('GameScene') as GameScene
    gs.localColony?.updateRatio(100 - this.warriorPct)
  }

  update(): void {
    const gs     = this.scene.get('GameScene') as GameScene
    const colony = gs?.localColony
    const ts     = gs?.tunnelSystem

    this.betaBanner.setText(gs?.betaSandbox ? 'Mode BETA — solo, sans adversaire actif' : '')

    if (colony) {
      const wPct = Math.round(100 - this.warriorPct)
      this.statsText.setText(`Ouv: ${colony.workerCount}  |  Guer: ${colony.warriorCount}  |  Total: ${colony.totalAnts}`)
      this.ratioText.setText(`Naissances → ${wPct}% ouvrières / ${100 - wPct}% guerrières`)
      this.foodText.setText(`🍖 ${Math.floor(colony.resources.food)} / ${colony.maxFood}`)
      this.woodText.setText(`🪵 ${Math.floor(colony.resources.wood)} / ${colony.maxWood}`)
    }

    if (ts) {
      const active = ts.getActive()
      const pct = active ? `  (${Math.round(active.progress)}%)` : ''
      this.queueText.setText(`File : ${ts.queueLength} tuile(s)${pct}`)
    }

    // Building info panel (right zone)
    const sel = gs?.selectedBuilding
    if (sel) {
      const name  = BUILDING_LABELS[sel.type] ?? sel.type
      const hpStr = `${sel.hp}/${sel.maxHp} PV`
      const extra = sel.type === 'STORAGE'          ? '\n+500🍖 / +100🪵' :
                    sel.type === 'EGG_CHAMBER'       ? '\nPond des œufs' :
                    sel.type === 'QUEEN_THRONE'       ? '\nGuer. +20% attaque' :
                    sel.type === 'CEMETERY'           ? '\nCorpses → bonus' : ''
      this.bldPanel.setText(`${name}\n${hpStr}${extra}`)
    } else {
      this.bldPanel.setText('Clic bâtiment\npour infos')
    }

    // Pheromone panel
    const ph = gs.getPheromonePanelData()
    const dots = (n: number, m: number) => `${'●'.repeat(n)}${'○'.repeat(Math.max(0, m - n))}`
    this.pheroPanel.setText(
      `${dots(ph.food, 5)} F:${ph.food}\n${dots(ph.attack, 3)} A:${ph.attack}\n${dots(ph.rally, 1)} R:${ph.rally}${ph.warning ? '\n' + ph.warning : ''}`
    )
    const blink = ((this.time.now / 500) | 0) % 2 === 0 ? '#ff6666' : '#aa3333'
    this.pheroFoodBtn.setColor(ph.food === 0 ? blink : '#4CAF50')
    this.pheroAttackBtn.setColor(ph.attack === 0 ? blink : '#F44336')
    this.pheroRallyBtn.setColor(ph.rally === 0 ? blink : '#FFC107')

    // Build panel
    const build = gs.getConstructionData()
    this.buildBtn.setColor(build.open ? '#ffffff' : '#f2e0c8')
    this.buildPanel.setVisible(build.open)
    this.storageBuildBtn.setVisible(build.open)
    this.buildTooltip.setVisible(build.open && !build.canAffordStorage)
    this.buildPanel.setText('CONSTRUCTION')
    this.storageBuildBtn.setColor(build.canAffordStorage ? (build.placingStorage ? '#88ff88' : '#c9a37a') : '#777777')
    this.storageBuildBtn.setBackgroundColor(build.canAffordStorage ? '#24170f' : '#1a1a1a')
    this.buildTooltip.setText(build.tooltip)

    // Diggers panel
    const dig = gs.getDiggersData()
    this.diggersBtn.setColor(dig.open ? '#ffffff' : '#f2e0c8')
    this.diggersPanel.setVisible(dig.open)
    this.diggersMinusBtn.setVisible(dig.open)
    this.diggersPlusBtn.setVisible(dig.open)
    this.diggersPanel.setText(
      `Creuseurs [D]\n────────────────\nAssignés : ${dig.assigned}/${dig.max}\nFile : ${dig.queue} tuiles\n~${dig.estimateSec}s · ${dig.activeDiggers} actifs`
    )

    this.dangerText.setText(gs.getDangerOverlayText())
    this.lagText.setText(gs.getLagText())
    this.spawnWarnText.setText(gs.getSpawnWarningText())
    this.storageWarnText.setText(gs.getStorageWarningText())

    this.renderMinimap(gs)
  }

  private renderMinimap(gs: GameScene): void {
    this.minimapGfx.clear()
    const x = MM_X
    const y = HUD_TOP + 7
    this.minimapGfx.fillStyle(0x000000, 0.6)
    this.minimapGfx.fillRect(x, y, MM_W, MM_H)
    this.minimapGfx.lineStyle(1, 0xffffff, 0.3)
    this.minimapGfx.strokeRect(x, y, MM_W, MM_H)

    for (const resource of gs.resourceSystem?.resources ?? []) {
      const t = resource.tiles[0]
      const px = x + (t.col / MAP_WIDTH)  * MM_W
      const py = y + (t.row  / MAP_HEIGHT) * MM_H
      this.minimapGfx.fillStyle(RESOURCE_SPECS[resource.type].color, 0.9)
      this.minimapGfx.fillRect(px - 1, py - 1, resource.type === ResourceType.MUSHROOM ? 2.5 : 2, 2)
    }

    for (const ant of gs.localColony?.ants ?? []) {
      this.minimapGfx.fillStyle(0x44ff66, 0.7)
      this.minimapGfx.fillRect(x + (ant.col / MAP_WIDTH) * MM_W, y + (ant.row / MAP_HEIGHT) * MM_H, 1.5, 1.5)
    }

    for (const b of gs.playerColony?.buildings ?? []) {
      this.minimapGfx.fillStyle(0xaaddff, 1)
      this.minimapGfx.fillRect(x + (b.tileX / MAP_WIDTH) * MM_W, y + (b.tileY / MAP_HEIGHT) * MM_H, 3, 2)
    }
    for (const b of gs.aiColony?.buildings ?? []) {
      this.minimapGfx.fillStyle(0xff6666, 1)
      this.minimapGfx.fillRect(x + (b.tileX / MAP_WIDTH) * MM_W, y + (b.tileY / MAP_HEIGHT) * MM_H, 3, 2)
    }

    const frontCol = gs.getFrontlineCol()
    const fx = x + (frontCol / MAP_WIDTH) * MM_W
    this.minimapGfx.lineStyle(1.5, 0xff4444, 0.85)
    this.minimapGfx.lineBetween(fx, y + 2, fx, y + MM_H - 2)
  }
}
