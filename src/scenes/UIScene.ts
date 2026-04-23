import Phaser from 'phaser'
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT } from '../config/constants'
import { ResourceType } from '../types'
import { RESOURCE_SPECS } from '../entities/Resource'
import type { GameScene } from './GameScene'

const HUD_H     = 90
const SLIDER_W  = 300
const SLIDER_CX = CANVAS_WIDTH / 2
const SLIDER_Y  = CANVAS_HEIGHT - 22
const SLIDER_L  = SLIDER_CX - SLIDER_W / 2
const SLIDER_R  = SLIDER_CX + SLIDER_W / 2
const HUD_TOP   = CANVAS_HEIGHT - HUD_H

const BUILDING_LABELS: Record<string, string> = {
  EGG_CHAMBER:     'Chambre des Œufs',
  QUEEN_THRONE:    'Trône de la Reine',
  RESOURCE_CENTER: 'Centre de Réserves',
  CEMETERY:        'Cimetière',
  STORAGE:         'Entrepôt',
}

export class UIScene extends Phaser.Scene {
  private thumb!:         Phaser.GameObjects.Rectangle
  private statsText!:     Phaser.GameObjects.Text
  private ratioText!:     Phaser.GameObjects.Text
  private queueText!:     Phaser.GameObjects.Text
  private clearBtn!:      Phaser.GameObjects.Text
  private bldPanel!:      Phaser.GameObjects.Text
  private foodText!:      Phaser.GameObjects.Text
  private woodText!: Phaser.GameObjects.Text
  private minimapGfx!: Phaser.GameObjects.Graphics
  private dangerText!: Phaser.GameObjects.Text
  private lagText!: Phaser.GameObjects.Text
  private spawnWarnText!: Phaser.GameObjects.Text
  private storageWarnText!: Phaser.GameObjects.Text
  private pheroPanel!: Phaser.GameObjects.Text
  private pheroFoodBtn!: Phaser.GameObjects.Text
  private pheroAttackBtn!: Phaser.GameObjects.Text
  private pheroRallyBtn!: Phaser.GameObjects.Text
  private buildBtn!: Phaser.GameObjects.Text
  private buildPanel!: Phaser.GameObjects.Text
  private storageBuildBtn!: Phaser.GameObjects.Text
  private buildTooltip!: Phaser.GameObjects.Text
  private diggersBtn!: Phaser.GameObjects.Text
  private diggersPanel!: Phaser.GameObjects.Text
  private diggersMinusBtn!: Phaser.GameObjects.Text
  private diggersPlusBtn!: Phaser.GameObjects.Text
  private soundBtn!: Phaser.GameObjects.Text
  private ambientSound: Phaser.Sound.BaseSound | null = null
  private ambientMuted = false

  private warriorPct = 30

  constructor() { super({ key: 'UIScene' }) }

  preload(): void {
    this.load.audio('ambient-underground-river', '/ambient-underground-river.mp3')
  }

