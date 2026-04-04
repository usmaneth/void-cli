/**
 * Slash command handler for /watch.
 *
 * Subcommands:
 *   /watch start              — Start watching with auto-detected config
 *   /watch stop               — Stop watching
 *   /watch status             — Show current watch state
 *   /watch config             — Show/edit watch configuration
 *   /watch run                — Manually trigger lint + test
 *   /watch comments           — Scan for AI trigger comments in changed files
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  WatchModeManager,
  createDefaultConfig,
  type WatchConfig,
  type ParsedError,
} from './index.js'

// ---------------------------------------------------------------------------
// Singleton manager — one watch session at a time
// ---------------------------------------------------------------------------

let manager: WatchModeManager | null = null

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function handleWatchCommand(
  args: string,
): Promise<{ output: string; isError?: boolean }> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''
  const rest = parts.slice(1)

  try {
    switch (subcommand) {
      case '':
      case 'help':
        return { output: getUsage() }

      case 'start':
        return startCommand(rest)

      case 'stop':
        return stopCommand()

      case 'status':
        return statusCommand()

      case 'config':
        return configCommand(rest)

      case 'run':
        return runCommand()

      case 'comments':
        return commentsCommand()

      default:
        return {
          output: `Unknown subcommand "${subcommand}". Run "/watch help" for usage.`,
          isError: true,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      output: `Watch error: ${message}`,
      isError: true,
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function startCommand(args: string[]): { output: string; isError?: boolean } {
  if (manager?.getStatus().watching) {
    return {
      output: 'Watch mode is already running. Use "/watch stop" first, or "/watch status" to check.',
      isError: true,
    }
  }

  const cwd = process.cwd()
  const detected = autoDetectConfig(cwd)

  // Allow overrides from args: --lint "cmd" --test "cmd" --autofix
  const overrides = parseStartArgs(args)
  const config = { ...detected, ...overrides }

  manager = new WatchModeManager(cwd, config)

  // Wire up error reporting
  manager.onErrorsFound((errors: ParsedError[], source: string) => {
    // In a real integration this would feed errors to the AI loop.
    // For now, we log them so the /watch status command can report them.
    const label = source === 'lint' ? 'Lint' : 'Test'
    console.error(
      `[watch] ${label} found ${errors.length} error(s)`,
    )
  })

  manager.start()

  const cfg = manager.getConfig()
  const lines: string[] = [
    'Watch mode started.',
    '',
    `  Patterns : ${cfg.patterns.join(', ')}`,
    `  Ignore   : ${cfg.ignore.join(', ')}`,
    `  Lint cmd : ${cfg.lintCommand ?? '(none)'}`,
    `  Test cmd : ${cfg.testCommand ?? '(none)'}`,
    `  Auto-fix : ${cfg.autoFix ? 'on' : 'off'}`,
    `  Debounce : ${cfg.debounceMs}ms`,
    `  Trigger  : ${cfg.triggerComment}`,
    '',
    'Watching for file changes...',
  ]
  return { output: lines.join('\n') }
}

function stopCommand(): { output: string; isError?: boolean } {
  if (!manager || !manager.getStatus().watching) {
    return { output: 'Watch mode is not running.' }
  }

  const status = manager.getStatus()
  manager.stop()
  manager = null

  return {
    output: [
      'Watch mode stopped.',
      `  Files seen   : ${status.filesWatched}`,
      `  Total errors : ${status.errorCount}`,
      `  Last change  : ${status.lastChange?.toISOString() ?? '(none)'}`,
    ].join('\n'),
  }
}

function statusCommand(): { output: string } {
  if (!manager) {
    return { output: 'Watch mode is not running. Use "/watch start" to begin.' }
  }

  const status = manager.getStatus()
  const cfg = manager.getConfig()

  const lines: string[] = [
    `Watch mode: ${status.watching ? 'RUNNING' : 'STOPPED'}`,
    '',
    `  Files watched : ${status.filesWatched}`,
    `  Last change   : ${status.lastChange?.toISOString() ?? '(none)'}`,
    `  Error count   : ${status.errorCount}`,
    '',
    'Configuration:',
    `  Patterns  : ${cfg.patterns.join(', ')}`,
    `  Ignore    : ${cfg.ignore.join(', ')}`,
    `  Lint cmd  : ${cfg.lintCommand ?? '(none)'}`,
    `  Test cmd  : ${cfg.testCommand ?? '(none)'}`,
    `  Auto-fix  : ${cfg.autoFix ? 'on' : 'off'}`,
    `  Debounce  : ${cfg.debounceMs}ms`,
    `  Trigger   : ${cfg.triggerComment}`,
  ]

  return { output: lines.join('\n') }
}

function configCommand(args: string[]): { output: string; isError?: boolean } {
  // No args — show detected config
  if (args.length === 0) {
    const cwd = process.cwd()
    const detected = autoDetectConfig(cwd)
    const lines: string[] = [
      'Auto-detected configuration:',
      '',
      `  Patterns      : ${detected.patterns.join(', ')}`,
      `  Ignore        : ${detected.ignore.join(', ')}`,
      `  Lint command  : ${detected.lintCommand ?? '(none detected)'}`,
      `  Test command  : ${detected.testCommand ?? '(none detected)'}`,
      `  Auto-fix      : ${detected.autoFix ? 'on' : 'off'}`,
      `  Debounce      : ${detected.debounceMs}ms`,
      `  Trigger       : ${detected.triggerComment}`,
      '',
      'Detection sources:',
    ]

    const cwd2 = process.cwd()
    if (fs.existsSync(path.join(cwd2, 'package.json'))) {
      lines.push('  package.json: found')
    }
    if (fs.existsSync(path.join(cwd2, 'tsconfig.json'))) {
      lines.push('  tsconfig.json: found')
    }
    const eslintConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs']
    const foundEslint = eslintConfigs.find((c) => fs.existsSync(path.join(cwd2, c)))
    if (foundEslint) {
      lines.push(`  ESLint config: ${foundEslint}`)
    }

    return { output: lines.join('\n') }
  }

  // With args — update running config
  if (!manager) {
    return {
      output: 'Watch mode is not running. Start it first with "/watch start".',
      isError: true,
    }
  }

  const updates = parseConfigArgs(args)
  if (Object.keys(updates).length === 0) {
    return {
      output: 'No valid config options recognized.\n\nUsage: /watch config --lint "cmd" --test "cmd" --autofix --debounce 1000',
      isError: true,
    }
  }

  manager.updateConfig(updates)
  const cfg = manager.getConfig()

  return {
    output: [
      'Configuration updated:',
      `  Lint cmd  : ${cfg.lintCommand ?? '(none)'}`,
      `  Test cmd  : ${cfg.testCommand ?? '(none)'}`,
      `  Auto-fix  : ${cfg.autoFix ? 'on' : 'off'}`,
      `  Debounce  : ${cfg.debounceMs}ms`,
    ].join('\n'),
  }
}

function runCommand(): { output: string; isError?: boolean } {
  if (!manager) {
    // Create a temporary manager for one-off run
    const cwd = process.cwd()
    const config = autoDetectConfig(cwd)
    const tempManager = new WatchModeManager(cwd, config)
    return formatRunResults(tempManager)
  }
  return formatRunResults(manager)
}

function formatRunResults(mgr: WatchModeManager): { output: string; isError?: boolean } {
  const { lint, test } = mgr.runChecks()
  const lines: string[] = []

  lines.push('Lint:')
  if (lint.output === '' && lint.success) {
    lines.push('  (no lint command configured)')
  } else {
    lines.push(`  Status: ${lint.success ? 'PASS' : 'FAIL'}`)
    if (lint.errors.length > 0) {
      lines.push(`  Errors: ${lint.errors.length}`)
      for (const e of lint.errors.slice(0, 10)) {
        lines.push(`    ${e.file}:${e.line} ${e.severity}: ${e.message}`)
      }
      if (lint.errors.length > 10) {
        lines.push(`    ... and ${lint.errors.length - 10} more`)
      }
    }
  }

  lines.push('')
  lines.push('Tests:')
  if (test.output === '' && test.success) {
    lines.push('  (no test command configured)')
  } else {
    lines.push(`  Status: ${test.success ? 'PASS' : 'FAIL'}`)
    if (test.errors.length > 0) {
      lines.push(`  Errors: ${test.errors.length}`)
      for (const e of test.errors.slice(0, 10)) {
        lines.push(`    ${e.file}:${e.line} ${e.severity}: ${e.message}`)
      }
      if (test.errors.length > 10) {
        lines.push(`    ... and ${test.errors.length - 10} more`)
      }
    }
  }

  const hasErrors = !lint.success || !test.success
  return { output: lines.join('\n'), isError: hasErrors ? true : undefined }
}

function commentsCommand(): { output: string } {
  if (!manager) {
    return { output: 'Watch mode is not running. Use "/watch start" first.' }
  }

  const watcher = (manager as any).watcher
  if (!watcher) {
    return { output: 'No file changes detected yet.' }
  }

  const changedFiles = watcher.getChangedFiles?.() ?? []
  if (changedFiles.length === 0) {
    return { output: 'No recently changed files to scan.' }
  }

  const comments = manager.scanForAIComments(changedFiles)
  if (comments.length === 0) {
    return { output: `Scanned ${changedFiles.length} file(s), no AI trigger comments found.` }
  }

  const lines = [`Found ${comments.length} AI comment(s):`]
  for (const c of comments) {
    lines.push(`  ${c.file}:${c.line} — ${c.comment}`)
  }

  return { output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

/**
 * Auto-detect watch configuration by inspecting the project directory for:
 *   - package.json scripts (lint, test)
 *   - tsconfig.json (add src patterns)
 *   - .eslintrc / eslint.config (confirm lint availability)
 */
