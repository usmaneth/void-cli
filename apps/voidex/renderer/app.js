'use strict'

const state = {
  mode: 'chat',
  model: 'sonnet',
  cwd: '~/',
  threadId: null,
  threadTitle: 'New thread',
  messages: [],
  tokens: 0,
  costUsd: 0,
}

const el = {
  messages: document.getElementById('messages'),
  empty: document.getElementById('emptyState'),
  composer: document.getElementById('composer'),
  btnAsk: document.getElementById('btnAsk'),
  btnCode: document.getElementById('btnCode'),
  btnMode: document.getElementById('btnMode'),
  btnModeLabel: document.getElementById('btnModeLabel'),
  btnModel: document.getElementById('btnModel'),
  btnModelLabel: document.getElementById('btnModelLabel'),
  modePopover: document.getElementById('modePopover'),
  modePill: document.getElementById('modePill'),
  threadTitle: document.getElementById('threadTitle'),
  threadModeChip: document.getElementById('threadModeChip'),
  threadModelChip: document.getElementById('threadModelChip'),
  threadList: document.getElementById('threadList'),
  projectName: document.getElementById('projectName'),
  cwdLine: document.getElementById('cwdLine'),
  modelLine: document.getElementById('modelLine'),
  statusText: document.getElementById('statusText'),
  statusTokens: document.getElementById('statusTokens'),
  statusCost: document.getElementById('statusCost'),
  reviewDrawer: document.getElementById('reviewDrawer'),
  btnCloseReview: document.getElementById('btnCloseReview'),
}

const MODE_LABELS = { chat: 'Chat', swarm: 'Swarm', deliberate: 'Deliberate', plan: 'Plan' }

function setMode(mode) {
  state.mode = mode
  const label = MODE_LABELS[mode] || 'Chat'
  el.btnModeLabel.textContent = label
  el.modePill.textContent = label
  el.threadModeChip.textContent = label
  el.modePopover.hidden = true
}

function setModel(name) {
  state.model = name
  el.btnModelLabel.textContent = name
  el.threadModelChip.textContent = name
  el.modelLine.textContent = name
}

function addMessage(role, body) {
  const msg = { role, body, at: Date.now() }
  state.messages.push(msg)
  renderMessage(msg)
  persistThread()
}

function renderMessage(msg) {
  if (el.empty && el.empty.parentElement) el.empty.remove()
  const wrap = document.createElement('div')
  wrap.className = `message ${msg.role}`
  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  avatar.textContent = msg.role === 'user' ? 'U' : msg.role === 'assistant' ? 'V' : '·'
  const body = document.createElement('div')
  body.className = 'body'
  body.textContent = msg.body
  wrap.appendChild(avatar)
  wrap.appendChild(body)
  el.messages.appendChild(wrap)
  el.messages.scrollTop = el.messages.scrollHeight
}

function setStatus(text) { el.statusText.textContent = text }

function buildPlannedCall(prompt) {
  switch (state.mode) {
    case 'swarm':
      return { command: '/swarm', args: prompt }
    case 'deliberate':
      return { command: '/deliberate', args: prompt }
    case 'plan':
      return { command: '/architect plan', args: prompt }
    default:
      return { command: 'chat', args: prompt }
  }
}

function respondStub(prompt, intent) {
  // Electron renderer is sandboxed — it doesn't call the LLM directly.
  // It stages a call that the CLI or bridge process will execute, and
  // shows a local stub so the UI feels alive without faking answers.
  const planned = buildPlannedCall(prompt)
  const preview =
    planned.command === 'chat'
      ? `(${intent}) Voidex will send this to ${state.model} via the Void orchestrator.`
      : `(${intent}) Voidex will dispatch ${planned.command} "${planned.args.slice(0, 80)}${planned.args.length > 80 ? '…' : ''}".`
  addMessage('system', preview)
  addMessage(
    'assistant',
    'Connect this window to your running Void CLI session (bridge coming soon) to stream a real reply here.\n\n' +
      'For now, you can run the same request in your terminal:\n\n' +
      (planned.command === 'chat'
        ? `  void -p "${prompt.replace(/"/g, '\\"')}" --model ${state.model}`
        : `  void\n  > ${planned.command} ${planned.args}`),
  )
}

function submit(intent) {
  const value = el.composer.value.trim()
  if (!value) return
  addMessage('user', value)
  el.composer.value = ''
  el.composer.style.height = ''
  setStatus(`${intent === 'ask' ? 'Asking' : 'Running'} via ${state.mode}…`)
  setTimeout(() => {
    respondStub(value, intent)
    setStatus('Ready')
  }, 240)
}

