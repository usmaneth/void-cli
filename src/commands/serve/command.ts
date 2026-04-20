import type { LocalCommandCall } from '../../types/command.js'
import { runServe } from './serve.js'
import type { VoidServeHandle } from '../../services/serve/server.js'

/**
 * Singleton server instance shared across /serve invocations within the
 * same REPL session.
 */
let serverInstance: VoidServeHandle | null = null

const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const subcommand = parts[0]?.toLowerCase() ?? 'start'

  switch (subcommand) {
    case 'start': {
      if (serverInstance) {
        return {
          type: 'text',
          value: `Server is already running on http://${serverInstance.host}:${serverInstance.port}`,
        }
      }

      // Parse optional flags from the /serve arg string.
      const opts: Record<string, string | boolean> = {}
      for (let i = 1; i < parts.length; i++) {
        const tok = parts[i]!
        if (tok === '--public') opts.public = true
        else if (tok === '--ws') opts.ws = true
        else if (tok === '--port' && parts[i + 1]) {
          opts.port = parts[++i]!
        } else if (tok === '--host' && parts[i + 1]) {
          opts.host = parts[++i]!
        } else if (!tok.startsWith('-')) {
          opts.port = tok
        }
      }

      try {
        serverInstance = await runServe(opts as never)
      } catch (err) {
        serverInstance = null
        const message = err instanceof Error ? err.message : String(err)
        return { type: 'text', value: `Failed to start server: ${message}` }
      }

      const lines = [
        `Void HTTP server started on http://${serverInstance.host}:${serverInstance.port}`,
        '',
        'Available endpoints:',
        '  GET    /sessions',
        '  GET    /sessions/:id',
        '  POST   /sessions/:id/messages',
        '  POST   /sessions/:id/fork',
        '  POST   /sessions/:id/revert',
        '  POST   /sessions/:id/share',
        '  GET    /s/:shareId',
        '',
        'Use /serve stop to shut down.',
      ]
      return { type: 'text', value: lines.join('\n') }
    }

    case 'stop': {
      if (!serverInstance) {
        return { type: 'text', value: 'No server is currently running.' }
      }
      const { host, port } = serverInstance
      await serverInstance.close()
      serverInstance = null
      return { type: 'text', value: `Server on http://${host}:${port} has been stopped.` }
    }

    case 'status': {
      if (!serverInstance) {
        return {
          type: 'text',
          value:
            'No server is currently running. Use /serve start [--port N] [--ws] [--public] to start one.',
        }
      }
      return {
        type: 'text',
        value: `Server running on http://${serverInstance.host}:${serverInstance.port}`,
      }
    }

    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /serve start [--port N] [--host H] [--ws] [--public]  Start the server',
          '  /serve stop                                           Stop the server',
          '  /serve status                                         Show status',
        ].join('\n'),
      }
  }
}

export { call }