export function autoDetectConfig(projectDir: string): WatchConfig {
  const config = createDefaultConfig()

  // Read package.json
  const pkgPath = path.join(projectDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts = pkg.scripts ?? {}

      // Detect lint command
      if (scripts.lint) {
        config.lintCommand = 'npm run lint'
      } else if (scripts['lint:fix']) {
        config.lintCommand = 'npm run lint:fix'
      }

      // Detect test command
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        config.testCommand = 'npm test'
      }

      // Detect if it's a TypeScript project
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        // If tsconfig has different include paths, we could parse those.
        // For now, defaults are fine.
      }
    } catch {
      // Malformed package.json — skip
    }
  }

  // Check for tsconfig.json and adjust patterns
  const tsconfigPath = path.join(projectDir, 'tsconfig.json')
  if (fs.existsSync(tsconfigPath)) {
    try {
      // Read tsconfig, strip comments (// and /* */) for JSON.parse
      const raw = fs.readFileSync(tsconfigPath, 'utf-8')
      const stripped = raw
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      const tsconfig = JSON.parse(stripped)

      if (tsconfig.include && Array.isArray(tsconfig.include)) {
        // Use tsconfig include paths as watch patterns
        const tsPatterns = tsconfig.include.map((p: string) => {
          // Convert TS include patterns (e.g., "src") to glob patterns
          if (!p.includes('*')) return `${p}/**/*`
          return p
        })
        if (tsPatterns.length > 0) {
          config.patterns = tsPatterns
        }
      }

      if (tsconfig.exclude && Array.isArray(tsconfig.exclude)) {
        // Merge tsconfig exclude into ignore list
        const extras = tsconfig.exclude.filter(
          (e: string) => !config.ignore.includes(e),
        )
        config.ignore = [...config.ignore, ...extras]
      }
    } catch {
      // Malformed tsconfig — skip
    }
  }

  // Check for ESLint config — if present and no lint command yet, suggest tsc + eslint
  if (!config.lintCommand) {
    const eslintConfigs = [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.mjs',
    ]
    const hasEslint = eslintConfigs.some((c) =>
      fs.existsSync(path.join(projectDir, c)),
    )
    if (hasEslint) {
      config.lintCommand = 'npx eslint .'
    }
  }

  return config
}

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

