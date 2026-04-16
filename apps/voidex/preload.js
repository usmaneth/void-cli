'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voidex', {
  getContext: () => ipcRenderer.invoke('voidex:getContext'),
  listThreads: () => ipcRenderer.invoke('voidex:listThreads'),
  saveThread: thread => ipcRenderer.invoke('voidex:saveThread', thread),
  openExternal: url => ipcRenderer.invoke('voidex:openExternal', url),
  platform: process.platform,
})
