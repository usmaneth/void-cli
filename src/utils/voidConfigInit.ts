/**
 * Ensures the ~/.void/ directory structure exists on first run.
 * Creates the config directory and all standard subdirectories,
 * plus a default config.json if one doesn't exist yet.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'

/** Subdirectories created inside ~/.void/ on first run. */
const VOID_SUBDIRECTORIES = [
  'themes',
  'councils',
  'integrations',
  'memory',
  'skills',
  'hooks',
] as const

/** Default config.json written when none exists. */
const DEFAULT_VOID_CONFIG = {
  theme: 'dark',
  startup: 'full',
  providers: {},
  defaults: {
    model: 'claude-sonnet-4-6',
  },
}

/**
 * Create ~/.void/ and its standard subdirectories if they don't already exist.
 * Also writes a default config.json when the file is missing.
 *
 * Safe to call on every startup -- mkdirSync({ recursive: true }) is a no-op
 * when the directory already exists.
 */
export function ensureVoidConfigDir(): void {
  const configHome = getClaudeConfigHomeDir()

  // Create the root config directory
  mkdirSync(configHome, { recursive: true, mode: 0o700 })

  // Create each standard subdirectory
  for (const sub of VOID_SUBDIRECTORIES) {
    const subPath = join(configHome, sub)
    mkdirSync(subPath, { recursive: true, mode: 0o700 })
  }

  // Write default config.json if it doesn't exist
  const configFile = join(configHome, 'config.json')
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify(DEFAULT_VOID_CONFIG, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
  }
}