  create(): void {
    this.cameras.main.setScroll(0, 0)

    // ── Background ──────────────────────────────────────────────────────────
    const bg = this.add.graphics()
    bg.fillStyle(0x000000, 0.78)
    bg.fillRect(0, HUD_TOP, CANVAS_WIDTH, HUD_H)
    bg.lineStyle(1, 0x553300, 0.6)
    bg.lineBetween(0, HUD_TOP, CANVAS_WIDTH, HUD_TOP)

    // ── Slider track ────────────────────────────────────────────────────────
    const track = this.add.graphics()
    track.fillStyle(0x333333, 1)
    track.fillRoundedRect(SLIDER_L, SLIDER_Y - 5, SLIDER_W, 10, 5)

    this.add.text(SLIDER_L - 8, SLIDER_Y, '◀ Ouvrières', {
      fontSize: '11px', color: '#88dd88', fontFamily: 'monospace',
    }).setOrigin(1, 0.5)
    this.add.text(SLIDER_R + 8, SLIDER_Y, 'Guerrières ▶', {
      fontSize: '11px', color: '#dd6666', fontFamily: 'monospace',
    }).setOrigin(0, 0.5)

    const thumbX = SLIDER_L + (this.warriorPct / 100) * SLIDER_W
    this.thumb = this.add.rectangle(thumbX, SLIDER_Y, 18, 26, 0xffcc44)
    this.thumb.setStrokeStyle(2, 0xffffff, 0.7)
    this.thumb.setInteractive({ useHandCursor: true })
    this.input.setDraggable(this.thumb)

    this.input.on(
      'drag',
      (_p: unknown, obj: Phaser.GameObjects.GameObject, dragX: number) => {
        if (obj !== this.thumb) return
        const cx = Phaser.Math.Clamp(dragX, SLIDER_L, SLIDER_R)
        this.thumb.x = cx
        this.warriorPct = ((cx - SLIDER_L) / SLIDER_W) * 100
        this.pushRatio()
      }
    )

    // ── Ratio label ─────────────────────────────────────────────────────────
    this.ratioText = this.add.text(CANVAS_WIDTH / 2, HUD_TOP + 8, '', {
      fontSize: '11px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    // ── Colony stats ────────────────────────────────────────────────────────
    this.statsText = this.add.text(CANVAS_WIDTH / 2, HUD_TOP + 24, '', {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    // Food display (center-bottom area, above slider)
    this.foodText = this.add.text(CANVAS_WIDTH / 2, HUD_TOP + 44, '', {
      fontSize: '11px', color: '#ffcc44', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)
    this.woodText = this.add.text(CANVAS_WIDTH / 2, HUD_TOP + 58, '', {
      fontSize: '11px', color: '#bbbbbb', fontFamily: 'monospace',
    }).setOrigin(0.5, 0)

    // ── Tunnel queue (left) ──────────────────────────────────────────────────
    this.add.text(16, HUD_TOP + 8, 'CONSTRUCTION', {
      fontSize: '10px', color: '#f59342', fontFamily: 'monospace',
    })
    this.queueText = this.add.text(16, HUD_TOP + 22, 'File : 0 tuile(s)', {
      fontSize: '12px', color: '#ffcc88', fontFamily: 'monospace',
    })

    this.clearBtn = this.add.text(16, HUD_TOP + 40, '[ Vider la file ]', {
      fontSize: '11px', color: '#cc6622', fontFamily: 'monospace',
    }).setInteractive({ useHandCursor: true })

    this.clearBtn.on('pointerover',  () => this.clearBtn.setColor('#ff9944'))
    this.clearBtn.on('pointerout',   () => this.clearBtn.setColor('#cc6622'))
    this.clearBtn.on('pointerdown',  () => {
      const gs = this.scene.get('GameScene') as GameScene
      gs.tunnelSystem?.clearQueue(gs.playerColony)
    })

    // ── Building info panel (right) ──────────────────────────────────────────
    this.add.text(CANVAS_WIDTH - 16, HUD_TOP + 8,
      'Clic-gauche + glisser sur DIRT pour creuser', {
      fontSize: '10px', color: '#665544', fontFamily: 'monospace',
    }).setOrigin(1, 0)
    this.add.text(CANVAS_WIDTH - 16, HUD_TOP + 22,
      'Clic-droit ou Échap pour annuler', {
      fontSize: '10px', color: '#665544', fontFamily: 'monospace',
    }).setOrigin(1, 0)

    this.bldPanel = this.add.text(CANVAS_WIDTH - 16, HUD_TOP + 40, '', {
      fontSize: '11px', color: '#ccbbff', fontFamily: 'monospace', align: 'right',
    }).setOrigin(1, 0)

    this.minimapGfx = this.add.graphics().setDepth(20)
    this.dangerText = this.add.text(CANVAS_WIDTH / 2, 24, '', {
      fontSize: '28px',
      color: '#ff4444',
      fontFamily: 'monospace',
      stroke: '#220000',
      strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(30)
    this.lagText = this.add.text(CANVAS_WIDTH / 2, 58, '', {
      fontSize: '18px',
      color: '#ffcc44',
      fontFamily: 'monospace',
      stroke: '#221100',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)
    this.spawnWarnText = this.add.text(CANVAS_WIDTH / 2, 84, '', {
      fontSize: '20px',
      color: '#ff3333',
      fontFamily: 'monospace',
      stroke: '#220000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)
    this.storageWarnText = this.add.text(CANVAS_WIDTH / 2, 110, '', {
      fontSize: '18px',
      color: '#ff9933',
      fontFamily: 'monospace',
      stroke: '#221100',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(30)

    this.pheroPanel = this.add.text(12, CANVAS_HEIGHT - 170, '', {
      fontSize: '13px', color: '#f2f2f2', fontFamily: 'monospace',
      backgroundColor: '#00000099',
    }).setOrigin(0, 0).setDepth(30).setPadding(8, 6, 8, 6)
    this.pheroFoodBtn = this.add.text(18, CANVAS_HEIGHT - 162, '[F] Collecte', {
      fontSize: '12px', color: '#4CAF50', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })
    this.pheroAttackBtn = this.add.text(18, CANVAS_HEIGHT - 144, '[A] Attaque', {
      fontSize: '12px', color: '#F44336', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })
    this.pheroRallyBtn = this.add.text(18, CANVAS_HEIGHT - 126, '[R] Ralliement', {
      fontSize: '12px', color: '#FFC107', fontFamily: 'monospace',
    }).setDepth(31).setInteractive({ useHandCursor: true })
    this.pheroFoodBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('FOOD'))
    this.pheroAttackBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('ATTACK'))
    this.pheroRallyBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activatePheromoneMode('RALLY'))
    this.buildBtn = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 14, '[B] Construire', {
      fontSize: '13px', color: '#f2e0c8', fontFamily: 'monospace', backgroundColor: '#000000aa',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(8, 5, 8, 5).setInteractive({ useHandCursor: true })
    this.buildPanel = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 128, '', {
      fontSize: '12px', color: '#f2f2f2', fontFamily: 'monospace', backgroundColor: '#000000cc',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(10, 8, 10, 8).setVisible(false)
    this.storageBuildBtn = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 102, '[📦 Entrepôt · 50 🪵 · 3×3 blocs]', {
      fontSize: '12px', color: '#c9a37a', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(8, 6, 8, 6).setVisible(false).setInteractive({ useHandCursor: true })
    this.buildTooltip = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 80, '', {
      fontSize: '11px', color: '#ffcc66', fontFamily: 'monospace',
    }).setOrigin(0.5, 1).setDepth(36).setVisible(false)
    this.buildBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).toggleBuildModePanel())
    this.storageBuildBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).activateStoragePlacement())
    this.diggersBtn = this.add.text(CANVAS_WIDTH / 2 + 140, CANVAS_HEIGHT - 14, '[D] Creuseurs', {
      fontSize: '13px', color: '#f2e0c8', fontFamily: 'monospace', backgroundColor: '#000000aa',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(8, 5, 8, 5).setInteractive({ useHandCursor: true })
    this.diggersPanel = this.add.text(CANVAS_WIDTH / 2 + 140, CANVAS_HEIGHT - 128, '', {
      fontSize: '12px', color: '#f2f2f2', fontFamily: 'monospace', backgroundColor: '#000000cc',
    }).setOrigin(0.5, 1).setDepth(35).setPadding(10, 8, 10, 8).setVisible(false)
    this.diggersMinusBtn = this.add.text(CANVAS_WIDTH / 2 + 88, CANVAS_HEIGHT - 102, '[−]', {
      fontSize: '14px', color: '#ffcc88', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(6, 4, 6, 4).setVisible(false).setInteractive({ useHandCursor: true })
    this.diggersPlusBtn = this.add.text(CANVAS_WIDTH / 2 + 192, CANVAS_HEIGHT - 102, '[+]', {
      fontSize: '14px', color: '#88ff88', fontFamily: 'monospace', backgroundColor: '#24170f',
    }).setOrigin(0.5, 1).setDepth(36).setPadding(6, 4, 6, 4).setVisible(false).setInteractive({ useHandCursor: true })
    this.diggersBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).toggleDiggersPanel())
    this.diggersMinusBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).changeDiggers(-1))
    this.diggersPlusBtn.on('pointerdown', () => (this.scene.get('GameScene') as GameScene).changeDiggers(1))
    this.soundBtn = this.add.text(CANVAS_WIDTH - 16, 12, '', {
      fontSize: '12px',
      color: '#f2dcc3',
      fontFamily: 'monospace',
      backgroundColor: '#000000aa',
      padding: { left: 8, right: 8, top: 5, bottom: 5 },
    })
      .setOrigin(1, 0)
      .setDepth(40)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
    this.soundBtn.on('pointerdown', () => this.toggleAmbientMute())
    this.soundBtn.on('pointerover', () => this.soundBtn.setColor('#fff2b3'))
    this.soundBtn.on('pointerout', () => this.soundBtn.setColor('#f2dcc3'))
    this.refreshSoundButton()
    this.tryStartAmbient()
    this.input.once('pointerdown', () => this.tryStartAmbient())
    this.events.once('shutdown', () => {
      this.ambientSound?.stop()
      this.ambientSound?.destroy()
      this.ambientSound = null
    })
  }

  private tryStartAmbient(): void {
    if (this.ambientSound?.isPlaying) return
    if (this.sound.locked) return
    if (!this.ambientSound) {
      this.ambientSound = this.sound.add('ambient-underground-river', {
        loop: true,
        volume: 0.22,
      })
    }
    if (this.ambientMuted) return
    if (this.ambientSound.isPaused) this.ambientSound.resume()
    else if (!this.ambientSound.isPlaying) this.ambientSound.play()
  }

  private toggleAmbientMute(): void {
    this.ambientMuted = !this.ambientMuted
    this.tryStartAmbient()
    if (this.ambientMuted) this.ambientSound?.pause()
    else this.tryStartAmbient()
    this.refreshSoundButton()
  }

  private refreshSoundButton(): void {
    this.soundBtn.setText(this.ambientMuted ? 'SON: OFF' : 'SON: ON')
  }


  private pushRatio(): void {
    const gs = this.scene.get('GameScene') as GameScene
    gs.playerColony?.updateRatio(100 - this.warriorPct)
  }

  update(): void {
    const gs     = this.scene.get('GameScene') as GameScene
    const colony = gs?.localColony
    const ts     = gs?.tunnelSystem

    if (colony) {
      const w   = colony.workerCount
      const wa  = colony.warriorCount
      const tot = colony.totalAnts
      const wPct = Math.round(100 - this.warriorPct)
      this.statsText.setText(`Ouvrières: ${w}  |  Guerrières: ${wa}  |  Total: ${tot}`)
      this.ratioText.setText(`Répartition naissances → ${wPct}% ouvrières / ${100 - wPct}% guerrières`)
      this.foodText.setText(`🍖 ${Math.floor(colony.resources.food)} / ${colony.maxFood}`)
      this.woodText.setText(`🪵 ${Math.floor(colony.resources.wood)} / ${colony.maxWood}`)
    }

    if (ts) {
      const n      = ts.queueLength
      const active = ts.getActive()
      const pct    = active ? `  (${Math.round(active.progress)}%)` : ''
      this.queueText.setText(`File : ${n} tuile(s)${pct}`)
    }

    // Building panel
    const sel = gs?.selectedBuilding
    if (sel) {
      const name = BUILDING_LABELS[sel.type] ?? sel.type
      const hpBar = `${sel.hp}/${sel.maxHp} PV`
      const extra = sel.type === 'RESOURCE_CENTER' ? '\nAncien dépôt' :
                    sel.type === 'STORAGE'          ? '\nStock +500🍖 / +100🪵' :
                    sel.type === 'EGG_CHAMBER'      ? '\nPond des œufs' :
                    sel.type === 'QUEEN_THRONE'      ? '\nGuerrières +20% attaque' :
                    sel.type === 'CEMETERY'          ? '\nDécomposition future' : ''
      this.bldPanel.setText(`${name}\n${hpBar}${extra}`)
    } else {
      this.bldPanel.setText('')
    }

    this.renderMinimap(gs)
    this.dangerText.setText(gs.getDangerOverlayText())
    this.lagText.setText(gs.getLagText())
    this.spawnWarnText.setText(gs.getSpawnWarningText())
    this.storageWarnText.setText(gs.getStorageWarningText())
    const ph = gs.getPheromonePanelData()
    const dots = (n: number, m: number) => `${'●'.repeat(n)}${'○'.repeat(Math.max(0, m - n))}`
    this.pheroPanel.setText(
      `${dots(ph.food, 5)}  ${ph.food}/5\n${dots(ph.attack, 3)}  ${ph.attack}/3\n${dots(ph.rally, 1)}  ${ph.rally}/1\n${ph.warning}`
    )
    const blink = ((this.time.now / 500) | 0) % 2 === 0 ? '#ff6666' : '#aa3333'
    if (ph.food === 0) this.pheroFoodBtn.setColor(blink); else this.pheroFoodBtn.setColor('#4CAF50')
    if (ph.attack === 0) this.pheroAttackBtn.setColor(blink); else this.pheroAttackBtn.setColor('#F44336')
    if (ph.rally === 0) this.pheroRallyBtn.setColor(blink); else this.pheroRallyBtn.setColor('#FFC107')

    const build = gs.getConstructionData()
    this.buildBtn.setColor(build.open ? '#ffffff' : '#f2e0c8')
    this.buildPanel.setVisible(build.open)
    this.storageBuildBtn.setVisible(build.open)
    this.buildTooltip.setVisible(build.open && !build.canAffordStorage)
    this.buildPanel.setText('CONSTRUCTION')
    this.storageBuildBtn.setColor(build.canAffordStorage ? (build.placingStorage ? '#88ff88' : '#c9a37a') : '#777777')
    this.storageBuildBtn.setBackgroundColor(build.canAffordStorage ? '#24170f' : '#1a1a1a')
    this.buildTooltip.setText(build.tooltip)

    const dig = gs.getDiggersData()
    this.diggersBtn.setColor(dig.open ? '#ffffff' : '#f2e0c8')
    this.diggersPanel.setVisible(dig.open)
    this.diggersMinusBtn.setVisible(dig.open)
    this.diggersPlusBtn.setVisible(dig.open)
    this.diggersPanel.setText(
      `Fourmis creuseurs  [D]\n────────────────────────\nAssignées : ${dig.assigned}/${dig.max}\nFile d'attente : ${dig.queue} tunnels\nTemps estimé : ~${dig.estimateSec}s\nCreuseurs : ${dig.activeDiggers} actifs · File : ${dig.queue} tuiles · ~${dig.estimateSec}s restantes`
    )
  }

  private renderMinimap(gs: GameScene): void {
    this.minimapGfx.clear()
    const w = 150
    const h = 75
    const x = CANVAS_WIDTH - w - 12
    const y = CANVAS_HEIGHT - h - 12
    this.minimapGfx.fillStyle(0x000000, 0.55)
    this.minimapGfx.fillRect(x, y, w, h)
    this.minimapGfx.lineStyle(1, 0xffffff, 0.35)
    this.minimapGfx.strokeRect(x, y, w, h)

    const resources = gs.resourceSystem?.resources ?? []
    for (const resource of resources) {
      const t = resource.tiles[0]
      const px = x + (t.col / MAP_WIDTH) * w
      const py = y + (t.row / MAP_HEIGHT) * h
      this.minimapGfx.fillStyle(RESOURCE_SPECS[resource.type].color, 1)
      this.minimapGfx.fillCircle(px, py, resource.type === ResourceType.MUSHROOM ? 2.2 : 1.8)
    }

    const frontCol = gs.getFrontlineCol()
    const fx = x + (frontCol / MAP_WIDTH) * w
    this.minimapGfx.lineStyle(1.5, 0xff5555, 0.9)
    this.minimapGfx.lineBetween(fx, y + 2, fx, y + h - 2)
  }
}
