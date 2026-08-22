import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('voiceCode', {
  health: () => ipcRenderer.invoke('system:health'),
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  bootstrapRuntime: () => ipcRenderer.invoke('setup:bootstrap'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  readSelection: () => ipcRenderer.invoke('context:read-selection'),
  checkLimit: () => ipcRenderer.invoke('pipeline:check-limit'),
  recordCompletion: () => ipcRenderer.invoke('pipeline:record-completion'),
  transcribe: (audio: ArrayBuffer) => ipcRenderer.invoke('pipeline:transcribe', audio),
  generate: (input: { transcript: string; context: string; outsideIde: boolean }) => ipcRenderer.invoke('pipeline:generate', input),
  copy: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  openCheckout: () => ipcRenderer.invoke('billing:open-checkout'),
  hasLicense: () => ipcRenderer.invoke('license:has-token'),
  setLicense: (token: string) => ipcRenderer.invoke('license:set', token),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (session: { title: string; transcript: string; output: string; context: string }) => ipcRenderer.invoke('sessions:save', session),
  onChunk: (callback: (chunk: string) => void) => { const listener = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk); ipcRenderer.on('pipeline:chunk', listener); return () => ipcRenderer.removeListener('pipeline:chunk', listener); },
  onComplete: (callback: (result: { typed: boolean }) => void) => { const listener = (_event: Electron.IpcRendererEvent, result: { typed: boolean }) => callback(result); ipcRenderer.on('pipeline:complete', listener); return () => ipcRenderer.removeListener('pipeline:complete', listener); },
  onOverlayOpened: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('overlay:opened', listener); return () => ipcRenderer.removeListener('overlay:opened', listener); },
  onHotkey: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('hotkey:pressed', listener); return () => ipcRenderer.removeListener('hotkey:pressed', listener); },
  onSetupProgress: (callback: (progress: { phase: string; percent: number; detail: string }) => void) => { const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; detail: string }) => callback(progress); ipcRenderer.on('setup:progress', listener); return () => ipcRenderer.removeListener('setup:progress', listener); }
});