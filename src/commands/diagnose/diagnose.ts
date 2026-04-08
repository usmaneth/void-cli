import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { LocalCommandCall } from '../../types/command.js'

// Custom Void modules that should be wired into commands.ts
const VOID_MODULES: Record<string, string> = {
  council: 'multi-model orchestration',
  architect: 'two-model pipeline',
  workstream: 'concurrent agents',
  orchestrator: 'task orchestration engine',
  mission: 'web dashboard',
  health: 'system health checks',
  board: 'decision board',
  messaging: 'inter-agent messaging',
  contextsync: 'context synchronization',
  background: 'background tasks',
  clarify: 'clarification engine',
  compress: 'context compression',
  durable: 'durable execution',
  errorstream: 'error streaming',
  execpolicy: 'execution policies',
  guardrails: 'safety guardrails',
  hints: 'hint system',
  mcpserver: 'MCP server',
  notify: 'notifications',
  planact: 'plan-and-act loop',
  taskqueue: 'task queue',
  agenttemplates: 'agent templates',
  autocommit: 'auto-commit',
  autolint: 'auto-lint',
  mentions: 'mentions system',
  watchmode: 'watch mode',
  thinking: 'thinking mode',
  checkpoint: 'checkpoints',
  repomap: 'repository mapping',
  fork: 'fork sub-agent',
}

function getSrcDir(): string {
  // Walk up from this file to find src/
  let dir = __dirname
  for (let i = 0; i < 5; i++) {
    if (path.basename(dir) === 'src') return dir
    const candidate = path.join(dir, 'src')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  // Fallback: assume cwd-based
  return path.resolve(process.cwd(), 'src')
}

function checkModules(srcDir: string): {
  active: { name: string; desc: string }[]
  inactive: { name: string; desc: string }[]
} {
  const commandsFile = path.join(srcDir, 'commands.ts')
  let commandsSrc = ''
  try {
    commandsSrc = fs.readFileSync(commandsFile, 'utf-8')
  } catch {
    // If we can't read commands.ts, try the built .js version
    try {
      commandsSrc = fs.readFileSync(
        commandsFile.replace('.ts', '.js'),
        'utf-8',
      )
    } catch {
      /* empty */
    }
  }

  const active: { name: string; desc: string }[] = []
  const inactive: { name: string; desc: string }[] = []

  for (const [modName, desc] of Object.entries(VOID_MODULES)) {
    const modDir = path.join(srcDir, modName)
    const hasDir = fs.existsSync(modDir)
    const hasCommand = fs.existsSync(path.join(modDir, 'command.ts'))

    // Check if imported in commands.ts
    const importPattern = new RegExp(
      `from\\s+['\"]\\.\\/(?:${modName}|${modName}\\/command)`,
    )
    const isImported = importPattern.test(commandsSrc)

    if (hasDir && (isImported || hasCommand)) {
      active.push({ name: modName, desc })
    } else if (hasDir) {
      inactive.push({ name: modName, desc: `${desc} (not wired)` })
    } else {
      inactive.push({ name: modName, desc: `${desc} (missing)` })
    }
  }

  return { active, inactive }
}

function checkProviders(): { name: string; status: string; ok: boolean }[] {
  const providers: { name: string; status: string; ok: boolean }[] = []

  // Check Anthropic OAuth via keychain
  try {
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Void-credentials', '-w'],
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (result.trim()) {
      // Try to extract account info
      let account = 'OAuth connected'
      try {
        const acctResult = execFileSync(
          'security',
          ['find-generic-password', '-s', 'Void-credentials'],
          {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
        const match = acctResult.match(/"acct"<blob>="([^"]+)"/)
        if (match) account = `OAuth connected (${match[1]})`
      } catch {
        /* keep default */
      }
      providers.push({ name: 'Anthropic', status: account, ok: true })
    } else {
      providers.push({
        name: 'Anthropic',
        status: 'no credentials found',
        ok: false,
      })
    }
  } catch {
    // Keychain lookup failed — check env var fallback
    if (process.env.ANTHROPIC_API_KEY) {
      providers.push({
        name: 'Anthropic',
        status: 'API key via env var',
        ok: true,
      })
    } else {
      providers.push({
        name: 'Anthropic',
        status: 'no credentials found',
        ok: false,
      })
    }
  }

  // Check OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter',
      status: 'API key configured',
      ok: true,
    })
  } else {
    // Check keychain
    try {
      const result = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Void-openrouter', '-w'],
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      if (result.trim()) {
        providers.push({
          name: 'OpenRouter',
          status: 'keychain configured',
          ok: true,
        })
      } else {
        providers.push({
          name: 'OpenRouter',
          status: 'no API key configured',
          ok: false,
        })
      }
    } catch {
      providers.push({
        name: 'OpenRouter',
        status: 'no API key configured',
        ok: false,
      })
    }
  }

  return providers
}

function countBrokenStubs(srcDir: string): number {
  try {
    const result = execFileSync(
      'grep',
      ['-r', 'undefined as any', srcDir, '--include=*.ts', '--include=*.tsx', '-l'],
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    // Count lines (each line is a file path)
    return result.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

function checkBuild(srcDir: string): boolean {
  const projectRoot = path.dirname(srcDir)
  const distDir = path.join(projectRoot, 'dist')
  return fs.existsSync(distDir)
}

export const call: LocalCommandCall = async () => {
  const srcDir = getSrcDir()
  const { active, inactive } = checkModules(srcDir)
  const providers = checkProviders()
  const brokenStubs = countBrokenStubs(srcDir)
  const buildExists = checkBuild(srcDir)

  const totalModules = active.length + inactive.length
  const lines: string[] = []

  lines.push('')
  lines.push('\x1b[1mVoid Self-Diagnostic Report\x1b[0m')
  lines.push('\x1b[90m═══════════════════════════\x1b[0m')
  lines.push('')

  // Modules section
  lines.push(
    `\x1b[1mModules\x1b[0m (${active.length}/${totalModules} active)`,
  )
  for (const mod of active.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `  \x1b[32m✓\x1b[0m ${mod.name.padEnd(18)} \x1b[90m— ${mod.desc}\x1b[0m`,
    )
  }
  for (const mod of inactive.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `  \x1b[31m✗\x1b[0m ${mod.name.padEnd(18)} \x1b[90m— ${mod.desc}\x1b[0m`,
    )
  }
  lines.push('')

  // Providers section
  lines.push('\x1b[1mProviders\x1b[0m')
  for (const p of providers) {
    const icon = p.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
    lines.push(
      `  ${icon} ${p.name.padEnd(18)} \x1b[90m— ${p.status}\x1b[0m`,
    )
  }
  lines.push('')

  // Health section
  lines.push('\x1b[1mHealth\x1b[0m')
  if (brokenStubs > 0) {
    lines.push(
      `  \x1b[33m⚠\x1b[0m ${brokenStubs} broken stub${brokenStubs === 1 ? '' : 's'} detected \x1b[90m(files with "undefined as any")\x1b[0m`,
    )
  } else {
    lines.push('  \x1b[32m✓\x1b[0m No broken stubs detected')
  }
  if (buildExists) {
    lines.push('  \x1b[32m✓\x1b[0m Build output exists')
  } else {
    lines.push('  \x1b[31m✗\x1b[0m No build output found')
  }
  lines.push('')

  return { type: 'text', value: lines.join('\n') }
}
