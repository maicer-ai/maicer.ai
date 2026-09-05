import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';
import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { autoUpdater } from 'electron-updater';
import { APP_SHORTCUT, APP_SHORTCUT_LABEL } from '../shared/config';
import { FREE_MONTHLY_LIMIT, isWithinFreeQuota } from '../shared/quota';

type StoreData = { encryptedToken?: string; completionTimestamps?: number[]; monthlyCompletions?: { month: string; count: number }; dailyMetrics?: { date: string; value: DailyMetrics }; sessions?: Session[] };
type StoreInstance = { store: StoreData };
let storeInstance: StoreInstance | undefined;
const loadEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ default: new <T>() => StoreInstance }>;
const tokenStore = {
  get store(): StoreData { return storeInstance?.store ?? {}; },
  set store(value: StoreData) {
    if (!storeInstance) throw new Error('Secure local storage is not initialized');
    storeInstance.store = value;
  }
};

async function initializeStore() {
  if (!storeInstance) {
    const storeModule = await loadEsm('electron-store');
    storeInstance = new storeModule.default<StoreData>();
  }
  return storeInstance;
}

const API_URL = process.env.MAICER_API_URL ?? process.env.VOICE_CODE_API_URL ?? 'https://api.maicer.local';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_INSTALLER_URL = process.env.OLLAMA_INSTALLER_URL ?? 'https://ollama.ai/download/OllamaSetup.exe';
const PUBLIC_WHISPER_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip';
const PUBLIC_QWEN_URL = 'https://huggingface.co/bartowski/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf?download=true';
const QWEN_MODEL_NAME = 'qwen2.5-coder:0.5b';
const ASSET_ROOT = path.join(app.getPath('userData'), 'runtime');
const ASSET_MANIFEST_URL = process.env.MAICER_ASSET_MANIFEST_URL ?? process.env.VOICE_CODE_ASSET_MANIFEST_URL;
const NETWORK_TIMEOUT_MS = 30_000;
const MAX_SETUP_ATTEMPTS = 5;
const SETUP_ATTEMPT_TIMEOUT_MS = 120000;

type AssetConfig = { whisperUrl?: string; whisperSha256?: string; qwenUrl?: string; qwenSha256?: string; ollamaInstallerUrl?: string; ollamaInstallerSha256?: string };
type Session = { id: string; title: string; transcript: string; output: string; context: string; createdAt: number };
type DailyMetrics = { functions: number; lines: number; seconds: number };

let setupAttempts = 0;
let setupLastAttemptTime = 0;
const robot: { keyTap(key: string, modifiers?: string[]): void; typeString(text: string): void; setKeyboardDelay?(milliseconds: number): void } | undefined = (() => {
  try { return require('robotjs') as { keyTap(key: string, modifiers?: string[]): void; typeString(text: string): void; setKeyboardDelay?(milliseconds: number): void }; } catch { return undefined; }
})();
robot?.setKeyboardDelay?.(1);
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const generationControllers = new Map<number, AbortController>();

function configureAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => console.error('maicer update error:', error.message));
  autoUpdater.on('update-downloaded', (info) => console.log(`maicer ${info.version} downloaded; it will install on quit.`));
  void autoUpdater.checkForUpdates().catch((error: unknown) => console.error('maicer update check failed:', error instanceof Error ? error.message : error));
}

function dateKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function currentMonth() { return dateKey().slice(0, 7); }
function monthlyCompletions() { const value = tokenStore.store.monthlyCompletions; if (!value || value.month !== currentMonth()) { tokenStore.store = { ...tokenStore.store, monthlyCompletions: { month: currentMonth(), count: 0 } }; return 0; } return value.count; }
function licenseTier() { const token = tokenStore.store.encryptedToken ? safeStorage.decryptString(Buffer.from(tokenStore.store.encryptedToken, 'base64')) : ''; return token.startsWith('corporate:') ? 'corporate' : token.startsWith('pro:') ? 'pro' : undefined; }
function hasLicense() { return Boolean(licenseTier()); }
function dailyMetrics() { return tokenStore.store.dailyMetrics?.date === dateKey() ? tokenStore.store.dailyMetrics.value : { functions: 0, lines: 0, seconds: 0 }; }
function addDailyMetrics(output: string, seconds: number) { const current = dailyMetrics(); const functions = (output.match(/(?:async\s+function|function\s+|=>|\bdef\s+|\bclass\s+)/g) ?? []).length; const value = { functions: current.functions + functions, lines: current.lines + output.split('\n').length, seconds: current.seconds + seconds }; tokenStore.store = { ...tokenStore.store, dailyMetrics: { date: dateKey(), value } }; return value; }

function createWindow() {
  // FIX #6: Minimalist black theme with frameless, transparent window
  window = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: { 
      preload: path.join(__dirname, '../preload/preload.js'), 
      contextIsolation: true, 
      nodeIntegration: false, 
      sandbox: true 
    }
  });
  window.setAlwaysOnTop(true, 'floating');
  window.setSkipTaskbar(true);
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window?.hide();
    }
  });
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
  throw new Error('Ollama did not start within the setup window. Please relaunch maicer to retry.');
}