function parseStartArgs(args: string[]): Partial<WatchConfig> {
  const result: Partial<WatchConfig> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    switch (arg) {
      case '--lint':
        result.lintCommand = args[++i]
        break
      case '--test':
        result.testCommand = args[++i]
        break
      case '--autofix':
        result.autoFix = true
        break
      case '--no-autofix':
        result.autoFix = false
        break
      case '--debounce':
        result.debounceMs = parseInt(args[++i] ?? '500', 10)
        break
      case '--trigger':
        result.triggerComment = args[++i] ?? 'AI:'
        break
    }
  }
  return result
}

function parseConfigArgs(args: string[]): Partial<WatchConfig> {
  // Same as start args
  return parseStartArgs(args)
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function getUsage(): string {
  return [
    'Usage: /watch <subcommand>',
    '',
    '  start [options]   — Start watching with auto-detected config',
    '  stop              — Stop watching',
    '  status            — Show current watch state',
    '  config [options]  — Show/edit watch configuration',
    '  run               — Manually trigger lint + test run',
    '  comments          — Scan changed files for AI trigger comments',
    '',
    'Start options:',
    '  --lint "command"      — Set lint command',
    '  --test "command"      — Set test command',
    '  --autofix             — Enable auto-fix (feed errors to AI)',
    '  --no-autofix          — Disable auto-fix',
    '  --debounce <ms>       — Set debounce interval (default: 500)',
    '  --trigger "pattern"   — Set AI trigger comment pattern (default: AI:)',
  ].join('\n')
}
