import Phaser from 'phaser'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants'
import { netplay } from '../systems/Netplay'
import {
  type ControlAction,
  DEFAULT_CONTROLS,
  keyFromKeyboardEvent,
  loadPlayerSettings,
  savePlayerSettings,
} from '../config/playerSettings'

const CONTROL_LABELS: Record<ControlAction, string> = {
  moveUp: 'Deplacer haut',
  moveDown: 'Deplacer bas',
  moveLeft: 'Deplacer gauche',
  moveRight: 'Deplacer droite',
  pheromoneFood: 'Pheromone collecte',
  pheromoneAttack: 'Pheromone attaque',
  pheromoneRally: 'Pheromone ralliement',
  buildPanel: 'Ouvrir construire',
  diggersPanel: 'Ouvrir creuseurs',
}

export class MenuScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text
  private bgm: Phaser.Sound.BaseSound | null = null
  private settings = loadPlayerSettings()
  private settingsPanel: Phaser.GameObjects.Container | null = null
  private settingsVisible = false
  private waitingControlAction: ControlAction | null = null
  private soundText: Phaser.GameObjects.Text | null = null
  private volumeText: Phaser.GameObjects.Text | null = null
  private keyRows = new Map<ControlAction, Phaser.GameObjects.Text>()

  constructor() {
    super({ key: 'MenuScene' })
  }

  preload(): void {
    this.load.image('menu-bg', '/menu-bg-new.png')
    this.load.image('btn-host', '/btn-host.png')
    this.load.image('btn-join', '/btn-join.png')
    this.load.audio('bgm-main', '/aria-math-cover.mp3')
  }

  create(): void {
    const cx = CANVAS_WIDTH / 2
    const cy = CANVAS_HEIGHT / 2

    this.createChromaKeyTexture('btn-join', 'btn-join-clean')

    const bg = this.add.image(cx, cy, 'menu-bg')
    const scale = Math.max(CANVAS_WIDTH / bg.width, CANVAS_HEIGHT / bg.height)
    bg.setScale(scale)

    const hostBtn = this.createImageButton(cx, cy - 20, 'btn-host')
    const joinBtn = this.createImageButton(cx, cy + 230, 'btn-join-clean')
    const settingsBtn = this.add.text(CANVAS_WIDTH - 16, 16, '[Parametres]', {
      fontSize: '13px',
      color: '#f2dcc3',
      fontFamily: 'monospace',
      backgroundColor: '#000000aa',
      padding: { left: 8, right: 8, top: 5, bottom: 5 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true })
    settingsBtn.on('pointerdown', () => this.toggleSettingsPanel())
    settingsBtn.on('pointerover', () => settingsBtn.setColor('#fff2b3'))
    settingsBtn.on('pointerout', () => settingsBtn.setColor('#f2dcc3'))
    this.tryStartBgm()
    this.input.once('pointerdown', () => this.tryStartBgm())
    this.createSettingsPanel()

    const startBetaSolo = () => {
      netplay.reset()
      hostBtn.disableInteractive()
      joinBtn.disableInteractive()
      betaBtn.disableInteractive()
      this.scene.start('GameScene', {
        role: 'host',
        seed: (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff))) >>> 0,
        multiplayer: false,
        betaSandbox: true,
      })
    }

    const betaBtn = this.add.text(16, CANVAS_HEIGHT - 92, ' BETA — Solo test ', {
      fontSize: '13px',
      color: '#1a1208',
      fontFamily: 'monospace',
      backgroundColor: '#e8b84a',
      padding: { x: 10, y: 6 },
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    betaBtn.on('pointerover', () => betaBtn.setBackgroundColor('#f5d060'))
    betaBtn.on('pointerout', () => betaBtn.setBackgroundColor('#e8b84a'))
    betaBtn.on('pointerup', startBetaSolo)
    this.statusText = this.add.text(cx, cy + 330, '', {
      fontSize: '18px',
      color: '#fff5cc',
      fontFamily: 'monospace',
      align: 'center',
      stroke: '#2a160c',
      strokeThickness: 4,
    }).setOrigin(0.5)

    hostBtn.on('pointerup', async () => {
      hostBtn.disableInteractive()
      joinBtn.disableInteractive()
      betaBtn.disableInteractive()
      try {
        const { code } = await netplay.hostGame()
        this.statusText.setText(`Code: ${code}\nEn attente du joueur...`)
        netplay.onReady = () => {
          this.scene.stop('UIScene')
          this.scene.start('GameScene', { role: 'host', seed: netplay.mapSeed, multiplayer: true })
        }
      } catch {
        this.statusText.setText('Impossible de créer la partie.')
        hostBtn.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 })
        joinBtn.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 })
        betaBtn.setInteractive({ useHandCursor: true })
      }
    })

    joinBtn.on('pointerup', async () => {
      const code = window.prompt('Entre le code de la partie :')
      if (!code?.trim()) return
      hostBtn.disableInteractive()
      joinBtn.disableInteractive()
      betaBtn.disableInteractive()
      this.statusText.setText('Connexion en cours...')
      try {
        await netplay.joinGame(code.trim())
        this.scene.stop('UIScene')
        this.scene.start('GameScene', { role: 'guest', seed: netplay.mapSeed, multiplayer: true })
      } catch {
        this.statusText.setText('Connexion impossible. Vérifie le code.')
        hostBtn.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 })
        joinBtn.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 })
        betaBtn.setInteractive({ useHandCursor: true })
      }
    })

    // Keyboard fallback
    this.input.keyboard?.on('keydown-ONE', () => hostBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-NUMPAD_ONE', () => hostBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-TWO', () => joinBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-NUMPAD_TWO', () => joinBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-THREE', startBetaSolo)
    this.input.keyboard?.on('keydown-NUMPAD_THREE', startBetaSolo)
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.settingsVisible) this.toggleSettingsPanel()
    })
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.handleControlCapture(event))

    this.add.text(cx, CANVAS_HEIGHT - 30, 'v0.1 — projet personnel', {
      fontSize: '12px',
      color: '#f2dcc3',
      stroke: '#4b2a18',
      strokeThickness: 2,
    }).setOrigin(0.5)

    this.add.text(cx, CANVAS_HEIGHT - 52, '1: Créer   2: Rejoindre   3: BETA solo (ressources ↑, pas d’ennemi)', {
      fontSize: '12px',
      color: '#f2dcc3',
      stroke: '#4b2a18',
      strokeThickness: 2,
      fontFamily: 'monospace',
    }).setOrigin(0.5)
  }

  private tryStartBgm(): void {
    if (this.sound.locked) return
    const existing = this.sound.get('bgm-main')
    if (existing) {
      this.bgm = existing
      this.applyBgmSettings(this.bgm)
      if (this.bgm.isPaused) this.bgm.resume()
      else if (!this.bgm.isPlaying) this.bgm.play()
      return
    }
    this.bgm = this.sound.add('bgm-main', { loop: true, volume: this.settings.musicVolume })
    this.applyBgmSettings(this.bgm)
    this.bgm.play()
  }

  private createSettingsPanel(): void {
    const panelX = CANVAS_WIDTH / 2
    const panelY = CANVAS_HEIGHT / 2
    const container = this.add.container(panelX, panelY).setDepth(20).setVisible(false)
    const bg = this.add.rectangle(0, 0, 620, 500, 0x000000, 0.88).setStrokeStyle(2, 0x6b4a30, 1)
    const title = this.add.text(0, -228, 'PARAMETRES', {
      fontSize: '22px', color: '#ffe4c4', fontFamily: 'monospace',
    }).setOrigin(0.5)
    const hint = this.add.text(0, -198, 'Clique une action pour changer la touche', {
      fontSize: '12px', color: '#d8b78f', fontFamily: 'monospace',
    }).setOrigin(0.5)
    container.add([bg, title, hint])

    const soundRow = this.add.text(-280, -162, '', {
      fontSize: '13px', color: '#f2dcc3', fontFamily: 'monospace',
      backgroundColor: '#1f1209',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    soundRow.on('pointerdown', () => {
      this.settings.soundMuted = !this.settings.soundMuted
      this.persistSettings()
      this.refreshSettingsPanel()
    })
    const volumeDown = this.add.text(154, -162, '[-]', {
      fontSize: '13px', color: '#ffcc88', fontFamily: 'monospace', backgroundColor: '#1f1209',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    volumeDown.on('pointerdown', () => this.changeVolume(-0.05))
    const volumeUp = this.add.text(252, -162, '[+]', {
      fontSize: '13px', color: '#88ff88', fontFamily: 'monospace', backgroundColor: '#1f1209',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    volumeUp.on('pointerdown', () => this.changeVolume(0.05))
    const volumeText = this.add.text(203, -162, '', {
      fontSize: '13px', color: '#f2dcc3', fontFamily: 'monospace',
    }).setOrigin(0.5)
    this.soundText = soundRow
    this.volumeText = volumeText
    container.add([soundRow, volumeDown, volumeUp, volumeText])

    const actions = Object.keys(DEFAULT_CONTROLS) as ControlAction[]
    actions.forEach((action, index) => {
      const y = -118 + index * 32
      const row = this.add.text(-280, y, '', {
        fontSize: '13px', color: '#e8d2b8', fontFamily: 'monospace',
        backgroundColor: '#1a1009',
        padding: { left: 8, right: 8, top: 5, bottom: 5 },
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
      row.on('pointerdown', () => this.startControlCapture(action))
      this.keyRows.set(action, row)
      container.add(row)
    })

    const resetBtn = this.add.text(-102, 220, '[Reset touches]', {
      fontSize: '13px', color: '#ffcc99', fontFamily: 'monospace', backgroundColor: '#2a160c',
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    resetBtn.on('pointerdown', () => {
      this.settings.controls = { ...DEFAULT_CONTROLS }
      this.waitingControlAction = null
      this.persistSettings()
      this.refreshSettingsPanel()
    })
    const closeBtn = this.add.text(132, 220, '[Fermer]', {
      fontSize: '13px', color: '#bbffbb', fontFamily: 'monospace', backgroundColor: '#123018',
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerdown', () => this.toggleSettingsPanel())
    container.add([resetBtn, closeBtn])

    this.settingsPanel = container
    this.refreshSettingsPanel()
  }

  private toggleSettingsPanel(): void {
    if (!this.settingsPanel) return
    this.settingsVisible = !this.settingsVisible
    this.waitingControlAction = null
    this.settingsPanel.setVisible(this.settingsVisible)
    this.refreshSettingsPanel()
  }

  private changeVolume(delta: number): void {
    const next = Math.max(0, Math.min(1, this.settings.musicVolume + delta))
    this.settings.musicVolume = Math.round(next * 100) / 100
    this.persistSettings()
    this.refreshSettingsPanel()
  }

  private startControlCapture(action: ControlAction): void {
    this.waitingControlAction = action
    this.refreshSettingsPanel()
  }

  private handleControlCapture(event: KeyboardEvent): void {
    if (!this.settingsVisible || !this.waitingControlAction) return
    if (event.key === 'Escape') {
      this.waitingControlAction = null
      this.refreshSettingsPanel()
      return
    }
    const key = keyFromKeyboardEvent(event)
    if (!key) return
    this.settings.controls[this.waitingControlAction] = key
    this.waitingControlAction = null
    this.persistSettings()
    this.refreshSettingsPanel()
  }

  private refreshSettingsPanel(): void {
    this.soundText?.setText(this.settings.soundMuted ? 'Son: OFF (cliquer pour ON)' : 'Son: ON (cliquer pour OFF)')
    this.volumeText?.setText(`${Math.round(this.settings.musicVolume * 100)}%`)
    for (const [action, row] of this.keyRows.entries()) {
      const isWaiting = this.waitingControlAction === action
      const value = isWaiting ? '...appuie sur une touche' : this.settings.controls[action]
      row.setText(`${CONTROL_LABELS[action]}: [${value}]`)
      row.setColor(isWaiting ? '#ffd27a' : '#e8d2b8')
    }
  }

  private persistSettings(): void {
    savePlayerSettings(this.settings)
    this.applyBgmSettings(this.bgm)
  }

  private applyBgmSettings(sound: Phaser.Sound.BaseSound | null): void {
    if (!sound) return
    const controllable = sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
    controllable.setMute(this.settings.soundMuted)
    controllable.setVolume(this.settings.musicVolume)
  }

  private createImageButton(x: number, y: number, key: string): Phaser.GameObjects.Image {
    const btn = this.add.image(x, y, key)
    const maxW = 250
    const scale = maxW / btn.width
    btn.setScale(scale)
    btn.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 10 })

    btn.on('pointerover', () => btn.setScale(scale * 1.03))
    btn.on('pointerout', () => btn.setScale(scale))
    btn.on('pointerdown', () => btn.setScale(scale * 0.98))
    btn.on('pointerup', () => btn.setScale(scale * 1.03))
    return btn
  }

  private createChromaKeyTexture(sourceKey: string, outKey: string): void {
    if (this.textures.exists(outKey)) return
    const source = this.textures.get(sourceKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(source, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = img.data

    // Remove near-black background while keeping dark outlines.
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const isNearBlack = max < 28
      const isLowSaturation = max - min < 12
      if (isNearBlack && isLowSaturation) data[i + 3] = 0
    }
    ctx.putImageData(img, 0, 0)
    this.textures.addCanvas(outKey, canvas)
  }
}