async function registerQwenModel() {
  const modelfilePath = path.join(ASSET_ROOT, 'qwen', 'Modelfile');
  const modelfileContent = `FROM ${qwenModelPath().replaceAll('\\', '/')}
PARAMETER temperature 0.7
PARAMETER top_k 40
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER num_batch 512`;
  await fs.writeFile(modelfilePath, modelfileContent, 'utf8');

  const { spawn: spawnProcess } = await import('child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess('ollama', ['create', QWEN_MODEL_NAME, '-f', modelfilePath], { windowsHide: true, shell: false });
    let stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Ollama model registration timed out')); }, NETWORK_TIMEOUT_MS);
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', () => reject(new Error('Ollama CLI is unavailable')));
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Ollama create exited with ${code ?? 'unknown status'}`));
    });
  }).catch(async (cliError) => {
    const response = await fetch(`${OLLAMA_URL}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: QWEN_MODEL_NAME, modelfile: modelfileContent, stream: false }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Ollama registration failed: ${errorData.error ?? (cliError instanceof Error ? cliError.message : 'unknown error')}`);
    }
  });
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

async function typeGeneratedOutput(text: string) {
  if (!robot) return { inserted: false, reason: 'native-input-unavailable' };
  const previousClipboard = clipboard.readText();
  try {
    window?.hide();
    await new Promise((resolve) => setTimeout(resolve, 100));
    clipboard.writeText(text);
    robot.keyTap('v', [process.platform === 'darwin' ? 'command' : 'control']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    clipboard.writeText(previousClipboard);
    return { inserted: true };
  } catch {
    clipboard.writeText(previousClipboard);
    return { inserted: false, reason: 'native-input-failed' };
  }
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
  // FIX #3: Workspace preparation loop with proper timeout and attempt tracking
  const now = Date.now();
  if (setupAttempts >= MAX_SETUP_ATTEMPTS) {
    if (now - setupLastAttemptTime < SETUP_ATTEMPT_TIMEOUT_MS) {
      throw new Error(`Setup has reached maximum attempts (${MAX_SETUP_ATTEMPTS}). Please restart maicer.`);
    }
    setupAttempts = 0;
  }
  
  setupAttempts++;
  setupLastAttemptTime = now;

  const assets = await assetConfig();
  let status = await runtimeStatus();
  if (!status.ollama) {
    sendSetupProgress('ollama', 12, 'Ollama is not running. Downloading the official installer...');
    const installer = path.join(app.getPath('temp'), 'maicer-OllamaSetup.exe');
    await downloadFile(assets.ollamaInstallerUrl ?? OLLAMA_INSTALLER_URL, installer, assets.ollamaInstallerSha256, 'Downloading Ollama installer');
    if (process.platform === 'win32') {
      const { spawn } = await import('child_process');
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
    await registerQwenModel();
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
  const month = currentMonth();
  const recent = (tokenStore.store.completionTimestamps ?? []).filter((timestamp) => dateKeyFor(timestamp).startsWith(month));
  tokenStore.store = { ...tokenStore.store, completionTimestamps: recent };
  return recent;
}

function dateKeyFor(timestamp: number) { const date = new Date(timestamp); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

async function checkLimit() {
  const monthUsed = monthlyCompletions();
  if (hasLicense()) return { allowed: true, used: monthUsed, limit: FREE_MONTHLY_LIMIT, tier: 'pro' as const };
  if (monthUsed >= FREE_MONTHLY_LIMIT) return { allowed: false, used: monthUsed, limit: FREE_MONTHLY_LIMIT, tier: 'free' as const };
  const localUsed = localCompletionTimestamps().length;
  try {
    const response = await fetch(`${API_URL}/api/check-limit`, { headers: authHeaders(), signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Quota check failed: ${response.status}`);
    const remote = await response.json() as { allowed: boolean; used: number; limit: number; tier: 'free' | 'pro' };
    const used = Math.max(remote.used, localUsed);
    return { ...remote, used, limit: remote.tier === 'pro' ? remote.limit : FREE_MONTHLY_LIMIT, allowed: remote.tier === 'pro' || (remote.allowed && isWithinFreeQuota(used)) };
  } catch (error) {
    return { allowed: isWithinFreeQuota(monthUsed), used: monthUsed, limit: FREE_MONTHLY_LIMIT, tier: 'free' as const, warning: error instanceof Error ? error.message : 'Quota service unavailable' };
  }
}

