/**
 * /share — generate a public read-only share URL for the current session
 * and copy it to the clipboard.
 *
 * Requires a running `void serve` server. When no server is running, we
 * fall back to generating a shareId via the SharedSessionsStore and
 * printing the URL (which will resolve once the server is started).
 */

import type { Command } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'
import { SharedSessionsStore } from '../../services/serve/sharedSessions.js'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

async function copyToClipboard(text: string): Promise<boolean> {
  const plat = platform()
  let cmd: string | null = null
  let args: string[] = []

  if (plat === 'darwin') {
    cmd = 'pbcopy'
  } else if (plat === 'linux') {
    cmd = 'xclip'
    args = ['-selection', 'clipboard']
  } else if (plat === 'win32') {
    cmd = 'clip'
  }
  if (!cmd) return false

  return new Promise((resolve) => {
    try {
      const child = spawn(cmd!, args, { stdio: ['pipe', 'ignore', 'ignore'] })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
      child.stdin.write(text)
      child.stdin.end()
    } catch {
      resolve(false)
    }
  })
}

function activeServerBaseUrl(): string {
  // Voidex sets this when it subprocesses `void serve`. Users can also
  // set it manually so /share prints a correct URL.
  return (
    process.env.VOID_SERVE_PUBLIC_URL?.replace(/\/$/, '') ??
    `http://127.0.0.1:${process.env.VOID_SERVE_PORT ?? '4096'}`
  )
}

const call: LocalCommandCall = async (_args, context) => {
  // The command surface doesn't expose a typed sessionId — fall back to
  // the env var we set whenever a session is active, else let the user
  // pass one.
  const sessionId =
    (context as { sessionId?: string } | undefined)?.sessionId ??
    process.env.VOID_CURRENT_SESSION_ID ??
    null

  if (!sessionId) {
    return {
      type: 'text',
      value:
        'No active session id found. Start a session first, then /share will generate a URL.',
    }
  }

  const store = new SharedSessionsStore()
  const record = store.create(sessionId)
  const url = `${activeServerBaseUrl()}/s/${record.shareId}`

  const copied = await copyToClipboard(url)
  const lines = [
    `Shared: ${url}`,
    copied ? '(copied to clipboard)' : '(copy manually — clipboard unavailable)',
    '',
    `Share id: ${record.shareId}`,
  ]
  return { type: 'text', value: lines.join('\n') }
}

const share = {
  type: 'local',
  name: 'share',
  description: 'Generate a public read-only share URL for the current session',
  argumentHint: '',
  supportsNonInteractive: true,
  isEnabled: () => true,
  load: () => ({ call }),
} satisfies Command

export default share
export { call }
