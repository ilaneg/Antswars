import Phaser from 'phaser'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants'
import { netplay } from '../systems/Netplay'

export class MenuScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'MenuScene' })
  }

  preload(): void {
    this.load.image('menu-bg', '/menu-bg-new.png')
    this.load.image('btn-host', '/btn-host.png')
    this.load.image('btn-join', '/btn-join.png')
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
