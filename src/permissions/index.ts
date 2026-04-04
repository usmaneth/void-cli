import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionMode = 'suggest' | 'auto-edit' | 'full-auto'

export interface ToolPermission {
  tool: string
  allowed: boolean
  requiresConfirmation: boolean
}

export interface PermissionConfig {
  mode: PermissionMode
  allowedTools: Record<PermissionMode, ToolPermission[]>
  projectOverride?: PermissionMode // from .void/config.json
}

export interface PermissionCheckResult {
  allowed: boolean
  requiresConfirmation: boolean
  reason?: string
}

// ---------------------------------------------------------------------------
// Default permission matrices
// ---------------------------------------------------------------------------

/** suggest: read-only, shows proposed changes but doesn't apply */
const SUGGEST_PERMISSIONS: ToolPermission[] = [
  { tool: 'read', allowed: true, requiresConfirmation: false },
  { tool: 'glob', allowed: true, requiresConfirmation: false },
  { tool: 'grep', allowed: true, requiresConfirmation: false },
  { tool: 'bash', allowed: false, requiresConfirmation: true },
  { tool: 'edit', allowed: false, requiresConfirmation: true }, // shows diff only
  { tool: 'write', allowed: false, requiresConfirmation: true },
]

/** auto-edit: can modify files, confirms commands */
const AUTO_EDIT_PERMISSIONS: ToolPermission[] = [
  { tool: 'read', allowed: true, requiresConfirmation: false },
  { tool: 'glob', allowed: true, requiresConfirmation: false },
  { tool: 'grep', allowed: true, requiresConfirmation: false },
  { tool: 'bash', allowed: true, requiresConfirmation: true },
  { tool: 'edit', allowed: true, requiresConfirmation: false },
  { tool: 'write', allowed: true, requiresConfirmation: false },
]

/** full-auto: everything allowed */
const FULL_AUTO_PERMISSIONS: ToolPermission[] = [
  { tool: 'read', allowed: true, requiresConfirmation: false },
  { tool: 'glob', allowed: true, requiresConfirmation: false },
  { tool: 'grep', allowed: true, requiresConfirmation: false },
  { tool: 'bash', allowed: true, requiresConfirmation: false },
  { tool: 'edit', allowed: true, requiresConfirmation: false },
  { tool: 'write', allowed: true, requiresConfirmation: false },
]

const PERMISSION_MATRICES: Record<PermissionMode, ToolPermission[]> = {
  'suggest': SUGGEST_PERMISSIONS,
  'auto-edit': AUTO_EDIT_PERMISSIONS,
  'full-auto': FULL_AUTO_PERMISSIONS,
}

const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  'suggest':
    'Read-only mode. Can search and read files but cannot make edits or run commands without confirmation.',
  'auto-edit':
    'Can read and edit files freely. Bash commands still require confirmation.',
  'full-auto':
    'All tools are allowed without confirmation. Use with caution.',
}

const VALID_MODES: PermissionMode[] = ['suggest', 'auto-edit', 'full-auto']

// ---------------------------------------------------------------------------
// PermissionManager
// ---------------------------------------------------------------------------

export class PermissionManager {
  private currentMode: PermissionMode = 'auto-edit'
  private projectOverride: PermissionMode | undefined

  setMode(mode: PermissionMode): void {
    if (!VALID_MODES.includes(mode)) {
      throw new Error(
        `Invalid permission mode: "${mode}". Valid modes: ${VALID_MODES.join(', ')}`,
      )
    }
    this.currentMode = mode
  }

  getMode(): PermissionMode {
    return this.projectOverride ?? this.currentMode
  }

  checkPermission(toolName: string): PermissionCheckResult {
    const mode = this.getMode()
    const matrix = PERMISSION_MATRICES[mode]
    const entry = matrix.find(p => p.tool === toolName)

    if (!entry) {
      // Unknown tools default to requiring confirmation
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: `Unknown tool "${toolName}" — defaulting to require confirmation`,
      }
    }

    const result: PermissionCheckResult = {
      allowed: entry.allowed,
      requiresConfirmation: entry.requiresConfirmation,
    }

    if (!entry.allowed) {
      result.reason = `Tool "${toolName}" is not allowed in "${mode}" mode`
    }

    return result
  }

  loadProjectConfig(cwd: string): void {
    const configPath = path.join(cwd, '.void', 'config.json')

    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw) as Record<string, unknown>

      if (
        typeof config.permissionMode === 'string' &&
        VALID_MODES.includes(config.permissionMode as PermissionMode)
      ) {
        this.projectOverride = config.permissionMode as PermissionMode
      }
    } catch {
      // Config file doesn't exist or is invalid — no override
      this.projectOverride = undefined
    }
  }

  getPermissionMatrix(): ToolPermission[] {
    const mode = this.getMode()
    return [...PERMISSION_MATRICES[mode]]
  }

  getModeDescription(mode: PermissionMode): string {
    return MODE_DESCRIPTIONS[mode] ?? `Unknown mode: ${mode}`
  }

  /** Returns whether the current mode comes from a project override. */
  hasProjectOverride(): boolean {
    return this.projectOverride !== undefined
  }

  /** Clears any project-level override. */
  clearProjectOverride(): void {
    this.projectOverride = undefined
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: PermissionManager | undefined

export function getPermissionManager(): PermissionManager {
  if (!instance) {
    instance = new PermissionManager()
  }
  return instance
}

export { VALID_MODES, PERMISSION_MATRICES, MODE_DESCRIPTIONS }
