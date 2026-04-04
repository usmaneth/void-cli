/**
 * Shell completion generators for the `void` CLI.
 *
 * Each generator returns the full text of a completion script that can be
 * sourced (or piped into `source /dev/stdin`) by the target shell.
 */

const FLAGS = [
  '--print',
  '--continue',
  '--resume',
  '--model',
  '--add-dir',
  '--verbose',
  '--version',
  '--help',
  '--dangerously-skip-permissions',
  '--theme',
  '--mode',
  '--watch',
  '--architect',
] as const

const MODELS = [
  'opus',
  'sonnet',
  'haiku',
  'gpt-4o',
  'gemini-pro',
  'llama-3',
  'mistral',
] as const

const MODES = ['auto', 'manual', 'confirm'] as const

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------

export function generateBashCompletion(): string {
  const flagList = FLAGS.join(' ')
  const modelList = MODELS.join(' ')
  const modeList = MODES.join(' ')

  return `#!/usr/bin/env bash
# Bash completions for void-cli
# Source this file or add to ~/.bashrc:
#   eval "$(void completion bash)"

_void_completions() {
  local cur prev opts models modes
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  opts="${flagList}"
  models="${modelList}"
  modes="${modeList}"

  case "\${prev}" in
    --model)
      COMPREPLY=( $(compgen -W "\${models}" -- "\${cur}") )
      return 0
      ;;
    --mode)
      COMPREPLY=( $(compgen -W "\${modes}" -- "\${cur}") )
      return 0
      ;;
    --theme)
      COMPREPLY=( $(compgen -W "dark light" -- "\${cur}") )
      return 0
      ;;
    --add-dir)
      COMPREPLY=( $(compgen -d -- "\${cur}") )
      return 0
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    return 0
  fi

  # Default: complete subcommands
  local subcommands="doctor completion config init help login logout mcp status"
  COMPREPLY=( $(compgen -W "\${subcommands}" -- "\${cur}") )
  return 0
}

complete -F _void_completions void
`
}

// ---------------------------------------------------------------------------
// Zsh
// ---------------------------------------------------------------------------

export function generateZshCompletion(): string {
  const modelValues = MODELS.map((m) => `'${m}'`).join(' ')
  const modeValues = MODES.map((m) => `'${m}'`).join(' ')

  // Build _arguments lines for each flag
  const argLines = [
    "'--print[Print the conversation output to stdout]'",
    "'--continue[Continue the most recent conversation]'",
    "'--resume[Resume a specific conversation by ID]'",
    `'--model[Select the model to use]:model:(${modelValues})'`,
    "'--add-dir[Add a directory to the context]:directory:_directories'",
    "'--verbose[Enable verbose output]'",
    "'--version[Show version information]'",
    "'--help[Show help]'",
    "'--dangerously-skip-permissions[Skip permission prompts]'",
    "'--theme[Set the color theme]:theme:(dark light)'",
    `'--mode[Set the interaction mode]:mode:(${modeValues})'`,
    "'--watch[Watch mode]'",
    "'--architect[Enable architect mode]'",
  ]

  return `#compdef void
# Zsh completions for void-cli
# Add to fpath or source directly:
#   eval "$(void completion zsh)"

_void() {
  local -a subcommands
  subcommands=(
    'doctor:Diagnose and verify your Void installation'
    'completion:Output shell completion script'
    'config:Manage configuration'
    'init:Initialize a new project'
    'help:Show help information'
    'login:Authenticate with the API'
    'logout:Remove stored credentials'
    'mcp:Manage MCP servers'
    'status:Show session status'
  )

  _arguments -s \\
    ${argLines.join(' \\\n    ')} \\
    '1:subcommand:->subcmd' \\
    '*::arg:->args'

  case "\$state" in
    subcmd)
      _describe -t subcommands 'void subcommand' subcommands
      ;;
  esac
}

compdef _void void
`
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

export function generateFishCompletion(): string {
  const lines: string[] = [
    '# Fish completions for void-cli',
    '# Add to ~/.config/fish/completions/void.fish or source directly:',
    '#   void completion fish | source',
    '',
    '# Disable file completions by default',
    'complete -c void -f',
    '',
    '# Subcommands',
    "complete -c void -n '__fish_use_subcommand' -a doctor -d 'Diagnose and verify your Void installation'",
    "complete -c void -n '__fish_use_subcommand' -a completion -d 'Output shell completion script'",
    "complete -c void -n '__fish_use_subcommand' -a config -d 'Manage configuration'",
    "complete -c void -n '__fish_use_subcommand' -a init -d 'Initialize a new project'",
    "complete -c void -n '__fish_use_subcommand' -a help -d 'Show help information'",
    "complete -c void -n '__fish_use_subcommand' -a login -d 'Authenticate with the API'",
    "complete -c void -n '__fish_use_subcommand' -a logout -d 'Remove stored credentials'",
    "complete -c void -n '__fish_use_subcommand' -a mcp -d 'Manage MCP servers'",
    "complete -c void -n '__fish_use_subcommand' -a status -d 'Show session status'",
    '',
    '# Flags',
    "complete -c void -l print -d 'Print the conversation output to stdout'",
    "complete -c void -l continue -d 'Continue the most recent conversation'",
    "complete -c void -l resume -d 'Resume a specific conversation by ID'",
    "complete -c void -l model -d 'Select the model to use' -r -a '" + MODELS.join(' ') + "'",
    "complete -c void -l add-dir -d 'Add a directory to the context' -r -F",
    "complete -c void -l verbose -d 'Enable verbose output'",
    "complete -c void -l version -d 'Show version information'",
    "complete -c void -l help -d 'Show help'",
    "complete -c void -l dangerously-skip-permissions -d 'Skip permission prompts'",
    "complete -c void -l theme -d 'Set the color theme' -r -a 'dark light'",
    "complete -c void -l mode -d 'Set the interaction mode' -r -a '" + MODES.join(' ') + "'",
    "complete -c void -l watch -d 'Watch mode'",
    "complete -c void -l architect -d 'Enable architect mode'",
    '',
    '# Completion subcommand shells',
    "complete -c void -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish' -d 'Shell type'",
  ]

  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function getCompletionScript(shell: 'bash' | 'zsh' | 'fish'): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion()
    case 'zsh':
      return generateZshCompletion()
    case 'fish':
      return generateFishCompletion()
    default: {
      const _exhaustive: never = shell
      throw new Error(`Unsupported shell: ${_exhaustive}`)
    }
  }
}