el.composer.addEventListener('input', () => {
  el.composer.style.height = 'auto'
  el.composer.style.height = Math.min(el.composer.scrollHeight, 220) + 'px'
})

el.composer.addEventListener('keydown', e => {
  const isSubmit = e.key === 'Enter' && (e.metaKey || e.ctrlKey)
  const isPlain = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey
  if (isSubmit) { e.preventDefault(); submit('code') }
  else if (isPlain) { e.preventDefault(); submit('ask') }
})

el.btnAsk.addEventListener('click', () => submit('ask'))
el.btnCode.addEventListener('click', () => submit('code'))

el.btnMode.addEventListener('click', e => {
  e.stopPropagation()
  el.modePopover.hidden = !el.modePopover.hidden
})
document.addEventListener('click', () => { el.modePopover.hidden = true })
el.modePopover.addEventListener('click', e => {
  const btn = e.target.closest('button[data-mode]')
  if (btn) setMode(btn.dataset.mode)
})

document.querySelectorAll('.skill-list li').forEach(li => {
  li.addEventListener('click', () => {
    const skill = li.dataset.skill
    if (skill === 'review') {
      el.reviewDrawer.dataset.open = 'true'
      return
    }
    setMode(skill)
    el.composer.focus()
  })
})

el.btnCloseReview.addEventListener('click', () => { el.reviewDrawer.dataset.open = 'false' })

document.querySelectorAll('.quick').forEach(b => {
  b.addEventListener('click', () => {
    const k = b.dataset.quick
    const map = {
      ask: { mode: 'chat', text: 'Summarize this repository and its entry points.' },
      swarm: { mode: 'swarm', text: 'Add a settings screen with tabs for Account, Models, and Privacy.' },
      deliberate: { mode: 'deliberate', text: 'Should we migrate from REST to tRPC? Debate for 3 rounds.' },
      review: { mode: 'chat', text: 'Review the changes in my current branch.' },
    }
    const entry = map[k]
    if (!entry) return
    setMode(entry.mode)
    el.composer.value = entry.text
    el.composer.focus()
  })
})

async function refreshThreads() {
  if (!window.voidex) return
  const threads = await window.voidex.listThreads()
  el.threadList.innerHTML = ''
  for (const t of threads) {
    const li = document.createElement('li')
    li.className = 'thread-item' + (t.id === state.threadId ? ' active' : '')
    const title = document.createElement('span')
    title.className = 't-title'
    title.textContent = t.title || 'Untitled'
    const meta = document.createElement('span')
    meta.className = 't-meta'
    meta.textContent = MODE_LABELS[t.mode] || 'Chat'
    li.appendChild(title)
    li.appendChild(meta)
    el.threadList.appendChild(li)
  }
}

function newThreadId() {
  return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

async function persistThread() {
  if (!window.voidex) return
  if (!state.threadId) state.threadId = newThreadId()
  const first = state.messages.find(m => m.role === 'user')
  if (first && state.threadTitle === 'New thread') {
    state.threadTitle = first.body.slice(0, 60)
    el.threadTitle.textContent = state.threadTitle
  }
  await window.voidex.saveThread({
    id: state.threadId,
    title: state.threadTitle,
    mode: state.mode,
    model: state.model,
    messages: state.messages,
    updatedAt: Date.now(),
  })
  refreshThreads()
}

async function bootstrap() {
  if (!window.voidex) {
    setStatus('Running without Electron bridge — UI preview only.')
    return
  }
  const ctx = await window.voidex.getContext()
  if (ctx.cwd) {
    state.cwd = ctx.cwd
    const home = (ctx.cwd.match(/^\/(Users|home)\/[^/]+/) || [])[0]
    el.cwdLine.textContent = home ? ctx.cwd.replace(home, '~') : ctx.cwd
    const name = ctx.cwd.split('/').filter(Boolean).pop() || 'project'
    el.projectName.textContent = name
  }
  if (ctx.model) setModel(ctx.model)
  if (ctx.mode) setMode(ctx.mode)
  if (ctx.prompt) {
    el.composer.value = ctx.prompt
    el.composer.dispatchEvent(new Event('input'))
  }
  if (ctx.sessionId) setStatus(`Linked to session ${ctx.sessionId.slice(0, 8)}`)
  refreshThreads()
}

bootstrap()
