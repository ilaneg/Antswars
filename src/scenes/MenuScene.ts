import Phaser from 'phaser'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants'

export class MenuScene extends Phaser.Scene {
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

    hostBtn.on('pointerup', () => {
      this.scene.stop('UIScene')
      this.scene.start('GameScene', { role: 'host' })
    })

    joinBtn.on('pointerup', () => {
      const code = window.prompt('Entre le code de la partie :')
      if (!code?.trim()) return
      this.scene.stop('UIScene')
      this.scene.start('GameScene', { role: 'guest', peerId: code.trim() })
    })

    // Keyboard fallback
    this.input.keyboard?.on('keydown-ONE', () => hostBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-NUMPAD_ONE', () => hostBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-TWO', () => joinBtn.emit('pointerup'))
    this.input.keyboard?.on('keydown-NUMPAD_TWO', () => joinBtn.emit('pointerup'))

    this.add.text(cx, CANVAS_HEIGHT - 30, 'v0.1 — projet personnel', {
      fontSize: '12px',
      color: '#f2dcc3',
      stroke: '#4b2a18',
      strokeThickness: 2,
    }).setOrigin(0.5)

    this.add.text(cx, CANVAS_HEIGHT - 52, '1: Héberger   2: Rejoindre', {
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
