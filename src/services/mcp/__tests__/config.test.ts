/**
 * Tests for MCP config pure helpers.
 *
 * Focus is on the content-based dedup/signature logic and CCR proxy
 * URL unwrapping — the rest of this module touches filesystem/settings
 * state and is hard to exercise without heavy mocking.
 *
 * The dedup invariant is load-bearing: if two different config entry
 * points resolve to the same underlying MCP server, running both wastes
 * ~600 chars per turn on duplicate system prompt text.
 */
import { describe, expect, it } from 'vitest'
import {
  dedupPluginMcpServers,
  getMcpServerSignature,
  unwrapCcrProxyUrl,
} from '../config.js'
import type {
  McpServerConfig,
  ScopedMcpServerConfig,
} from '../types.js'

function scoped(config: McpServerConfig): ScopedMcpServerConfig {
  return { ...config, scope: 'user' } as ScopedMcpServerConfig
}

describe('getMcpServerSignature', () => {
  it('builds a stdio signature from command + args', () => {
    const sig = getMcpServerSignature({
      type: 'stdio',
      command: 'node',
      args: ['server.js', '--port', '3000'],
    })
    expect(sig).toMatch(/^stdio:/)
    expect(sig).toContain('node')
    expect(sig).toContain('server.js')
  })

  it('treats missing type as stdio (backwards compat)', () => {
    const sig = getMcpServerSignature({
      command: 'python',
      args: ['-m', 'server'],
    } as McpServerConfig)
    expect(sig).toMatch(/^stdio:/)
  })

  it('builds a url signature for http/sse servers', () => {
    const sig = getMcpServerSignature({
      type: 'http',
      url: 'https://mcp.example.com/v1',
    } as McpServerConfig)
    expect(sig).toBe('url:https://mcp.example.com/v1')
  })

  it('returns null for sdk servers (no command, no url)', () => {
    const sig = getMcpServerSignature({
      type: 'sdk',
      name: 'ide-extension',
    } as unknown as McpServerConfig)
    expect(sig).toBeNull()
  })

  it('two stdio servers with identical commands match signatures', () => {
    const a = getMcpServerSignature({
      command: 'node',
      args: ['server.js'],
    } as McpServerConfig)
    const b = getMcpServerSignature({
      command: 'node',
      args: ['server.js'],
      env: { FOO: 'bar' }, // env does not affect signature
    } as McpServerConfig)
    expect(a).toBe(b)
  })
})

describe('unwrapCcrProxyUrl', () => {
  it('returns non-proxy URLs unchanged', () => {
    const url = 'https://mcp.slack.com/v1'
    expect(unwrapCcrProxyUrl(url)).toBe(url)
  })

  it('unwraps the original vendor URL from a CCR proxy URL', () => {
    const original = 'https://mcp.slack.com/v1'
    const proxy = `https://claude.ai/v2/session_ingress/shttp/mcp/abc?mcp_url=${encodeURIComponent(
      original,
    )}`
    expect(unwrapCcrProxyUrl(proxy)).toBe(original)
  })

  it('falls back to the proxy URL when mcp_url param is missing', () => {
    const proxy = 'https://claude.ai/v2/ccr-sessions/xyz'
    expect(unwrapCcrProxyUrl(proxy)).toBe(proxy)
  })
})

describe('dedupPluginMcpServers', () => {
  it('keeps plugin servers when no manual duplicates exist', () => {
    const plugin = {
      'plugin:p:a': scoped({
        command: 'node',
        args: ['a.js'],
      } as McpServerConfig),
    }
    const manual = {}
    const { servers, suppressed } = dedupPluginMcpServers(plugin, manual)
    expect(Object.keys(servers)).toEqual(['plugin:p:a'])
    expect(suppressed).toEqual([])
  })

  it('suppresses a plugin server that duplicates a manual server', () => {
    const manualConfig = scoped({
      command: 'node',
      args: ['server.js'],
    } as McpServerConfig)
    const pluginConfig = scoped({
      command: 'node',
      args: ['server.js'],
    } as McpServerConfig)

    const { servers, suppressed } = dedupPluginMcpServers(
      { 'plugin:p:dup': pluginConfig },
      { manual: manualConfig },
    )

    expect(servers).toEqual({})
    expect(suppressed).toEqual([{ name: 'plugin:p:dup', duplicateOf: 'manual' }])
  })

  it('when two plugin servers match, first one wins', () => {
    const cfg = scoped({
      command: 'node',
      args: ['same.js'],
    } as McpServerConfig)
    const { servers, suppressed } = dedupPluginMcpServers(
      {
        'plugin:a:srv': cfg,
        'plugin:b:srv': cfg,
      },
      {},
    )
    expect(Object.keys(servers)).toEqual(['plugin:a:srv'])
    expect(suppressed).toEqual([
      { name: 'plugin:b:srv', duplicateOf: 'plugin:a:srv' },
    ])
  })

  it('keeps sdk-type plugin servers (null signature) unconditionally', () => {
    const sdk = scoped({
      type: 'sdk',
      name: 'claude-vscode',
    } as unknown as McpServerConfig)
    const { servers, suppressed } = dedupPluginMcpServers(
      { 'plugin:ide:sdk': sdk },
      {},
    )
    expect(Object.keys(servers)).toEqual(['plugin:ide:sdk'])
    expect(suppressed).toEqual([])
  })
})
