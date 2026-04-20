import type { Config } from 'drizzle-kit'
import { homedir, platform } from 'os'
import { join } from 'path'

function defaultDbPath(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && xdg.trim().length > 0) return join(xdg, 'void-cli', 'void.db')
  if (platform() === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'void-cli', 'void.db')
  if (platform() === 'win32')
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'void-cli',
      'void.db',
    )
  return join(homedir(), '.local', 'share', 'void-cli', 'void.db')
}

export default {
  schema: './src/services/session/schema.sql.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.VOID_DB_PATH ?? defaultDbPath(),
  },
} satisfies Config
