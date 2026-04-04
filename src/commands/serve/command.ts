import type { LocalCommandCall } from '../../types/command.js'
import { VoidServer } from '../../server/index.js'

/**
 * Singleton server instance shared across /serve invocations within the
 * same REPL session.
 */
let serverInstance: VoidServer | null = null

const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? 'start'

  switch (subcommand) {
    case 'start': {
      if (serverInstance?.isRunning) {
        const addr = serverInstance.address
        return {
          type: 'text',
          value: `Server is already running on http://${addr.host}:${addr.port}`,
        }
      }

      const port = parts[1] ? parseInt(parts[1], 10) : 3456
      if (isNaN(port) || port < 1 || port > 65535) {
        return {
          type: 'text',
          value: `Invalid port: ${parts[1]}. Must be a number between 1 and 65535.`,
        }
      }

      serverInstance = new VoidServer({ port })

      try {
        await serverInstance.start()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        serverInstance = null
        return {
          type: 'text',
          value: `Failed to start server: ${message}`,
        }
      }

      const addr = serverInstance.address
      return {
        type: 'text',
        value: [
          `Void HTTP server started on http://${addr.host}:${addr.port}`,
          '',
          'Available endpoints:',
          '  GET  /health           - Health check',
          '  GET  /status           - Server status',
          '  POST /chat             - Send a chat message',
          '  POST /review           - Review a diff',
          '  GET  /sessions         - List active sessions',
          '  DELETE /sessions/:id   - Close a session',
          '',
          'Use /serve stop to shut down.',
        ].join('\n'),
      }
    }

    case 'stop': {
      if (!serverInstance?.isRunning) {
        return {
          type: 'text',
          value: 'No server is currently running.',
        }
      }

      const addr = serverInstance.address
      await serverInstance.stop()
      serverInstance = null

      return {
        type: 'text',
        value: `Server on http://${addr.host}:${addr.port} has been stopped.`,
      }
    }

    case 'status': {
      if (!serverInstance?.isRunning) {
        return {
          type: 'text',
          value: 'No server is currently running. Use /serve start [port] to start one.',
        }
      }

      const status = serverInstance.getStatus()
      const addr = serverInstance.address

      return {
        type: 'text',
        value: [
          `Server running on http://${addr.host}:${addr.port}`,
          '',
          `  Version:          ${status.version}`,
          `  Uptime:           ${formatUptime(status.uptime)}`,
          `  Active sessions:  ${status.activeSessions}`,
          `  Total requests:   ${status.totalRequests}`,
          `  Models:           ${status.models.join(', ')}`,
        ].join('\n'),
      }
    }

    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /serve start [port]  - Start the HTTP server (default port 3456)',
          '  /serve stop          - Stop the server',
          '  /serve status        - Show server status',
        ].join('\n'),
      }
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export { call }
