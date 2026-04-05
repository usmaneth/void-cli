/**
 * Slash command handler for /mcpserver.
 *
 * Subcommands:
 *   /mcpserver              — show MCP server status
 *   /mcpserver start        — start MCP server mode (takes over stdio)
 *   /mcpserver stop         — stop MCP server
 *   /mcpserver status       — show connection info and stats
 *   /mcpserver methods      — list available JSON-RPC methods
 */

import type { Command } from '../types/command.js'
import type { LocalCommandCall } from '../types/command.js'
import { getMcpServer } from './index.js'

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const mcpserver = {
  type: 'local',
  name: 'mcpserver',
  description: 'Run void as an MCP server (JSON-RPC over stdio)',
  argumentHint: '<start|stop|status|methods>',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./command.js'),
} satisfies Command

export default mcpserver

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''

  switch (subcommand) {
    case 'start':
      return handleStart()
    case 'stop':
      return handleStop()
    case 'status':
    case '':
      return handleStatus()
    case 'methods':
      return handleMethods()
    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage: /mcpserver <subcommand>',
          '',
          '  start     Start MCP server mode (JSON-RPC over stdio)',
          '  stop      Stop the MCP server',
          '  status    Show connection info and stats',
          '  methods   List available JSON-RPC methods',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleStart(): { type: 'text'; value: string } {
  const server = getMcpServer()

  if (server.isRunning) {
    return {
      type: 'text',
      value: 'MCP server is already running. Use /mcpserver stop first.',
    }
  }

  // Start the server (non-blocking from the command's perspective —
  // the returned promise resolves when the server eventually stops).
  void server.start()

  return {
    type: 'text',
    value: [
      'MCP server started.',
      '',
      'Listening on stdio (line-delimited JSON-RPC 2.0).',
      'Send JSON-RPC requests on stdin, receive responses on stdout.',
      '',
      `Available methods: ${server.getMethodNames().join(', ')}`,
      '',
      'Use /mcpserver stop to shut down.',
    ].join('\n'),
  }
}

function handleStop(): { type: 'text'; value: string } {
  const server = getMcpServer()

  if (!server.isRunning) {
    return {
      type: 'text',
      value: 'MCP server is not running.',
    }
  }

  const stats = server.serverStats
  server.stop()

  return {
    type: 'text',
    value: [
      'MCP server stopped.',
      '',
      `  Requests handled: ${stats.requestsHandled}`,
      `  Errors:           ${stats.errorsCount}`,
      `  Sessions:         ${server.sessionCount}`,
    ].join('\n'),
  }
}

function handleStatus(): { type: 'text'; value: string } {
  const server = getMcpServer()

  if (!server.isRunning) {
    return {
      type: 'text',
      value: 'MCP server is not running. Use /mcpserver start to begin.',
    }
  }

  const stats = server.serverStats
  const uptimeMs = stats.startedAt
    ? Date.now() - new Date(stats.startedAt).getTime()
    : 0

  return {
    type: 'text',
    value: [
      'MCP Server Status',
      '',
      `  Running:          yes`,
      `  Transport:        stdio (line-delimited JSON)`,
      `  Protocol:         JSON-RPC 2.0`,
      `  Started at:       ${stats.startedAt}`,
      `  Uptime:           ${formatUptime(uptimeMs)}`,
      `  Requests handled: ${stats.requestsHandled}`,
      `  Errors:           ${stats.errorsCount}`,
      `  Active sessions:  ${server.sessionCount}`,
    ].join('\n'),
  }
}

function handleMethods(): { type: 'text'; value: string } {
  const server = getMcpServer()
  const methods = server.getMethodNames()

  const descriptions: Record<string, string> = {
    'session/start': 'Create a new session',
    'session/list': 'List active sessions',
    'session/resume': 'Resume an existing session',
    'turn/start': 'Send a user message, get assistant response',
    'turn/interrupt': 'Cancel current generation',
    'config/read': 'Read current configuration',
    'config/write': 'Update a config value',
    'model/list': 'List available models',
    'tools/list': 'List available tools',
    'status': 'Server health check',
    'shutdown': 'Graceful shutdown',
  }

  const lines = ['Available JSON-RPC methods:', '']
  for (const method of methods) {
    const desc = descriptions[method] ?? ''
    lines.push(`  ${method.padEnd(20)} ${desc}`)
  }

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
