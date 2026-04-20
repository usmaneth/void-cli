/**
 * First-run detection for the welcome wizard.
 *
 * We mark the install as initialized by touching `~/.void/initialized` after
 * the user completes (or skips) the welcome wizard. The presence of the file
 * is the single source of truth — its contents are informational (JSON with
 * the wizard version and the selected provider/model so future wizards can
 * migrate forward).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const WIZARD_SCHEMA_VERSION = 1

export type InitializedRecord = {
  version: number
  completedAt: number
  provider?: string
  model?: string
  skipped?: boolean
}

export function getVoidDir(): string {
  return (
    process.env.VOID_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.void')
  )
}

export function getInitializedPath(): string {
  return join(getVoidDir(), 'initialized')
}

export function isInitialized(): boolean {
  return existsSync(getInitializedPath())
}

export function readInitialized(): InitializedRecord | null {
  const p = getInitializedPath()
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf-8').trim()
    if (!raw) return { version: 0, completedAt: 0 }
    return JSON.parse(raw) as InitializedRecord
  } catch {
    return { version: 0, completedAt: 0 }
  }
}

export function markInitialized(record: Omit<InitializedRecord, 'version' | 'completedAt'>): void {
  const dir = getVoidDir()
  mkdirSync(dir, { recursive: true })
  const payload: InitializedRecord = {
    version: WIZARD_SCHEMA_VERSION,
    completedAt: Date.now(),
    ...record,
  }
  writeFileSync(getInitializedPath(), JSON.stringify(payload, null, 2))
}

/**
 * Test/dev helper — force the wizard to re-run on next launch. Bound to
 * `Ctrl+W` from inside the app so users can redo onboarding.
 */
export function clearInitialized(): void {
  const p = getInitializedPath()
  if (existsSync(p)) {
    try {
      unlinkSync(p)
    } catch {
      // best effort — next run will just write over it
    }
  }
}
