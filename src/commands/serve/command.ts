import type { LocalCommandCall } from '../../types/command.js'
import { VoidServer } from '../../server/index.js'
import {
  buildPairingUrl,
  generatePairingToken,
  getLanAddress,
} from '../../server/pairing.js'
import { toString as qrToString } from 'qrcode'

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

    case 'mobile': {
      if (serverInstance?.isRunning) {
        return {
          type: 'text',
          value: [
            'A server is already running. Stop it first with /serve stop,',
            'then run /serve mobile to restart in mobile mode.',
          ].join('\n'),
        }
      }

      const port = parts[1] ? parseInt(parts[1], 10) : 3456
      if (isNaN(port) || port < 1 || port > 65535) {
        return {
          type: 'text',
          value: `Invalid port: ${parts[1]}. Must be a number between 1 and 65535.`,
        }
      }

      const token = generatePairingToken()
      // Bind to all interfaces so phones on the same LAN can reach us.
      // The pairing token gates every request, so this is safe provided
      // the user keeps the token private.
      serverInstance = new VoidServer({
        port,
        host: '0.0.0.0',
        apiKey: token,
        mobile: true,
      })

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

      const lan = getLanAddress()
      const url = buildPairingUrl(lan, port, token)

      let qr = ''
      try {
        qr = await qrToString(url, { type: 'utf8', errorCorrectionLevel: 'L' })
      } catch {
        qr = '(QR rendering failed — use the URL below)'
      }

      return {
        type: 'text',
        value: [
          'Void mobile server is running.',
          '',
          qr.trimEnd(),
          '',
          `Scan the QR code above with your phone, or open:`,
          `  ${url}`,
          '',
          `LAN address:  http://${lan}:${port}`,
          `Pairing token (keep this secret):`,
          `  ${token}`,
          '',
          'Tips:',
          '  • Phone and computer must be on the same network.',
          '  • The token lives in the URL fragment, so it never hits server logs.',
          '  • Use /serve stop to shut down and invalidate the token.',
        ].join('\n'),
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
          '  /serve mobile [port] - Start in mobile mode (LAN-bound, QR pairing)',
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
