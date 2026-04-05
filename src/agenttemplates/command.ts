import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getAgentTemplateRegistry } from './index.js'
import type { AgentTemplate } from './index.js'

/**
 * /agenttemplates slash command implementation.
 *
 * Subcommands:
 *   /agenttemplates                — show active template and list available
 *   /agenttemplates list [cat]     — list templates, optionally by category
 *   /agenttemplates use <slug>     — activate a template
 *   /agenttemplates show <slug>    — show template details
 *   /agenttemplates create <slug> <name> — create custom template
 *   /agenttemplates off            — deactivate current template
 *   /agenttemplates delete <slug>  — delete custom template
 */
export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const registry = getAgentTemplateRegistry()

  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] || ''
  const rest = parts.slice(1)

  switch (subcommand) {
    case '':
      return { type: 'text', value: handleOverview(registry) }
    case 'list':
      return { type: 'text', value: handleList(registry, rest[0]) }
    case 'use':
      return { type: 'text', value: handleUse(registry, rest[0]) }
    case 'show':
      return { type: 'text', value: handleShow(registry, rest[0]) }
    case 'create':
      return {
        type: 'text',
        value: handleCreate(registry, rest[0], rest.slice(1).join(' ')),
      }
    case 'off':
      return { type: 'text', value: handleOff(registry) }
    case 'delete':
      return { type: 'text', value: handleDelete(registry, rest[0]) }
    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /agenttemplates                  Show active template and list available',
          '  /agenttemplates list [category]   List templates, optionally by category',
          '  /agenttemplates use <slug>        Activate a template',
          '  /agenttemplates show <slug>       Show template details',
          '  /agenttemplates create <slug> <name>  Create a custom template',
          '  /agenttemplates off               Deactivate current template',
          '  /agenttemplates delete <slug>     Delete a custom template',
          '',
          'Categories: code-quality, testing, documentation, security, architecture',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleOverview(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
): string {
  const active = registry.getActiveTemplate()
  const templates = registry.listTemplates()

  const lines: string[] = []

  if (active) {
    lines.push(`Active template: ${active.name} (${active.slug})`)
    if (active.personality) {
      lines.push(`  Personality: ${active.personality}`)
    }
    lines.push('')
  } else {
    lines.push('No active template. Using default mode.')
    lines.push('')
  }

  lines.push(`Available templates (${templates.length}):`)
  lines.push('')

  const byCategory = groupByCategory(templates)
  for (const [category, catTemplates] of byCategory) {
    lines.push(`  [${category}]`)
    for (const t of catTemplates) {
      const marker = active && active.slug === t.slug ? ' (active)' : ''
      lines.push(`    ${t.slug} — ${t.name}${marker}`)
    }
    lines.push('')
  }

  lines.push('Use /agenttemplates use <slug> to activate a template.')

  return lines.join('\n')
}

function handleList(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
  category?: string,
): string {
  const templates = registry.listTemplates(category)

  if (templates.length === 0) {
    if (category) {
      return `No templates found in category "${category}".`
    }
    return 'No templates found.'
  }

  const lines: string[] = []

  if (category) {
    lines.push(`Templates in "${category}" (${templates.length}):`)
  } else {
    lines.push(`All templates (${templates.length}):`)
  }
  lines.push('')

  for (const t of templates) {
    lines.push(`  ${t.slug}`)
    lines.push(`    Name: ${t.name}`)
    lines.push(`    ${t.description}`)
    lines.push(`    Category: ${t.category} | Max turns: ${t.maxTurns}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function handleUse(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
  slug?: string,
): string {
  if (!slug) {
    return 'Usage: /agenttemplates use <slug>'
  }

  try {
    const template = registry.activateTemplate(slug)
    return [
      `Activated template: ${template.name}`,
      '',
      `  ${template.description}`,
      template.personality ? `  Personality: ${template.personality}` : '',
      `  Tools: ${template.enabledTools.join(', ')}`,
      `  Max turns: ${template.maxTurns}`,
      '',
      'The agent persona is now active and will influence responses.',
      'Use /agenttemplates off to return to default mode.',
    ]
      .filter(Boolean)
      .join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleShow(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
  slug?: string,
): string {
  if (!slug) {
    return 'Usage: /agenttemplates show <slug>'
  }

  const template = registry.getTemplate(slug)
  if (!template) {
    return `Template "${slug}" not found. Use /agenttemplates list to see available templates.`
  }

  return formatTemplateDetails(template)
}

function handleCreate(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
  slug?: string,
  name?: string,
): string {
  if (!slug || !name) {
    return 'Usage: /agenttemplates create <slug> <name>\n\nExample: /agenttemplates create my-agent "My Custom Agent"'
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return 'Error: Slug must contain only lowercase letters, numbers, and hyphens.'
  }

  // Check if already exists
  if (registry.getTemplate(slug)) {
    return `Error: A template with slug "${slug}" already exists.`
  }

  const template: AgentTemplate = {
    slug,
    name,
    description: `Custom agent template: ${name}`,
    systemPrompt: [
      `You are ${name}.`,
      '',
      'Describe your specialized behavior here.',
      'Edit this template at ~/.void/agents/' + slug + '.json',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Edit', 'Bash'],
    maxTurns: 10,
    category: 'code-quality',
  }

  try {
    registry.createCustomTemplate(template)
    return [
      `Created custom template: ${name} (${slug})`,
      '',
      `Template saved to ~/.void/agents/${slug}.json`,
      'Edit the JSON file to customize the system prompt, tools, and other settings.',
      '',
      `Use /agenttemplates use ${slug} to activate it.`,
    ].join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleOff(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
): string {
  const active = registry.getActiveTemplate()
  if (!active) {
    return 'No template is currently active.'
  }

  registry.deactivate()
  return `Deactivated template: ${active.name}. Returned to default mode.`
}

function handleDelete(
  registry: ReturnType<typeof getAgentTemplateRegistry>,
  slug?: string,
): string {
  if (!slug) {
    return 'Usage: /agenttemplates delete <slug>'
  }

  // Prevent deleting built-in templates
  const builtins = registry.getBuiltinTemplates()
  if (builtins.some(t => t.slug === slug)) {
    return `Error: Cannot delete built-in template "${slug}".`
  }

  const deleted = registry.deleteCustomTemplate(slug)
  if (!deleted) {
    return `Custom template "${slug}" not found. Only custom templates in ~/.void/agents/ can be deleted.`
  }

  return `Deleted custom template: ${slug}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(
  templates: AgentTemplate[],
): Map<string, AgentTemplate[]> {
  const map = new Map<string, AgentTemplate[]>()
  for (const t of templates) {
    const list = map.get(t.category) ?? []
    list.push(t)
    map.set(t.category, list)
  }
  return map
}

function formatTemplateDetails(t: AgentTemplate): string {
  return [
    `${t.name} (${t.slug})`,
    '='.repeat(t.name.length + t.slug.length + 3),
    '',
    `Description: ${t.description}`,
    `Category: ${t.category}`,
    `Max turns: ${t.maxTurns}`,
    t.personality ? `Personality: ${t.personality}` : '',
    `Tools: ${t.enabledTools.join(', ')}`,
    '',
    'System Prompt:',
    '-'.repeat(40),
    t.systemPrompt,
    '-'.repeat(40),
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

import type { Command } from '../types/command.js'

const agenttemplates = {
  type: 'local',
  name: 'agenttemplates',
  description: 'Pre-built agent personas for common workflows',
  argumentHint: '<list|use|show|create|off|delete> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default agenttemplates
