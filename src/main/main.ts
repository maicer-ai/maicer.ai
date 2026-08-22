import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage, safeStorage, shell, Tray } from 'electron';
import Store from 'electron-store';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';

const API_URL = process.env.VOICE_CODE_API_URL ?? 'https://api.voicecode.local';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_INSTALLER_URL = process.env.OLLAMA_INSTALLER_URL ?? 'https://ollama.com/download/OllamaSetup.exe';
const PUBLIC_WHISPER_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip';
const PUBLIC_QWEN_URL = 'https://huggingface.co/bartowski/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf?download=true';
const QWEN_MODEL_NAME = 'qwen2.5-coder:0.5b';
const ASSET_ROOT = path.join(app.getPath('userData'), 'runtime');
const ASSET_MANIFEST_URL = process.env.VOICE_CODE_ASSET_MANIFEST_URL;
const NETWORK_TIMEOUT_MS = 30_000;
type AssetConfig = { whisperUrl?: string; whisperSha256?: string; qwenUrl?: string; qwenSha256?: string; ollamaInstallerUrl?: string; ollamaInstallerSha256?: string };
type Session = { id: string; title: string; transcript: string; output: string; context: string; createdAt: number };
const store = new Store<{ encryptedToken?: string; completionTimestamps?: number[]; sessions?: Session[] }>();
const tokenStore = store as unknown as { store: { encryptedToken?: string; completionTimestamps?: number[]; sessions?: Session[] } };
const robot: { keyTap(key: string, modifiers?: string[]): void; typeString(text: string): void; setKeyboardDelay?(milliseconds: number): void } | undefined = (() => {
  try { return require('robotjs') as { keyTap(key: string, modifiers?: string[]): void; typeString(text: string): void; setKeyboardDelay?(milliseconds: number): void }; } catch { return undefined; }
})();
robot?.setKeyboardDelay?.(1);
let window: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  window = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 620,
    minHeight: 480,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.setAlwaysOnTop(true, 'floating');
  window.setSkipTaskbar(true);
  window.on('closed', () => { window = null; });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function whisperPath() {
  return process.env.WHISPER_EXECUTABLE ?? path.join(ASSET_ROOT, 'whisper', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
}

function qwenModelPath() {
  return path.join(ASSET_ROOT, 'qwen', 'qwen2.5-coder-0.5b.gguf');
}

async function assetConfig(): Promise<AssetConfig> {
  if (!ASSET_MANIFEST_URL) return { whisperUrl: process.env.WHISPER_DOWNLOAD_URL ?? PUBLIC_WHISPER_URL, whisperSha256: process.env.WHISPER_SHA256, qwenUrl: process.env.QWEN_MODEL_DOWNLOAD_URL ?? PUBLIC_QWEN_URL, qwenSha256: process.env.QWEN_MODEL_SHA256, ollamaInstallerUrl: OLLAMA_INSTALLER_URL, ollamaInstallerSha256: process.env.OLLAMA_INSTALLER_SHA256 };
  try {
    const response = await fetch(ASSET_MANIFEST_URL, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Asset manifest returned ${response.status}`);
    const manifest = await response.json() as AssetConfig;
    for (const url of [manifest.whisperUrl, manifest.qwenUrl, manifest.ollamaInstallerUrl]) {
      if (url && !url.startsWith('https://')) throw new Error('Asset manifest contains a non-HTTPS URL');
    }
    return manifest;
  } catch {
    return { whisperUrl: process.env.WHISPER_DOWNLOAD_URL ?? PUBLIC_WHISPER_URL, whisperSha256: process.env.WHISPER_SHA256, qwenUrl: process.env.QWEN_MODEL_DOWNLOAD_URL ?? PUBLIC_QWEN_URL, qwenSha256: process.env.QWEN_MODEL_SHA256, ollamaInstallerUrl: OLLAMA_INSTALLER_URL, ollamaInstallerSha256: process.env.OLLAMA_INSTALLER_SHA256 };
  }
}

async function runtimeStatus() {
  let ollama = false;
  let model = false;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    ollama = response.ok;
    if (ollama) {
      const data = await response.json() as { models?: Array<{ name?: string }> };
      model = Boolean(data.models?.some((item) => item.name?.startsWith(QWEN_MODEL_NAME)));
    }
  } catch { /* runtime is not installed or started yet */ }
  let whisper = false;
  try { await fs.access(whisperPath()); whisper = true; } catch { /* first-run download is pending */ }
  let qwenAsset = false;
  try { await fs.access(qwenModelPath()); qwenAsset = true; } catch { /* first-run download is pending */ }
  return { ollama, model, whisper, qwenAsset, ready: ollama && model && whisper && qwenAsset };
}

async function waitForOllama(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await runtimeStatus();
    if (status.ollama) return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Ollama did not start within the setup window. Please relaunch Voice Code to retry.');
}

function sendSetupProgress(phase: string, percent: number, detail: string) {
  window?.webContents.send('setup:progress', { phase, percent, detail });
}

function typeStreamChunk(text: string) {
  if (!robot) return;
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  lines.forEach((line, index) => {
    if (line) robot.typeString(line);
    if (index < lines.length - 1) robot.keyTap('enter');
  });
}

async function downloadFile(url: string, destination: string, expectedSha256: string | undefined, label: string, archiveEntry?: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  const reader = response.body.getReader();
  const partial = `${destination}.part`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const file = await fs.open(partial, 'w');
  const hash = createHash('sha256');
  let received = 0;
  const total = Number(response.headers.get('content-length') ?? 0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      await file.write(chunk);
      hash.update(chunk);
      received += chunk.length;
      sendSetupProgress('downloading', total ? Math.round((received / total) * 100) : 20, `${label}${total ? ` · ${Math.round(received / 1_000_000)} MB` : ''}`);
    }
  } finally {
    await file.close();
  }
  if (expectedSha256 && hash.digest('hex').toLowerCase() !== expectedSha256.toLowerCase()) { await fs.rm(partial, { force: true }); throw new Error('Downloaded asset failed integrity verification'); }
  if (archiveEntry) {
    const archive = new AdmZip(await fs.readFile(partial));
    const entry = archive.getEntry(archiveEntry) ?? archive.getEntries().find((item) => item.entryName.toLowerCase().endsWith('whisper-cli.exe'));
    if (!entry) { await fs.rm(partial, { force: true }); throw new Error('Whisper archive did not contain whisper-cli.exe'); }
    await fs.writeFile(destination, entry.getData());
    await fs.rm(partial, { force: true });
  } else await fs.rename(partial, destination);
  if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
}

async function bootstrapRuntime() {
  const assets = await assetConfig();
  let status = await runtimeStatus();
  if (!status.ollama) {
    sendSetupProgress('ollama', 12, 'Ollama is not running. Downloading the official installer...');
    const installer = path.join(app.getPath('temp'), 'VoiceCode-OllamaSetup.exe');
    await downloadFile(assets.ollamaInstallerUrl ?? OLLAMA_INSTALLER_URL, installer, assets.ollamaInstallerSha256, 'Downloading Ollama installer');
    if (process.platform === 'win32') {
      const installerProcess = spawn(installer, ['/S'], { windowsHide: true, shell: false, detached: true });
      installerProcess.unref();
      sendSetupProgress('installing', 25, 'Installing Ollama in the background...');
      status = await waitForOllama(120000);
    } else {
      await shell.openPath(installer);
      return runtimeStatus();
    }
    sendSetupProgress('waiting', 25, 'Starting Ollama and checking the local runtime...');
  }
  if (!status.whisper) {
    const url = assets.whisperUrl;
    if (!url) { sendSetupProgress('whisper', 82, 'Voice engine download is not configured yet.'); return status; }
    sendSetupProgress('whisper', 82, 'Downloading local voice engine...');
    await downloadFile(url, whisperPath(), assets.whisperSha256, 'Downloading Whisper voice engine', url.endsWith('.zip') ? 'whisper-cli.exe' : undefined);
  }
  status = await runtimeStatus();
  if (!status.qwenAsset) {
    const url = assets.qwenUrl;
    if (!url) { sendSetupProgress('model', 70, 'Qwen 0.5B model download is not configured yet.'); return status; }
    sendSetupProgress('model', 55, 'Downloading Qwen 0.5B model weights...');
    await downloadFile(url, qwenModelPath(), assets.qwenSha256, 'Downloading Qwen 0.5B model weights');
  }
  status = await runtimeStatus();
  if (!status.model) {
    sendSetupProgress('model', 85, 'Registering Qwen 0.5B with Ollama...');
    const modelfile = `FROM ${qwenModelPath().replaceAll('\\', '/')}`;
    const response = await fetch(`${OLLAMA_URL}/api/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: QWEN_MODEL_NAME, modelfile, stream: false }) });
    if (!response.ok) throw new Error('Ollama could not register the downloaded Qwen model');
  }
  status = await runtimeStatus();
  sendSetupProgress(status.ready ? 'done' : 'waiting', status.ready ? 100 : 90, status.ready ? 'Local AI workspace ready.' : 'One local runtime component still needs attention.');
  return status;
}

