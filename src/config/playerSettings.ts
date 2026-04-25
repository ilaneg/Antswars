export type ControlAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'pheromoneFood'
  | 'pheromoneAttack'
  | 'pheromoneRally'
  | 'buildPanel'
  | 'diggersPanel'

export type ControlBindings = Record<ControlAction, string>

export type PlayerSettings = {
  soundMuted: boolean
  musicVolume: number
  controls: ControlBindings
}

const SETTINGS_KEY = 'ants-wars-player-settings-v1'

export const DEFAULT_CONTROLS: ControlBindings = {
  moveUp: 'W',
  moveDown: 'S',
  moveLeft: 'A',
  moveRight: 'D',
  pheromoneFood: 'F',
  pheromoneAttack: 'Q',
  pheromoneRally: 'R',
  buildPanel: 'B',
  diggersPanel: 'G',
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  soundMuted: false,
  musicVolume: 0.35,
  controls: { ...DEFAULT_CONTROLS },
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase()
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_SETTINGS.musicVolume
  return Math.max(0, Math.min(1, value))
}

function sanitizeControls(input: unknown): ControlBindings {
  const fallback = { ...DEFAULT_CONTROLS }
  if (!input || typeof input !== 'object') return fallback
  const candidate = input as Partial<Record<ControlAction, string>>
  for (const action of Object.keys(DEFAULT_CONTROLS) as ControlAction[]) {
    const value = candidate[action]
    if (typeof value === 'string' && value.trim().length > 0) {
      fallback[action] = normalizeKey(value)
    }
  }
  return fallback
}

export function loadPlayerSettings(): PlayerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_PLAYER_SETTINGS, controls: { ...DEFAULT_CONTROLS } }
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>
    return {
      soundMuted: !!parsed.soundMuted,
      musicVolume: clampVolume(Number(parsed.musicVolume)),
      controls: sanitizeControls(parsed.controls),
    }
  } catch {
    return { ...DEFAULT_PLAYER_SETTINGS, controls: { ...DEFAULT_CONTROLS } }
  }
}

export function savePlayerSettings(settings: PlayerSettings): void {
  const safe: PlayerSettings = {
    soundMuted: !!settings.soundMuted,
    musicVolume: clampVolume(settings.musicVolume),
    controls: sanitizeControls(settings.controls),
  }
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe))
}

export function keyFromKeyboardEvent(ev: KeyboardEvent): string | null {
  const raw = normalizeKey(ev.key)
  if (!raw) return null
  if (/^[A-Z0-9]$/.test(raw)) return raw
  if (raw === ' ') return 'SPACE'
  if (raw === 'ARROWUP') return 'UP'
  if (raw === 'ARROWDOWN') return 'DOWN'
  if (raw === 'ARROWLEFT') return 'LEFT'
  if (raw === 'ARROWRIGHT') return 'RIGHT'
  return null
}
