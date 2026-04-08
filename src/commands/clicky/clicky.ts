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
  'clicky.app',
)
const CLICKY_REPO = 'https://github.com/farzaa/clicky.git'

// Module-level PID tracking (process lifetime)
let clickyPid: number | null = null

function isClickyRunning(): number | null {
  try {
    const output = execFileSync('pgrep', ['-f', 'clicky'], {
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

  const lines: string[] = []

  // Step 1: Clone if needed
  if (!existsSync(CLICKY_DIR)) {
    lines.push('Cloning Clicky repository...')
    try {
      execFileSync('git', ['clone', CLICKY_REPO, CLICKY_DIR], {
        encoding: 'utf-8',
        timeout: 60000,
      })
      lines.push('Clone complete.')
    } catch (err) {
      return lines.join('\n') + `\nFailed to clone Clicky: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    lines.push('Clicky repository already exists.')
  }

  // Step 2: Check Xcode
  if (!checkXcode()) {
    return (
      lines.join('\n') +
      '\nXcode is not installed or not configured. Please install Xcode from the App Store and run `xcode-select --install`.'
    )
  }

  // Step 3: Build if needed
  if (!existsSync(CLICKY_APP)) {
    lines.push('Building Clicky (this may take a minute)...')
    try {
      // Using execSync here because we need cd + stderr redirect in a single shell command.
      // All arguments are hardcoded constants (no user input), so shell injection is not a concern.
      const buildOutput = execSync(
        `cd ${JSON.stringify(CLICKY_DIR)} && xcodebuild -scheme clicky -configuration Release -derivedDataPath build 2>&1`,
        { encoding: 'utf-8', timeout: 300000 },
      )
      if (buildOutput.includes('BUILD SUCCEEDED')) {
        lines.push('Build succeeded.')
      } else if (buildOutput.includes('BUILD FAILED')) {
        return (
          lines.join('\n') +
          '\nBuild failed. Last 10 lines of output:\n' +
          buildOutput.split('\n').slice(-10).join('\n')
        )
      } else {
        lines.push('Build completed.')
      }
    } catch (err) {
      return (
        lines.join('\n') +
        `\nBuild failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else {
    lines.push('Clicky app already built.')
  }

  // Step 4: Verify app exists
  if (!existsSync(CLICKY_APP)) {
    return (
      lines.join('\n') +
      `\nBuilt app not found at expected path: ${CLICKY_APP}`
    )
  }

  // Step 5: Launch
  lines.push('Launching Clicky...')
  try {
    execFileSync('open', [CLICKY_APP])
    // Give it a moment to start, then grab PID
    execFileSync('sleep', ['1'])
    const pid = isClickyRunning()
    if (pid) {
      lines.push(`Clicky is running (PID: ${pid}).`)
    } else {
      lines.push('Clicky launched but could not confirm PID.')
    }
  } catch (err) {
    return (
      lines.join('\n') +
      `\nFailed to launch Clicky: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return lines.join('\n')
}

function handleStop(): string {
  const pid = isClickyRunning()
  if (!pid) {
    return 'Clicky is not running.'
  }

  try {
    process.kill(pid, 'SIGTERM')
    // Brief wait to let process terminate
    try {
      execFileSync('sleep', ['1'])
    } catch {
      // ignore
    }
    const stillRunning = isClickyRunning()
    if (stillRunning) {
      // Force kill
      try {
        process.kill(pid, 'SIGKILL')
        clickyPid = null
        return `Clicky (PID: ${pid}) force-killed.`
      } catch {
        return `Failed to force-kill Clicky (PID: ${pid}).`
      }
    }
    clickyPid = null
    return `Clicky (PID: ${pid}) stopped.`
  } catch (err) {
    return `Failed to stop Clicky: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleStatus(): string {
  const pid = isClickyRunning()
  if (pid) {
    return `Clicky is running (PID: ${pid}).`
  }
  const installed = existsSync(CLICKY_APP)
  if (installed) {
    return 'Clicky is stopped (app is built and ready).'
  }
  if (existsSync(CLICKY_DIR)) {
    return 'Clicky is stopped (repository cloned but app not built).'
  }
  return 'Clicky is not installed. Run /clicky start to install and launch.'
}

function handleLogs(): string {
  // Check for build log
  const buildLogPath = join(CLICKY_DIR, 'build', 'build.log')
  if (existsSync(buildLogPath)) {
    try {
      const output = execFileSync('tail', ['-n', '20', buildLogPath], {
        encoding: 'utf-8',
      })
      return `Last 20 lines of build log:\n${output}`
    } catch {
      // fall through
    }
  }

  // Try system log for clicky — using execSync because we need shell pipe + predicate quoting.
  // All arguments are hardcoded constants, no user input.
  try {
    const output = execSync(
      'log show --predicate \'process == "clicky"\' --last 5m --style compact 2>/dev/null | tail -20',
      { encoding: 'utf-8', timeout: 10000 },
    )
    if (output.trim()) {
      return `Recent Clicky logs:\n${output}`
    }
  } catch {
    // fall through
  }

  return 'No Clicky logs found. The app may not have produced any recent output.'
}

export const call: LocalCommandCall = async (args: string) => {
  const subcommand = args.trim().toLowerCase() || 'start'

  let value: string
  switch (subcommand) {
    case 'start':
      value = await handleStart()
      break
    case 'stop':
      value = handleStop()
      break
    case 'status':
      value = handleStatus()
      break
    case 'logs':
      value = handleLogs()
      break
    default:
      value = `Unknown subcommand: ${subcommand}. Available: start, stop, status, logs`
      break
  }

  return { type: 'text', value }
}
