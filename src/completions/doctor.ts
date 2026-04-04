/**
 * `void doctor` — diagnostic checks for the CLI environment.
 *
 * Uses only Node.js built-in modules (child_process, fs, path, os, https).
 */

import { execSync } from 'child_process'
import { existsSync, accessSync, statfsSync } from 'fs'
import { constants as fsConstants } from 'fs'
import https from 'https'
import os from 'os'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  fix?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function getCommandOutput(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

function parseNodeMajor(versionStr: string): number {
  const match = versionStr.match(/v?(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

function isInsideGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function getVoidConfigDir(): string {
  return path.join(os.homedir(), '.void')
}

/**
 * Attempt an HTTPS HEAD request to api.anthropic.com.
 * Returns a promise that resolves to `true` on success, `false` on failure.
 */
function checkNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/',
        method: 'HEAD',
        timeout: 5000,
      },
      (res) => {
        // Any response (even 4xx) means we reached the server
        res.resume()
        resolve(true)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNodeVersion(): DoctorCheck {
  const raw = getCommandOutput('node --version')
  if (!raw) {
    return {
      name: 'Node.js version',
      status: 'fail',
      message: 'Could not determine Node.js version',
      fix: 'Install Node.js >= 18 from https://nodejs.org',
    }
  }
  const major = parseNodeMajor(raw)
  if (major >= 18) {
    return {
      name: 'Node.js version',
      status: 'pass',
      message: `Node.js ${raw} detected`,
    }
  }
  return {
    name: 'Node.js version',
    status: 'fail',
    message: `Node.js ${raw} is below the minimum required version (18)`,
    fix: 'Upgrade Node.js to version 18 or later: https://nodejs.org',
  }
}

function checkBunInstalled(): DoctorCheck {
  if (commandExists('bun')) {
    const version = getCommandOutput('bun --version') ?? 'unknown'
    return {
      name: 'Bun installed',
      status: 'pass',
      message: `Bun ${version} detected`,
    }
  }
  return {
    name: 'Bun installed',
    status: 'warn',
    message: 'Bun is not installed (optional, but recommended for performance)',
    fix: 'Install Bun: curl -fsSL https://bun.sh/install | bash',
  }
}

function checkGitInstalled(): DoctorCheck {
  if (commandExists('git')) {
    const version = getCommandOutput('git --version') ?? 'unknown'
    return {
      name: 'Git installed',
      status: 'pass',
      message: version,
    }
  }
  return {
    name: 'Git installed',
    status: 'fail',
    message: 'Git is not installed',
    fix: 'Install Git: https://git-scm.com/downloads',
  }
}

function checkGitRepo(cwd: string): DoctorCheck {
  if (isInsideGitRepo(cwd)) {
    return {
      name: 'Git repository',
      status: 'pass',
      message: 'Current directory is inside a git repository',
    }
  }
  return {
    name: 'Git repository',
    status: 'warn',
    message: 'Current directory is not inside a git repository',
    fix: 'Run `git init` to initialize a repository',
  }
}

function checkAnthropicApiKey(): DoctorCheck {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'Anthropic API key',
      status: 'pass',
      message: 'ANTHROPIC_API_KEY is set',
    }
  }
  return {
    name: 'Anthropic API key',
    status: 'fail',
    message: 'ANTHROPIC_API_KEY environment variable is not set',
    fix: 'export ANTHROPIC_API_KEY=sk-ant-...',
  }
}

function checkOpenRouterApiKey(): DoctorCheck {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      name: 'OpenRouter API key',
      status: 'pass',
      message: 'OPENROUTER_API_KEY is set',
    }
  }
  return {
    name: 'OpenRouter API key',
    status: 'warn',
    message: 'OPENROUTER_API_KEY is not set (optional)',
  }
}

function checkConfigDirectory(): DoctorCheck {
  const configDir = getVoidConfigDir()
  if (!existsSync(configDir)) {
    return {
      name: 'Config directory',
      status: 'warn',
      message: `Config directory ${configDir} does not exist`,
      fix: `mkdir -p ${configDir}`,
    }
  }
  try {
    accessSync(configDir, fsConstants.W_OK)
    return {
      name: 'Config directory',
      status: 'pass',
      message: `${configDir} exists and is writable`,
    }
  } catch {
    return {
      name: 'Config directory',
      status: 'warn',
      message: `${configDir} exists but is not writable`,
      fix: `chmod u+w ${configDir}`,
    }
  }
}

function checkVoidMd(cwd: string): DoctorCheck {
  const voidMdPath = path.join(cwd, 'VOID.md')
  if (existsSync(voidMdPath)) {
    return {
      name: 'VOID.md',
      status: 'pass',
      message: 'Project VOID.md file found',
    }
  }
  return {
    name: 'VOID.md',
    status: 'warn',
    message: 'No VOID.md file in the current directory',
  }
}

function checkDiskSpace(): DoctorCheck {
  try {
    const stats = statfsSync(os.tmpdir())
    const availableBytes = stats.bavail * stats.bsize
    const availableMB = Math.round(availableBytes / (1024 * 1024))

    if (availableMB > 100) {
      return {
        name: 'Disk space',
        status: 'pass',
        message: `${availableMB} MB available`,
      }
    }
    return {
      name: 'Disk space',
      status: 'warn',
      message: `Only ${availableMB} MB available (recommend > 100 MB)`,
      fix: 'Free up disk space',
    }
  } catch {
    // statfsSync may not be available on all platforms; fall back to df
    try {
      const output = getCommandOutput('df -m / | tail -1')
      if (output) {
        const parts = output.split(/\s+/)
        const available = parseInt(parts[3], 10)
        if (!isNaN(available)) {
          if (available > 100) {
            return {
              name: 'Disk space',
              status: 'pass',
              message: `${available} MB available`,
            }
          }
          return {
            name: 'Disk space',
            status: 'warn',
            message: `Only ${available} MB available (recommend > 100 MB)`,
            fix: 'Free up disk space',
          }
        }
      }
    } catch {
      // ignore
    }
    return {
      name: 'Disk space',
      status: 'warn',
      message: 'Could not determine available disk space',
    }
  }
}

async function checkNetworkConnectivity(): Promise<DoctorCheck> {
  const reachable = await checkNetwork()
  if (reachable) {
    return {
      name: 'Network connectivity',
      status: 'pass',
      message: 'Successfully reached api.anthropic.com',
    }
  }
  return {
    name: 'Network connectivity',
    status: 'warn',
    message: 'Could not reach api.anthropic.com',
    fix: 'Check your internet connection, proxy, or firewall settings',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all doctor checks and return results.
 *
 * Most checks are synchronous; the network check is async, so this function
 * returns a Promise.
 */
export async function runDoctorChecks(cwd: string): Promise<DoctorCheck[]> {
  const syncChecks: DoctorCheck[] = [
    checkNodeVersion(),
    checkBunInstalled(),
    checkGitInstalled(),
    checkGitRepo(cwd),
    checkAnthropicApiKey(),
    checkOpenRouterApiKey(),
    checkConfigDirectory(),
    checkVoidMd(cwd),
    checkDiskSpace(),
  ]

  const networkCheck = await checkNetworkConnectivity()

  return [...syncChecks, networkCheck]
}
