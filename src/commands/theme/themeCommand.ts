import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { THEME_NAMES, type ThemeName } from '../../utils/theme.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()
  const parts = trimmed.split(/\s+/)
  const subcommand = parts[0] || 'list'

  switch (subcommand) {
    case 'list': {
      const currentTheme = getGlobalConfig().theme ?? 'dark'
      const lines = THEME_NAMES.map(
        (name) => `  ${name === currentTheme ? '●' : '○'} ${name}`,
      )
      return {
        type: 'text',
        value: `Available themes:\n${lines.join('\n')}`,
      }
    }

    case 'current': {
      const currentTheme = getGlobalConfig().theme ?? 'dark'
      return {
        type: 'text',
        value: `Current theme: ${currentTheme}`,
      }
    }

    case 'set': {
      const name = parts[1]
      if (!name) {
        return {
          type: 'text',
          value: `Usage: /theme set <name>\nAvailable: ${THEME_NAMES.join(', ')}`,
        }
      }
      if (!THEME_NAMES.includes(name as ThemeName)) {
        return {
          type: 'text',
          value: `Unknown theme "${name}". Available: ${THEME_NAMES.join(', ')}`,
        }
      }
      saveGlobalConfig((current) => ({
        ...current,
        theme: name as ThemeName,
      }))
      return {
        type: 'text',
        value: `Theme set to ${name}`,
      }
    }

    default: {
      return {
        type: 'text',
        value: `Unknown subcommand "${subcommand}". Usage: /theme [list | current | set <name>]`,
      }
    }
  }
}
