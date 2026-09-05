import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('maicer', {
  health: () => ipcRenderer.invoke('system:health'),
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  bootstrapRuntime: () => ipcRenderer.invoke('setup:bootstrap'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  readSelection: () => ipcRenderer.invoke('context:read-selection'),
  checkLimit: () => ipcRenderer.invoke('pipeline:check-limit'),
  recordCompletion: (output: string, seconds: number) => ipcRenderer.invoke('pipeline:record-completion', output, seconds),
  todayMetrics: () => ipcRenderer.invoke('metrics:today'),
  transcribe: (audio: ArrayBuffer) => ipcRenderer.invoke('pipeline:transcribe', audio),
  generate: (input: { transcript: string; context: string; outsideIde: boolean; requestId?: number }) => ipcRenderer.invoke('pipeline:generate', input),
  copy: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  typeOutput: (text: string) => ipcRenderer.invoke('pipeline:type-output', text),
  typingStatus: () => ipcRenderer.invoke('pipeline:typing-status'),
  cancelGeneration: (requestId: number) => ipcRenderer.invoke('pipeline:cancel', requestId),
  openCheckout: () => ipcRenderer.invoke('billing:open-checkout'),
  joinWaitlist: (email: string) => ipcRenderer.invoke('waitlist:join', email),
  hasLicense: () => ipcRenderer.invoke('license:has-token'),
  setLicense: (token: string) => ipcRenderer.invoke('license:set', token),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (session: { title: string; transcript: string; output: string; context: string }) => ipcRenderer.invoke('sessions:save', session),
  onChunk: (callback: (chunk: { requestId?: number; chunk: string }) => void) => { const listener = (_event: Electron.IpcRendererEvent, chunk: { requestId?: number; chunk: string }) => callback(chunk); ipcRenderer.on('pipeline:chunk', listener); return () => ipcRenderer.removeListener('pipeline:chunk', listener); },
  onComplete: (callback: (result: { requestId?: number; typed: boolean }) => void) => { const listener = (_event: Electron.IpcRendererEvent, result: { requestId?: number; typed: boolean }) => callback(result); ipcRenderer.on('pipeline:complete', listener); return () => ipcRenderer.removeListener('pipeline:complete', listener); },
  onOverlayOpened: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('overlay:opened', listener); return () => ipcRenderer.removeListener('overlay:opened', listener); },
  onHotkey: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('hotkey:pressed', listener); return () => ipcRenderer.removeListener('hotkey:pressed', listener); },
  onSetupProgress: (callback: (progress: { phase: string; percent: number; detail: string }) => void) => { const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; detail: string }) => callback(progress); ipcRenderer.on('setup:progress', listener); return () => ipcRenderer.removeListener('setup:progress', listener); }
});