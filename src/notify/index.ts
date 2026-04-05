/**
 * Desktop Notifications — cross-platform native notification dispatcher.
 *
 * Supports macOS (osascript), Linux (notify-send), Windows (PowerShell),
 * and a terminal-bell fallback. Notifications are triggered by task events
 * such as completion, errors, approval requests, and long-running tasks.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationTrigger =
  | 'task_complete'
  | 'error'
  | 'approval_needed'
  | 'long_running'

export interface NotificationConfig {
  enabled: boolean
  triggers: NotificationTrigger[]
  minDurationMs: number
  sound: boolean
}

export interface NotificationEntry {
  id: string
  title: string
  body: string
  trigger: NotificationTrigger
  timestamp: string
}

export type Platform = 'darwin' | 'linux' | 'win32' | 'unknown'

export interface NotificationStats {
  totalSent: number
  byTrigger: Record<NotificationTrigger, number>
  lastNotification: string | null
  platform: Platform
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), '.void')
const CONFIG_PATH = path.join(CONFIG_DIR, 'notify.json')
const MAX_HISTORY = 50

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: false,
  triggers: ['task_complete', 'error'],
  minDurationMs: 5000,
  sound: true,
}

const VALID_TRIGGERS: NotificationTrigger[] = [
  'task_complete',
  'error',
  'approval_needed',
  'long_running',
]

// ---------------------------------------------------------------------------
// NotificationManager
// ---------------------------------------------------------------------------

export class NotificationManager {
  private config: NotificationConfig
  private history: NotificationEntry[] = []
  private platform: Platform

  constructor() {
    this.platform = this.detectPlatform()
    this.config = this.loadConfig()
  }

  // ---- Enable / Disable ----

  enable(): void {
    this.config.enabled = true
    this.saveConfig()
  }

  disable(): void {
    this.config.enabled = false
    this.saveConfig()
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  // ---- Configuration ----

  configure(partial: Partial<NotificationConfig>): void {
    if (partial.enabled !== undefined) {
      this.config.enabled = partial.enabled
    }
    if (partial.triggers !== undefined) {
      // Validate all triggers
      const valid = partial.triggers.filter((t): t is NotificationTrigger =>
        VALID_TRIGGERS.includes(t as NotificationTrigger),
      )
      this.config.triggers = valid
    }
    if (partial.minDurationMs !== undefined) {
      const ms = Number(partial.minDurationMs)
      if (!Number.isNaN(ms) && ms >= 0) {
        this.config.minDurationMs = ms
      }
    }
    if (partial.sound !== undefined) {
      this.config.sound = Boolean(partial.sound)
    }
    this.saveConfig()
  }

  getConfig(): Readonly<NotificationConfig> {
    return { ...this.config }
  }

  // ---- Notifications ----

  /**
   * Send a native desktop notification.
   *
   * Returns the NotificationEntry if sent, or null if notifications are
   * disabled or the trigger is not in the configured trigger list.
   */
  notify(
    title: string,
    body: string,
    trigger: NotificationTrigger,
  ): NotificationEntry | null {
    if (!this.config.enabled) {
      return null
    }

    if (!this.config.triggers.includes(trigger)) {
      return null
    }

    const entry: NotificationEntry = {
      id: crypto.randomUUID(),
      title,
      body,
      trigger,
      timestamp: new Date().toISOString(),
    }

    // Dispatch to native notification
    this.sendNative(title, body)

    // Record in history
    this.history.push(entry)
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY)
    }

    return entry
  }

  // ---- History ----

  getHistory(limit?: number): readonly NotificationEntry[] {
    if (limit !== undefined && limit > 0) {
      return this.history.slice(-limit)
    }
    return [...this.history]
  }

  clearHistory(): void {
    this.history = []
  }

  // ---- Platform Detection ----

  detectPlatform(): Platform {
    const p = process.platform
    if (p === 'darwin') return 'darwin'
    if (p === 'linux') return 'linux'
    if (p === 'win32') return 'win32'
    return 'unknown'
  }

  // ---- Stats ----

  getStats(): NotificationStats {
    const byTrigger: Record<NotificationTrigger, number> = {
      task_complete: 0,
      error: 0,
      approval_needed: 0,
      long_running: 0,
    }

    for (const entry of this.history) {
      byTrigger[entry.trigger] = (byTrigger[entry.trigger] ?? 0) + 1
    }

    return {
      totalSent: this.history.length,
      byTrigger,
      lastNotification:
        this.history.length > 0
          ? this.history[this.history.length - 1]!.timestamp
          : null,
      platform: this.platform,
      enabled: this.config.enabled,
    }
  }

  // ---- Private: native notification dispatch ----

  private sendNative(title: string, body: string): void {
    try {
      switch (this.platform) {
        case 'darwin':
          this.sendMacOS(title, body)
          break
        case 'linux':
          this.sendLinux(title, body)
          break
        case 'win32':
          this.sendWindows(title, body)
          break
        default:
          this.sendFallback(title, body)
          break
      }
    } catch {
      // If native notification fails, fall back to terminal bell
      this.sendFallback(title, body)
    }
  }

  private sendMacOS(title: string, body: string): void {
    const escapedTitle = title.replace(/"/g, '\\"')
    const escapedBody = body.replace(/"/g, '\\"')

    const soundClause = this.config.sound ? ' sound name "default"' : ''
    const script = `display notification "${escapedBody}" with title "${escapedTitle}"${soundClause}`

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 5000,
        stdio: 'ignore',
      })
    } catch {
      this.sendFallback(title, body)
    }
  }

  private sendLinux(title: string, body: string): void {
    const escapedTitle = title.replace(/'/g, "'\\''")
    const escapedBody = body.replace(/'/g, "'\\''")

    try {
      execSync(`notify-send '${escapedTitle}' '${escapedBody}'`, {
        timeout: 5000,
        stdio: 'ignore',
      })
    } catch {
      // notify-send not available — use fallback
      this.sendFallback(title, body)
    }
  }

  private sendWindows(title: string, body: string): void {
    const escapedTitle = title.replace(/'/g, "''")
    const escapedBody = body.replace(/'/g, "''")

    // Try BurntToast first (popular notification module), fall back to
    // basic .NET MessageBox.
    const burntToast = `New-BurntToastNotification -Text '${escapedTitle}', '${escapedBody}'`
    const messageBox = [
      "Add-Type -AssemblyName System.Windows.Forms",
      `[System.Windows.Forms.MessageBox]::Show('${escapedBody}', '${escapedTitle}')`,
    ].join('; ')

    try {
      execSync(`powershell -Command "${burntToast}"`, {
        timeout: 5000,
        stdio: 'ignore',
      })
    } catch {
      try {
        execSync(`powershell -Command "${messageBox}"`, {
          timeout: 5000,
          stdio: 'ignore',
        })
      } catch {
        this.sendFallback(title, body)
      }
    }
  }

  private sendFallback(title: string, body: string): void {
    // Terminal bell + console message
    process.stderr.write('\x07')
    process.stderr.write(`[Notification] ${title}: ${body}\n`)
  }

  // ---- Private: config persistence ----

  private loadConfig(): NotificationConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
        const data = JSON.parse(raw) as Partial<NotificationConfig>
        return {
          enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_CONFIG.enabled,
          triggers: Array.isArray(data.triggers)
            ? data.triggers.filter((t): t is NotificationTrigger =>
                VALID_TRIGGERS.includes(t as NotificationTrigger),
              )
            : [...DEFAULT_CONFIG.triggers],
          minDurationMs:
            typeof data.minDurationMs === 'number' && data.minDurationMs >= 0
              ? data.minDurationMs
              : DEFAULT_CONFIG.minDurationMs,
          sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_CONFIG.sound,
        }
      }
    } catch {
      // Corrupt or unreadable config — use defaults
    }
    return { ...DEFAULT_CONFIG }
  }

  private saveConfig(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
      }
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(this.config, null, 2),
        'utf-8',
      )
    } catch {
      // Silently ignore write failures (read-only FS, permissions, etc.)
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: NotificationManager | null = null

export function getNotificationManager(): NotificationManager {
  if (!instance) {
    instance = new NotificationManager()
  }
  return instance
}
