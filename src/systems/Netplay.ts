export type NetRole = 'host' | 'guest'

export type NetAction =
  | { type: 'tunnel'; x: number; y: number }
  | { type: 'spawn'; antType: 'WORKER' | 'WARRIOR'; id: string }
  | { type: 'death'; id: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resource'; resourceId: string; amount: number }
  | { type: 'damage'; buildingType: string; hp: number }

type WireMessage =
  | { type: 'seed'; seed: number }
  | { type: 'action'; action: NetAction }
  | { type: 'heartbeat'; t: number }

type DataConnection = {
  on(event: string, cb: (data?: unknown) => void): void
  send(data: unknown): void
  close(): void
  open: boolean
}

type PeerType = {
  on(event: string, cb: (...args: unknown[]) => void): void
  connect(id: string): DataConnection
  destroy(): void
}

type PeerCtor = new (id?: string) => PeerType

declare global {
  interface Window { Peer?: PeerCtor }
}

class NetplayManager {
  role: NetRole | null = null
  code = ''
  mapSeed = 0
  connected = false
  lastMessageAt = 0

  private peer: PeerType | null = null
  private conn: DataConnection | null = null
  private heartbeatTimer: number | null = null
  private readyResolver: (() => void) | null = null
  private readyRejecter: ((error: Error) => void) | null = null

  onReady: (() => void) | null = null
  onAction: ((action: NetAction) => void) | null = null
  onDisconnected: (() => void) | null = null

  reset(): void {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.conn?.close()
    this.peer?.destroy()
    this.peer = null
    this.conn = null
    this.connected = false
    this.code = ''
    this.mapSeed = 0
    this.role = null
    this.readyResolver = null
    this.readyRejecter = null
  }

  async hostGame(): Promise<{ code: string }> {
    this.reset()
    this.role = 'host'
    this.code = this.generateCode()
    const Peer = window.Peer
    if (!Peer) throw new Error('PeerJS indisponible')
    this.peer = new Peer(this.code)

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Timeout création partie')), 15000)
      this.peer!.on('open', () => {
        window.clearTimeout(timeout)
        resolve()
      })
      this.peer!.on('error', () => reject(new Error('Erreur PeerJS')))
    })

    this.peer.on('connection', (connRaw) => {
      this.conn = connRaw as DataConnection
      // mapSeed MUST be set before bindConnection: if the data channel fires `open`
      // synchronously, the seed would otherwise never be sent (guest times out).
      this.mapSeed = Math.floor(Math.random() * 1_000_000_000)
      this.bindConnection()
    })

    return { code: this.code }
  }

  async joinGame(code: string): Promise<void> {
    this.reset()
    this.role = 'guest'
    this.code = this.normalizeJoinCode(code)
    if (!this.code) throw new Error('Code vide')
    const Peer = window.Peer
    if (!Peer) throw new Error('PeerJS indisponible')
    this.peer = new Peer()

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Timeout connexion')), 15000)
      this.peer!.on('open', () => {
        this.conn = this.peer!.connect(code)
        this.bindConnection()
        window.clearTimeout(timeout)
        resolve()
      })
      this.peer!.on('error', () => reject(new Error('Erreur PeerJS')))
    })

    await new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
      window.setTimeout(() => {
        if (this.readyResolver) {
          this.readyResolver = null
          this.readyRejecter = null
          reject(new Error('Timeout réception seed'))
        }
      }, 15000)
    })
  }

  sendAction(action: NetAction): void {
    this.sendRaw({ type: 'action', action })
  }

  isLagging(): boolean {
    return this.connected && Date.now() - this.lastMessageAt > 500
  }

  private bindConnection(): void {
    if (!this.conn) return
    let opened = false
    const onOpen = () => {
      if (opened) return
      opened = true
      this.connected = true
      this.lastMessageAt = Date.now()
      if (this.role === 'host') {
        this.sendRaw({ type: 'seed', seed: this.mapSeed })
        this.onReady?.()
      }
      this.startHeartbeat()
    }
    this.conn.on('open', onOpen)
    if (this.conn.open) onOpen()
    this.conn.on('data', (payload: unknown) => {
      this.lastMessageAt = Date.now()
      const msg = payload as WireMessage
      if (msg.type === 'seed') {
        this.mapSeed = msg.seed
        this.connected = true
        this.onReady?.()
        this.readyResolver?.()
        this.readyResolver = null
        this.readyRejecter = null
      } else if (msg.type === 'action') {
        this.onAction?.(msg.action)
      }
    })
    this.conn.on('close', () => {
      this.connected = false
      this.readyRejecter?.(new Error('Connexion fermée'))
      this.readyResolver = null
      this.readyRejecter = null
      this.onDisconnected?.()
    })
    this.conn.on('error', () => {
      this.connected = false
      this.readyRejecter?.(new Error('Erreur connexion'))
      this.readyResolver = null
      this.readyRejecter = null
      this.onDisconnected?.()
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = window.setInterval(() => {
      this.sendRaw({ type: 'heartbeat', t: Date.now() })
    }, 250)
  }

  private sendRaw(msg: WireMessage): void {
    if (!this.conn || !this.conn.open) return
    this.conn.send(msg)
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let s = ''
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return `ANT-${s}`
  }

  /** Match host Peer id (ANT-XXXX is always uppercase, no spaces). */
  private normalizeJoinCode(raw: string): string {
    return raw.trim().replace(/\s+/g, '').toUpperCase()
  }
}

export const netplay = new NetplayManager()