function toggleOverlay() {
  if (!window) return;
  if (window.isVisible()) {
    window.webContents.send('hotkey:pressed');
  } else {
    window.setAlwaysOnTop(true, 'floating');
    window.showInactive();
    window.webContents.send('hotkey:pressed');
  }
}

async function checkOllama() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return { running: response.ok, model: response.ok ? QWEN_MODEL_NAME : undefined };
  } catch { return { running: false }; }
}

function localCompletionTimestamps() {
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recent = (tokenStore.store.completionTimestamps ?? []).filter((timestamp) => timestamp > cutoff);
  tokenStore.store = { ...tokenStore.store, completionTimestamps: recent };
  return recent;
}

async function checkLimit() {
  const localUsed = localCompletionTimestamps().length;
  try {
    const response = await fetch(`${API_URL}/api/check-limit`, { headers: authHeaders(), signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Quota check failed: ${response.status}`);
    const remote = await response.json() as { allowed: boolean; used: number; limit: number; tier: 'free' | 'pro' };
    const used = Math.max(remote.used, localUsed);
    return { ...remote, used, allowed: remote.tier === 'pro' || (remote.allowed && used < 5000) };
  } catch (error) {
    return { allowed: localUsed < 5000, used: localUsed, limit: 5000, tier: 'free' as const, warning: error instanceof Error ? error.message : 'Quota service unavailable' };
  }
}

function recordCompletion() {
  const recent = localCompletionTimestamps();
  tokenStore.store = { ...tokenStore.store, completionTimestamps: [...recent, Date.now()] };
  return { used: recent.length + 1, limit: 5000 };
}

function listSessions() {
  return (tokenStore.store.sessions ?? []).sort((left, right) => right.createdAt - left.createdAt);
}

function saveSession(session: Omit<Session, 'id' | 'createdAt'>) {
  const next: Session = { ...session, id: crypto.randomUUID(), createdAt: Date.now() };
  tokenStore.store = { ...tokenStore.store, sessions: [next, ...listSessions()].slice(0, 50) };
  return next;
}

function authHeaders(): Record<string, string> {
  const encrypted = tokenStore.store.encryptedToken;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return {};
  return { Authorization: `Bearer ${safeStorage.decryptString(Buffer.from(encrypted, 'base64'))}` };
}

ipcMain.handle('system:health', checkOllama);
ipcMain.handle('setup:status', runtimeStatus);
ipcMain.handle('setup:bootstrap', bootstrapRuntime);
ipcMain.handle('overlay:hide', () => { window?.hide(); return true; });
ipcMain.handle('context:read-selection', () => ({ text: clipboard.readText(), source: 'clipboard' }));
ipcMain.handle('license:set', (_event, token: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable on this device');
  tokenStore.store = { ...tokenStore.store, encryptedToken: safeStorage.encryptString(token).toString('base64') };
  return true;
});
ipcMain.handle('license:has-token', () => Boolean(tokenStore.store.encryptedToken));
ipcMain.handle('sessions:list', listSessions);
ipcMain.handle('sessions:save', (_event, session: Omit<Session, 'id' | 'createdAt'>) => saveSession(session));
ipcMain.handle('billing:open-checkout', () => shell.openExternal(process.env.STRIPE_CHECKOUT_URL ?? 'https://checkout.stripe.com/').then(() => true));
ipcMain.handle('clipboard:copy', (_event, text: string) => { clipboard.writeText(text); return true; });
ipcMain.handle('pipeline:check-limit', checkLimit);
ipcMain.handle('pipeline:record-completion', recordCompletion);
ipcMain.handle('pipeline:transcribe', async (_event, audio: ArrayBuffer) => {
  const executable = whisperPath();
  if (!executable) return { transcript: '', status: 'missing-whisper' };
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { windowsHide: true, shell: false });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => code === 0 ? resolve({ transcript: Buffer.concat(output).toString('utf8').trim(), status: 'ready' }) : reject(new Error(`Whisper exited with ${code}`)));
    child.stdin.write(Buffer.from(audio));
    child.stdin.end();
  });
});

ipcMain.handle('pipeline:generate', async (event, input: { transcript: string; context: string; outsideIde: boolean }) => {
  const prompt = input.outsideIde
    ? `Polish or complete this spoken request as natural text. Preserve intent and output only the result.\n\n${input.transcript}`
    : `Convert this spoken request into production-ready code. Resolve mid-sentence corrections by honoring the final instruction. Output ONLY raw code, with no markdown fences or explanation.\n\nRequest: ${input.transcript}\nSelected context:\n${input.context}`;
  const response = await fetch(`${OLLAMA_URL}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5 * 60 * 1000), body: JSON.stringify({ model: QWEN_MODEL_NAME, prompt, system: 'You are a precise local coding assistant. Never add commentary when code is requested.', stream: true }) });
  if (!response.ok || !response.body) throw new Error('Ollama is not ready. Start Ollama and try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split('\n').slice(0, -1)) {
      try {
        const chunk = JSON.parse(line) as { response?: string };
        if (chunk.response) {
          typeStreamChunk(chunk.response);
          event.sender.send('pipeline:chunk', chunk.response);
        }
      } catch { /* ignore incomplete provider lines */ }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  }
  event.sender.send('pipeline:complete', { typed: Boolean(robot) });
  return true;
});

app.whenReady().then(() => {
  if (!globalShortcut.register('CommandOrControl+Space', toggleOverlay)) console.error('Voice Code could not register Ctrl + Space');
  createWindow();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Voice Code');
  tray.on('click', toggleOverlay);
  void checkOllama().then((health) => window?.webContents.send('system:health', health));
});
app.on('will-quit', () => globalShortcut.unregisterAll());