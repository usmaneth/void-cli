import { execFileSync, execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { LocalCommandCall } from '../../types/command.js'

const CLICKY_DIR = join(homedir(), '.void', 'clicky')
const CLICKY_APP = join(
  CLICKY_DIR,
  'build',
  'Build',
  'Products',
  'Release',
  'Clicky.app',
)
const CLICKY_REPO = 'https://github.com/farzaa/clicky.git'

let clickyPid: number | null = null

function isClickyRunning(): number | null {
  try {
    // Match the actual app name "Clicky"
    const output = execFileSync('pgrep', ['-fi', 'Clicky'], {
      encoding: 'utf-8',
    }).trim()
    const pids = output
      .split('\n')
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
    if (pids.length > 0) {
      clickyPid = pids[0]!
      return pids[0]!
    }
  } catch {
    // pgrep returns non-zero when no processes found
  }
  clickyPid = null
  return null
}

function checkXcode(): boolean {
  try {
    execFileSync('xcodebuild', ['-version'], { encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}

async function handleStart(): Promise<string> {
  // Check if already running
  const existingPid = isClickyRunning()
  if (existingPid) {
    return `Clicky is already running (PID: ${existingPid}).`
  }

  // Already built — just launch
  if (existsSync(CLICKY_APP)) {
    return launchClicky()
  }

  const lines: string[] = []

  // Clone if needed
  if (!existsSync(CLICKY_DIR)) {
    lines.push('Installing Clicky...')
    try {
      execFileSync('git', ['clone', CLICKY_REPO, CLICKY_DIR], {
        encoding: 'utf-8',
        timeout: 60000,
      })
    } catch (err) {
      return `Failed to clone Clicky: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // Check Xcode
  if (!checkXcode()) {
    return 'Xcode is not installed. Run `xcode-select --install` first.'
  }

  // Build
  lines.push('Building Clicky (first time only, ~1 min)...')
  try {
    const buildOutput = execSync(
      `cd ${JSON.stringify(CLICKY_DIR)} && xcodebuild -scheme leanring-buddy -configuration Release -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO 2>&1`,
      { encoding: 'utf-8', timeout: 300000 },
    )
    if (buildOutput.includes('BUILD FAILED')) {
      return lines.join('\n') + '\nBuild failed:\n' + buildOutput.split('\n').slice(-10).join('\n')
    }
  } catch (err) {
    return lines.join('\n') + `\nBuild failed: ${err instanceof Error ? err.message : String(err)}`
  }

  if (!existsSync(CLICKY_APP)) {
    return lines.join('\n') + `\nBuild completed but app not found at: ${CLICKY_APP}`
  }

  lines.push(launchClicky())
  return lines.join('\n')
}

function launchClicky(): string {
  try {
    execFileSync('open', [CLICKY_APP])
    // Brief pause to let process register
    execFileSync('sleep', ['1'])
    const pid = isClickyRunning()
    if (pid) {
      return `🚀 Launching Clicky... (PID: ${pid})`
    }
    return '🚀 Launching Clicky...'
  } catch (err) {
    return `Failed to launch: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleStop(): string {
  const pid = isClickyRunning()
  if (!pid) {
    return 'Clicky is not running.'
  }

  try {
    process.kill(pid, 'SIGTERM')
    try { execFileSync('sleep', ['1']) } catch {}
    if (isClickyRunning()) {
      try { process.kill(pid, 'SIGKILL') } catch {}
      clickyPid = null
      return `Clicky force-killed (PID: ${pid}).`
    }
    clickyPid = null
    return `Clicky stopped (PID: ${pid}).`
  } catch (err) {
    return `Failed to stop Clicky: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleStatus(): string {
  const pid = isClickyRunning()
  if (pid) return `Clicky is running (PID: ${pid}).`
  if (existsSync(CLICKY_APP)) return 'Clicky is stopped (ready to launch).'
  if (existsSync(CLICKY_DIR)) return 'Clicky is cloned but not built.'
  return 'Clicky is not installed. Run /clicky to install.'
}

function handleLogs(): string {
  try {
    const output = execSync(
      'log show --predicate \'process == "Clicky"\' --last 5m --style compact 2>/dev/null | tail -20',
      { encoding: 'utf-8', timeout: 10000 },
    )
    if (output.trim()) return `Recent Clicky logs:\n${output}`
  } catch {}
  return 'No recent Clicky logs found.'
}

export const call: LocalCommandCall = async (args: string) => {
  const sub = args.trim().toLowerCase() || 'start'
  let value: string
  switch (sub) {
    case 'start': value = await handleStart(); break
    case 'stop': value = handleStop(); break
    case 'status': value = handleStatus(); break
    case 'logs': value = handleLogs(); break
    default: value = `Unknown: ${sub}. Use: start, stop, status, logs`; break
  }
  return { type: 'text', value }
}