function recordCompletion(output = '', seconds = 0) {
  const recent = localCompletionTimestamps();
  tokenStore.store = { ...tokenStore.store, completionTimestamps: [...recent, Date.now()] };
  const next = monthlyCompletions() + 1;
  tokenStore.store = { ...tokenStore.store, monthlyCompletions: { month: currentMonth(), count: next } };
  return { used: next, limit: FREE_MONTHLY_LIMIT, metrics: addDailyMetrics(output, seconds) };
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

function validateHttpsUrl(value: string, label: string): string {
  if (!value || typeof value !== 'string') throw new Error(`${label} is not configured.`);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS.`);
  return value;
}

ipcMain.handle('system:health', checkOllama);
ipcMain.handle('setup:status', runtimeStatus);
ipcMain.handle('setup:bootstrap', bootstrapRuntime);
ipcMain.handle('overlay:hide', () => { window?.hide(); return true; });
ipcMain.handle('context:read-selection', () => ({ text: clipboard.readText(), source: 'clipboard' }));
ipcMain.handle('license:set', (_event, token: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable on this device');
  if (!token || typeof token !== 'string' || token.length < 3 || token.length > 1000) throw new Error('Invalid license token format');
  tokenStore.store = { ...tokenStore.store, encryptedToken: safeStorage.encryptString(token).toString('base64') };
  return true;
});
ipcMain.handle('waitlist:join', async (_event, email: string) => {
  const normalized = String(email ?? '').trim().toLowerCase();
  const safeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
  if (!safeEmail) throw new Error('Enter a valid email address.');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Waitlist signup is not configured yet.');

  const url = `${validateHttpsUrl(supabaseUrl, 'Supabase URL').replace(/\/$/, '')}/rest/v1/waitlist`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ email: safeEmail })
  });

  if (!response.ok) {
    const problem = response.status === 409 ? 'This email is already on the waitlist.' : 'Could not join the waitlist. Please try again.';
    throw new Error(problem);
  }

  return true;
});
ipcMain.handle('license:has-token', () => Boolean(tokenStore.store.encryptedToken));
ipcMain.handle('sessions:list', listSessions);
ipcMain.handle('sessions:save', (_event, session: Omit<Session, 'id' | 'createdAt'>) => saveSession(session));
ipcMain.handle('billing:open-checkout', () => {
  const checkoutUrl = process.env.STRIPE_CHECKOUT_URL ?? 'https://checkout.stripe.com/';
  validateHttpsUrl(checkoutUrl, 'Checkout URL');
  return shell.openExternal(checkoutUrl).then(() => true);
});
ipcMain.handle('clipboard:copy', (_event, text: string) => { clipboard.writeText(text); return true; });
ipcMain.handle('pipeline:type-output', (_event, text: string) => typeGeneratedOutput(text));
ipcMain.handle('pipeline:typing-status', () => ({ available: Boolean(robot), platform: process.platform }));
ipcMain.handle('pipeline:check-limit', checkLimit);
ipcMain.handle('pipeline:record-completion', (_event, output: string, seconds: number) => recordCompletion(output, seconds));
ipcMain.handle('metrics:today', () => dailyMetrics());
ipcMain.handle('pipeline:transcribe', async (_event, audio: ArrayBuffer) => {
  const { spawn: spawnProcess } = await import('child_process');
  const executable = whisperPath();
  if (!executable) return { transcript: '', status: 'missing-whisper' };
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [], { windowsHide: true, shell: false });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => code === 0 ? resolve({ transcript: Buffer.concat(output).toString('utf8').trim(), status: 'ready' }) : reject(new Error(`Whisper exited with ${code}`)));
    child.stdin.write(Buffer.from(audio));
    child.stdin.end();
  });
});

ipcMain.handle('pipeline:generate', async (event, input: { transcript: string; context: string; outsideIde: boolean; requestId?: number }) => {
  if (!hasLicense() && !isWithinFreeQuota(monthlyCompletions())) {
    const error = new Error('Monthly completion limit reached');
    error.name = 'QUOTA_EXCEEDED';
    throw error;
  }
  const controller = new AbortController();
  if (input.requestId !== undefined) generationControllers.set(input.requestId, controller);
  const prompt = `Convert this spoken request into production-ready code. Resolve mid-sentence corrections by honoring the final instruction. Output ONLY raw code, with no markdown fences or explanation.\n\nRequest: ${input.transcript}\nSelected context (optional):\n${input.context}`;
  const response = await fetch(`${OLLAMA_URL}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model: QWEN_MODEL_NAME, prompt, system: 'You are a precise local coding assistant. Never add commentary when code is requested.', stream: true }) });
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
          event.sender.send('pipeline:chunk', { requestId: input.requestId, chunk: chunk.response });
        }
      } catch { /* ignore incomplete provider lines */ }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  }
  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer) as { response?: string };
      if (chunk.response) event.sender.send('pipeline:chunk', { requestId: input.requestId, chunk: chunk.response });
    } catch { /* ignore an incomplete final provider line */ }
  }
  event.sender.send('pipeline:complete', { requestId: input.requestId, typed: false });
  if (input.requestId !== undefined) generationControllers.delete(input.requestId);
  return true;
});
ipcMain.handle('pipeline:cancel', (_event, requestId: number) => { generationControllers.get(requestId)?.abort(); generationControllers.delete(requestId); return true; });

app.on('ready', async () => {
  await initializeStore();
  configureAutoUpdater();
  if (!globalShortcut.register(APP_SHORTCUT, toggleOverlay)) console.error(`maicer could not register ${APP_SHORTCUT_LABEL}`);
  createWindow();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('maicer');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show maicer', click: () => { window?.showInactive(); } },
    { type: 'separator' },
    { label: 'Quit maicer', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleOverlay);
  void checkOllama().then((health) => window?.webContents.send('system:health', health));
});
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
