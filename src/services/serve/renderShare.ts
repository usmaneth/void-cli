/**
 * Server-side HTML rendering of a shared session. Produces a standalone
 * page with OpenGraph metadata; no JS hydration required.
 */

import type { SessionMessage, SessionMetadata } from '../../sessions/index.js'

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Tiny markdown-esque renderer. Handles:
 *   - fenced code blocks ```lang ... ```
 *   - inline `code`
 *   - **bold** / *italic*
 *   - headings (#, ##, ###)
 *   - bullet lists (- item / * item)
 *   - paragraphs / line breaks
 *
 * It is intentionally minimal — we prefer safety over completeness.
 */
export function renderMarkdown(raw: string): string {
  const out: string[] = []
  const lines = raw.split('\n')
  let i = 0
  let inList = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  while (i < lines.length) {
    const line = lines[i]!

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      closeList()
      const lang = fence[1] ?? ''
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i]!.match(/^```\s*$/)) {
        buf.push(lines[i]!)
        i++
      }
      i++ // skip closing fence
      out.push(
        `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(
          buf.join('\n'),
        )}</code></pre>`,
      )
      continue
    }

    // Heading
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      closeList()
      const level = h[1]!.length
      out.push(`<h${level}>${inlineMd(h[2]!)}</h${level}>`)
      i++
      continue
    }

    // Bullet list
    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inlineMd(bullet[1]!)}</li>`)
      i++
      continue
    }

    // Blank line
    if (line.trim() === '') {
      closeList()
      i++
      continue
    }

    // Paragraph: gather consecutive non-blank, non-special lines
    closeList()
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.match(/^```/) &&
      !lines[i]!.match(/^(#{1,3})\s+/) &&
      !lines[i]!.match(/^[-*]\s+/)
    ) {
      paraLines.push(lines[i]!)
      i++
    }
    out.push(`<p>${inlineMd(paraLines.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }

  closeList()
  return out.join('\n')
}

function inlineMd(raw: string): string {
  // First escape HTML, then apply markdown substitutions.
  let s = escapeHtml(raw)
  // inline code
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // italic (avoid matching the **bold** we just did — bold already wrapped)
  s = s.replace(/(?<!<)\*([^*]+)\*(?!>)/g, '<em>$1</em>')
  // autolinks
  s = s.replace(
    /\b(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" rel="noopener nofollow" target="_blank">${url}</a>`,
  )
  return s
}

function renderToolBlock(tc: {
  name: string
  result: string
}): string {
  return [
    `<details class="tool">`,
    `  <summary><span class="tool-name">${escapeHtml(tc.name)}</span></summary>`,
    `  <pre class="tool-result">${escapeHtml(tc.result)}</pre>`,
    `</details>`,
  ].join('\n')
}

function renderMessage(msg: SessionMessage): string {
  const roleClass = `role-${msg.role}`
  const roleLabel =
    msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System'
  const body = renderMarkdown(msg.content)
  const tools =
    msg.toolCalls && msg.toolCalls.length > 0
      ? `<div class="tools">${msg.toolCalls.map(renderToolBlock).join('\n')}</div>`
      : ''
  const ts = new Date(msg.timestamp).toISOString()
  return [
    `<article class="msg ${roleClass}">`,
    `  <header class="msg-header">`,
    `    <span class="role">${roleLabel}</span>`,
    `    <time datetime="${ts}">${ts}</time>`,
    `  </header>`,
    `  <div class="body">${body}</div>`,
    tools,
    `</article>`,
  ].join('\n')
}

export interface RenderShareInput {
  metadata: SessionMetadata
  messages: SessionMessage[]
  shareId: string
  shareUrl: string
}

/** Render a full standalone HTML page for a shared session. */
export function renderSharePage(input: RenderShareInput): string {
  const { metadata, messages, shareId, shareUrl } = input

  const title = metadata.title || 'Shared Void session'
  const firstMsg =
    messages.find((m) => m.role === 'user')?.content ??
    messages.find((m) => m.role === 'assistant')?.content ??
    ''
  const description =
    firstMsg.slice(0, 160).replace(/\s+/g, ' ').trim() ||
    `Void session shared on ${new Date(metadata.createdAt).toDateString()}`

  const messagesHtml = messages.map(renderMessage).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — void</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(shareUrl)}">
<meta property="og:site_name" content="void">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex,nofollow">
<style>
  :root {
    color-scheme: light dark;
    --bg: #0d0d0f;
    --fg: #e8e8ea;
    --muted: #8a8a92;
    --border: #242428;
    --user: #3b82f6;
    --assistant: #22c55e;
    --accent: #E0000F;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI",
      Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 780px; margin: 0 auto; padding: 40px 20px 80px; }
  header.page {
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 20px;
  }
  header.page h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
  header.page .meta { color: var(--muted); font-size: 13px; }
  .msg {
    margin: 28px 0;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(255,255,255,0.01);
  }
  .msg-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 10px;
  }
  .role { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; }
  .role-user .role { color: var(--user); }
  .role-assistant .role { color: var(--assistant); }
  .role-system .role { color: var(--muted); }
  time { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .body p { margin: 0 0 10px; }
  .body h1,.body h2,.body h3 { margin: 16px 0 8px; line-height: 1.25; }
  pre.code, pre.tool-result {
    background: #111114;
    border: 1px solid var(--border);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    font: 13px/1.5 "Menlo", "SF Mono", ui-monospace, monospace;
    margin: 10px 0;
  }
  code { font: 13px/1.4 "Menlo", "SF Mono", ui-monospace, monospace; }
  details.tool {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    margin-top: 10px;
    background: rgba(224, 0, 15, 0.035);
  }
  details.tool summary { cursor: pointer; }
  .tool-name { color: var(--accent); font-weight: 600; }
  footer {
    border-top: 1px solid var(--border);
    padding-top: 16px;
    margin-top: 40px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }
  a { color: var(--user); }
</style>
</head>
<body>
<main>
  <header class="page">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>${messages.length} messages</span>
      &middot;
      <span>shared <time datetime="${new Date(metadata.createdAt).toISOString()}">${new Date(metadata.createdAt).toISOString()}</time></span>
      &middot;
      <span>share id <code>${escapeHtml(shareId)}</code></span>
    </div>
  </header>
  ${messagesHtml || '<p class="muted">(empty session)</p>'}
  <footer>Shared via <strong>void</strong> &middot; read-only</footer>
</main>
</body>
</html>`
}
