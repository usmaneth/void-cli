'use strict'

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820
const MIN_WIDTH = 960
const MIN_HEIGHT = 640

function readCliContext() {
  const ctx = {
    mode: process.env.VOIDEX_MODE || 'chat',
    prompt: process.env.VOIDEX_PROMPT || '',
    cwd: process.env.VOIDEX_CWD || process.cwd(),
    sessionId: process.env.VOIDEX_SESSION_ID || '',
    model: process.env.VOIDEX_MODEL || '',
    models: (process.env.VOIDEX_MODELS || '').split(',').map(s => s.trim()).filter(Boolean),
    rounds: Number(process.env.VOIDEX_ROUNDS || '0') || undefined,
  }
  const handoffPath = process.env.VOIDEX_HANDOFF
  if (handoffPath && fs.existsSync(handoffPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(handoffPath, 'utf8'))
      Object.assign(ctx, raw)
    } catch {}
  }
  return ctx
}

function createWindow() {
  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#0b0b0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Voidex',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  return win
}

app.whenReady().then(() => {
  const ctx = readCliContext()

  ipcMain.handle('voidex:getContext', () => ctx)

  ipcMain.handle('voidex:listThreads', () => {
    const dir = path.join(os.homedir(), '.void', 'voidex', 'threads')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
          return { id: t.id, title: t.title, mode: t.mode, updatedAt: t.updatedAt }
        } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  })

  ipcMain.handle('voidex:saveThread', (_e, thread) => {
    const dir = path.join(os.homedir(), '.void', 'voidex', 'threads')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${thread.id}.json`)
    fs.writeFileSync(file, JSON.stringify(thread, null, 2))
    return { ok: true, file }
  })

  ipcMain.handle('voidex:openExternal', (_e, url) => shell.openExternal(url))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
