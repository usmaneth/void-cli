import { CommandRegistry } from './registry.js'

/**
 * Handle /cmd slash command routing.
 *
 * Subcommands:
 *   /cmd list                     - list all available commands
 *   /cmd run <name> [args...]     - run a command with arguments
 *   /cmd create <name>            - create a new command template
 *   /cmd edit <name>              - show command file path for editing
 *   /cmd init                     - create default command templates
 */
export async function handleCmdCommand(rawArgs: string): Promise<string> {
  const parts = rawArgs.trim().split(/\s+/)
  const subcommand = parts[0] ?? ''

  switch (subcommand) {
    case 'list':
    case 'ls':
      return handleList()
    case 'run':
      return handleRun(parts.slice(1))
    case 'create':
      return handleCreate(parts[1])
    case 'edit':
      return handleEdit(parts[1])
    case 'init':
      return handleInit()
    case '':
      return getUsage()
    default:
      // Treat bare name as implicit "run"
      return handleRun(parts)
  }
}

function getUsage(): string {
  return `## Custom Commands

Usage:
  /cmd list                    List all available commands
  /cmd run <name> [args...]    Run a command with arguments
  /cmd create <name>           Create a new command template
  /cmd edit <name>             Show command file path for editing
  /cmd init                    Create default command templates

Commands are loaded from:
  ~/.void/commands/            Global (user) commands
  .void/commands/              Project-specific commands

Command files are Markdown (.md). Use $PLACEHOLDER for arguments.
Subdirectories create categories: git/commit.md → git:commit`
}

async function handleList(): Promise<string> {
  const registry = new CommandRegistry()
  await registry.scan()
  const grouped = registry.list()

  const categories = Object.keys(grouped).sort()
  if (categories.length === 0) {
    return `No custom commands found.

Run \`/cmd init\` to create starter templates, or create .md files in:
  ~/.void/commands/     (global)
  .void/commands/       (project)`
  }

  const lines: string[] = ['## Available Custom Commands', '']
  for (const category of categories) {
    const commands = grouped[category]!
    const header = category === '' ? 'General' : category
    lines.push(`### ${header}`)
    for (const cmd of commands) {
      const scopeTag = cmd.scope === 'project' ? ' (project)' : ' (user)'
      const desc = cmd.description ? ` - ${cmd.description}` : ''
      const placeholders =
        cmd.placeholders.length > 0
          ? ` [${cmd.placeholders.map(p => `$${p}`).join(', ')}]`
          : ''
      lines.push(`  ${cmd.name}${placeholders}${desc}${scopeTag}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function handleRun(parts: string[]): Promise<string> {
  const name = parts[0]
  if (!name) {
    return 'Error: command name required. Usage: /cmd run <name> [key=value ...]'
  }

  const registry = new CommandRegistry()
  await registry.scan()

  const template = registry.get(name)
  if (!template) {
    return `Error: command "${name}" not found. Run \`/cmd list\` to see available commands.`
  }

  // Parse key=value arguments
  const args: Record<string, string> = {}
  const positionalArgs: string[] = []
  for (const part of parts.slice(1)) {
    const eqIndex = part.indexOf('=')
    if (eqIndex > 0) {
      const key = part.substring(0, eqIndex).toUpperCase()
      args[key] = part.substring(eqIndex + 1)
    } else {
      positionalArgs.push(part)
    }
  }

  // Assign positional args to placeholders in order
  for (let i = 0; i < positionalArgs.length && i < template.placeholders.length; i++) {
    if (!(template.placeholders[i]! in args)) {
      args[template.placeholders[i]!] = positionalArgs[i]!
    }
  }

  // Check for missing placeholders
  const missing = template.placeholders.filter(p => !(p in args))
  if (missing.length > 0) {
    return `Error: missing arguments for command "${name}": ${missing.map(p => `$${p}`).join(', ')}

Usage: /cmd run ${name} ${template.placeholders.map(p => `${p}=<value>`).join(' ')}`
  }

  const resolved = registry.resolve(name, args)
  if (resolved === null) {
    return `Error: failed to resolve command "${name}".`
  }

  return resolved
}

async function handleCreate(name: string | undefined): Promise<string> {
  if (!name) {
    return 'Error: command name required. Usage: /cmd create <name>'
  }

  const registry = new CommandRegistry()
  const filePath = registry.getNewCommandPath(name, 'user')

  const { mkdirSync, writeFileSync, existsSync } = await import('fs')
  const { dirname } = await import('path')

  if (existsSync(filePath)) {
    return `Command file already exists at: ${filePath}\nUse \`/cmd edit ${name}\` to modify it.`
  }

  const templateName = name.includes(':') ? name.split(':').pop()! : name
  const content = `# ${templateName}

Describe what this command does here.

## Instructions

Your prompt instructions go here. Use $PLACEHOLDER for arguments.

For example:
- $FILE - the file to operate on
- $LANGUAGE - the target language
`

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')

  return `Created command template at: ${filePath}

Edit this file to define your command. Use $PLACEHOLDER for arguments.
Run with: /cmd run ${name}`
}

async function handleEdit(name: string | undefined): Promise<string> {
  if (!name) {
    return 'Error: command name required. Usage: /cmd edit <name>'
  }

  const registry = new CommandRegistry()
  await registry.scan()

  const template = registry.get(name)
  if (!template) {
    return `Error: command "${name}" not found. Run \`/cmd list\` to see available commands, or \`/cmd create ${name}\` to create it.`
  }

  return `Command file location: ${template.path}

Edit this file to modify the command template.
Current placeholders: ${template.placeholders.length > 0 ? template.placeholders.map(p => `$${p}`).join(', ') : '(none)'}`
}

async function handleInit(): Promise<string> {
  const { createDefaultCommands } = await import('./registry.js')
  const created = await createDefaultCommands()

  if (created.length === 0) {
    return 'Default commands already exist. No files were created.'
  }

  return `Created ${created.length} default command template(s):
${created.map(p => `  ${p}`).join('\n')}

Run \`/cmd list\` to see all available commands.`
}
