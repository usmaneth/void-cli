/**
 * /messages slash command — inter-agent messaging and communication.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getMessageBus } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const bus = getMessageBus()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'log' || sub === 'history') {
    const limit = parts[1] ? parseInt(parts[1], 10) : 20
    const history = bus.getHistory(limit)
    if (history.length === 0) return { type: 'text', value: 'No messages in history.' }
    const lines = ['Message History:', '']
    for (const m of history) {
      const time = new Date(m.timestamp).toLocaleTimeString()
      const arrow = m.type === 'handoff' ? '⇒' : m.type === 'response' ? '←' : '→'
      lines.push(`  [${time}] ${m.from} ${arrow} ${m.to} (${m.type}): ${m.subject}`)
      if (m.body.length <= 80) lines.push(`    ${m.body}`)
      else lines.push(`    ${m.body.slice(0, 77)}...`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'send') {
    const toAgent = parts[1]
    const message = parts.slice(2).join(' ')
    if (!toAgent || !message) return { type: 'text', value: 'Usage: /messages send <agent_id> <message>' }
    const msg = bus.notify('user', toAgent, 'User message', message)
    return { type: 'text', value: `Message sent to ${toAgent} (${msg.id})` }
  }

  if (sub === 'inbox') {
    const agentId = parts[1] ?? 'user'
    const messages = bus.getMessages(agentId, true)
    if (messages.length === 0) return { type: 'text', value: `No unread messages for ${agentId}.` }
    const lines = [`Inbox for ${agentId} (${messages.length} unread):`, '']
    for (const m of messages) {
      lines.push(`  [${m.id}] From: ${m.from} | ${m.type}: ${m.subject}`)
      lines.push(`    ${m.body.slice(0, 80)}`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'agents') {
    const agents = bus.getAgentList()
    if (agents.length === 0) return { type: 'text', value: 'No agents registered on message bus.' }
    const lines = ['Registered agents:', ...agents.map(a => `  - ${a}`)]
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'broadcast') {
    const message = parts.slice(1).join(' ')
    if (!message) return { type: 'text', value: 'Usage: /messages broadcast <message>' }
    const msgs = bus.broadcast('user', 'Broadcast', message)
    return { type: 'text', value: `Broadcast sent to ${msgs.length} agent(s).` }
  }

  if (sub === 'stats') {
    const s = bus.getStats()
    return { type: 'text', value: `Message Bus Stats:\n  Total messages: ${s.totalMessages}\n  Pending: ${s.pending}\n  Delivered: ${s.delivered}\n  Agents: ${s.agents}\n  By type: ${Object.entries(s.byType).map(([k, v]) => `${k}=${v}`).join(', ')}` }
  }

  if (sub === 'clear') {
    bus.clearAll()
    return { type: 'text', value: 'All messages cleared.' }
  }

  if (sub === 'expire') {
    const count = bus.expireOld()
    return { type: 'text', value: `Expired ${count} old message(s).` }
  }

  // Default: show status
  const s = bus.getStats()
  const agents = bus.getAgentList()
  const lines = [
    `Message Bus: ${agents.length} agents, ${s.totalMessages} messages`,
    '',
    `Agents: ${agents.length > 0 ? agents.join(', ') : 'none'}`,
    `Pending: ${s.pending} | Delivered: ${s.delivered}`,
    '',
    'Commands: /messages <log|send|inbox|agents|broadcast|stats|clear|expire>',
  ]
  return { type: 'text', value: lines.join('\n') }
}

const messages = {
  type: 'local',
  name: 'messages',
  description: 'Inter-agent messaging and communication',
  argumentHint: '<log|send|inbox|agents|broadcast|stats|clear>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default messages
