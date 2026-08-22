import { Activity, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, Clipboard, Code2, Copy, Cpu, createIcons, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, Sparkles, Terminal, Wifi, X, Zap } from 'lucide';
import './styles.css';

type State = 'idle' | 'recording' | 'thinking' | 'streaming' | 'paywall';
let state: State = 'idle';
let transcript = '';
let generated = '';
let recorder: MediaRecorder | undefined;
let chunks: Blob[] = [];
let setupReady = false;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="setup-screen" class="setup-screen hidden"><div class="setup-card"><div class="setup-logo"><i data-lucide="sparkles"></i></div><span class="eyebrow">FIRST-RUN SETUP</span><h1>Preparing your<br><em>local workspace.</em></h1><p id="setup-detail">Checking your local AI tools...</p><div class="setup-progress"><span id="setup-progress-bar"></span></div><div class="setup-progress-meta"><span id="setup-phase">Checking</span><span id="setup-percent">0%</span></div><div class="setup-points"><span><i data-lucide="lock-keyhole"></i> Private on your device</span><span><i data-lucide="zap"></i> Ready when complete</span></div></div></div>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><i data-lucide="zap"></i></span><div><strong>VOICE CODE</strong><small>LOCAL WORKSPACE</small></div></div>
      <div class="workspace-switcher"><span class="workspace-avatar">VC</span><span><b>Personal workspace</b><small>Free plan</small></span><i data-lucide="arrow-up-right"></i></div>
      <nav class="nav"><span class="nav-label">Workspace</span><button class="nav-item active" data-view="dashboard"><i data-lucide="layout-dashboard"></i> Home</button><button class="nav-item" data-view="history"><i data-lucide="history"></i> History <span class="nav-count">12</span></button><span class="nav-label">Library</span><button class="nav-item" data-view="commands"><i data-lucide="terminal"></i> Commands</button><button class="nav-item" data-view="dictionary"><i data-lucide="book-open"></i> Dictionary</button><span class="nav-label">Connect</span><button class="nav-item" data-view="integrations"><i data-lucide="plug"></i> Integrations</button><button class="nav-item" data-view="settings"><i data-lucide="settings"></i> Settings</button></nav>
      <div class="sidebar-bottom"><div class="upgrade-mini"><div class="upgrade-top"><i data-lucide="sparkles"></i><span>Voice Code Pro</span></div><p>Unlimited completions and priority models.</p><button id="sidebar-upgrade">Upgrade <i data-lucide="arrow-up-right"></i></button></div><div class="user-row"><span class="user-avatar">SR</span><span><b>Sarah R.</b><small>sarah@voicecode.dev</small></span><button class="icon-button"><i data-lucide="settings"></i></button></div></div>
    </aside>
    <section class="content-shell">
      <header class="topbar"><div><span class="breadcrumb">Personal workspace / <b>Home</b></span><h2>Good morning, Sarah <span class="wave-hand">✦</span></h2></div><div class="top-actions"><span class="privacy"><i data-lucide="lock-keyhole"></i> Local-first</span><button class="icon-button" aria-label="Help" data-view="help"><i data-lucide="circle-help"></i></button><button id="close" class="icon-button" aria-label="Close"><i data-lucide="x"></i></button></div></header>
      <div class="dashboard-grid">
        <section class="main-column"><div class="hero-line"><div><div class="eyebrow"><i data-lucide="activity"></i> VOICE TO CODE</div><h1>Say what you mean.<br><em>Ship what you say.</em></h1><p>Press, speak, and get clean code inserted into your active app.</p></div><div class="hotkey-hint"><span class="live-dot"></span><kbd>Ctrl</kbd><span>+</span><kbd>Space</kbd><small>activate anywhere</small></div></div>
          <section class="capture-panel"><div class="capture-heading"><div><span class="eyebrow">READY TO LISTEN</span><h3>Your next command</h3></div><span class="model-pill"><i data-lucide="cpu"></i> Local · Qwen 2.5</span></div><div id="wave" class="wave idle-wave" aria-hidden="true">${Array.from({ length: 36 }, (_, index) => `<span style="--i:${index}"></span>`).join('')}</div><button id="record" class="record-button"><span class="record-icon"><i data-lucide="mic"></i></span><span id="record-label">Press to speak</span><kbd>Ctrl + Space</kbd></button><div class="capture-meta"><span id="capture-state">Microphone ready</span><span class="privacy"><i data-lucide="check"></i> Private by default</span></div></section>
          <section id="result" class="result-panel hidden"><div class="result-header"><div><span class="eyebrow"><i data-lucide="code-2"></i> GENERATED OUTPUT</span><span id="result-state" class="result-state">Streaming to active app</span></div><button id="dismiss" class="icon-button" aria-label="Dismiss"><i data-lucide="x"></i></button></div><pre id="output"></pre><div class="actions"><button id="copy" class="secondary"><i data-lucide="copy"></i> Copy</button><button id="regenerate" class="secondary"><i data-lucide="refresh-cw"></i> Regenerate</button></div></section>
          <div class="section-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Latest sessions</h3></div><button class="text-button" data-view="history">View all <i data-lucide="arrow-up-right"></i></button></div><div class="session-list"><div class="session-item"><span class="session-icon purple"><i data-lucide="code-2"></i></span><div><b>Refactor auth middleware</b><small>TypeScript · 4 minutes ago</small></div><span class="session-lines">42 lines</span></div><div class="session-item"><span class="session-icon green"><i data-lucide="code-2"></i></span><div><b>Add optimistic updates to feed</b><small>React · Yesterday</small></div><span class="session-lines">28 lines</span></div><div class="session-item"><span class="session-icon amber"><i data-lucide="code-2"></i></span><div><b>Explain this error and fix it</b><small>Python · Yesterday</small></div><span class="session-lines">12 lines</span></div></div>
        </section>
        <aside class="right-rail"><section class="rail-card runtime-card"><div class="rail-heading"><span><i data-lucide="wifi"></i> LOCAL RUNTIME</span><span id="runtime-status" class="status-label">Checking</span></div><div class="runtime-row"><span class="runtime-icon"><i data-lucide="cpu"></i></span><div><b>Ollama</b><small id="status-text">Initializing...</small></div><span id="status-dot" class="dot"></span></div><div class="runtime-row"><span class="runtime-icon"><i data-lucide="mic"></i></span><div><b>Whisper</b><small>Local transcription</small></div><span class="dot online"></span></div></section><section class="rail-card usage-card"><div class="rail-heading"><span><i data-lucide="bar-chart-3"></i> THIS WEEK</span><button class="icon-button" data-view="analytics"><i data-lucide="arrow-up-right"></i></button></div><div id="usage-count" class="usage-number">0 <small>/ 5,000</small></div><div class="progress"><span id="usage-progress"></span></div><div class="usage-foot"><span id="usage-remaining">5,000 completions left</span><b id="usage-percent">0%</b></div><button id="upgrade" class="rail-upgrade">Unlock unlimited <i data-lucide="sparkles"></i></button></section><section class="rail-card privacy-card"><span class="privacy-icon"><i data-lucide="lock-keyhole"></i></span><div><b>Your code stays yours.</b><p>Audio and context are processed locally. Nothing leaves your machine.</p></div></section></aside>
      </div>
      <section id="view-panel" class="view-panel hidden"></section>
      <section id="paywall" class="paywall hidden"><div class="paywall-icon"><i data-lucide="sparkles"></i></div><div><span class="eyebrow">FREE PLAN LIMIT REACHED</span><h2>Your next 5,000 completions are waiting.</h2><p>Upgrade to Pro for unlimited local voice-to-code completions.</p></div><button id="paywall-upgrade" class="primary">Upgrade to Pro <strong>$15/mo</strong></button></section>
      <footer><span><i data-lucide="lock-keyhole"></i> End-to-end local processing</span><span class="build">Voice Code v0.1.0</span></footer>
    </section>
  </main>`;

createIcons({ icons: { Activity, ArrowUpRight, BarChart3, BookOpen, Check, Clipboard, Code2, Copy, Cpu, CircleHelp, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, Sparkles, Terminal, Wifi, X, Zap } });
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const wave = $('#wave');
const result = $('#result');
const output = $('#output');
const statusText = $('#status-text');
const dashboard = $('.dashboard-grid');
const viewPanel = $('#view-panel');
const setupScreen = $('#setup-screen');

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] ?? character));
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} hr ago` : `${Math.round(minutes / 1440)} days ago`;
}

async function showView(view: string) {
  if (view === 'dashboard') { dashboard.classList.remove('hidden'); viewPanel.classList.add('hidden'); return; }
  dashboard.classList.add('hidden'); viewPanel.classList.remove('hidden');
  if (view === 'history') {
    const sessions = await window.voiceCode.listSessions();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="history"></i> WORKSPACE</span><h1>Session history</h1><p>Your locally stored voice-to-code sessions.</p></div><span class="view-meta">${sessions.length} saved</span></div><div class="full-session-list">${sessions.length ? sessions.map((session) => `<article class="full-session"><div><b>${escapeHtml(session.title)}</b><small>${relativeTime(session.createdAt)} · ${session.output.split('\n').length} lines</small></div><button class="secondary session-open" data-session-id="${session.id}"><i data-lucide="code-2"></i> View output</button></article>`).join('') : '<div class="empty-state"><i data-lucide="history"></i><h3>No sessions yet</h3><p>Your completed generations will appear here.</p></div>'}</div>`;
  } else if (view === 'analytics') {
    const limit = await window.voiceCode.checkLimit();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="bar-chart-3"></i> WORKSPACE</span><h1>Usage</h1><p>Keep an eye on your rolling seven-day completion budget.</p></div></div><div class="analytics-grid"><div class="analytics-stat"><small>COMPLETIONS USED</small><strong>${limit.used.toLocaleString()}</strong><span>of ${limit.limit.toLocaleString()} available</span></div><div class="analytics-stat"><small>REMAINING</small><strong>${Math.max(0, limit.limit - limit.used).toLocaleString()}</strong><span>resets on a rolling basis</span></div><div class="analytics-stat"><small>PLAN</small><strong>${limit.tier === 'pro' ? 'Pro' : 'Free'}</strong><span>${limit.tier === 'pro' ? 'Unlimited usage' : 'Upgrade for unlimited'}</span></div></div><div class="usage-large"><div class="progress"><span style="width:${Math.min(100, Math.round((limit.used / limit.limit) * 100))}%"></span></div><p>${Math.round((limit.used / limit.limit) * 100)}% of the free allowance used</p></div>`;
  } else if (view === 'settings') {
    const hasLicense = await window.voiceCode.hasLicense();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="settings"></i> CONFIGURE</span><h1>Settings</h1><p>Connect your local tools and Voice Code account.</p></div></div><div class="settings-list"><label class="setting-row"><span><b>License token</b><small>Encrypted locally with Electron safeStorage.</small></span><input id="license-input" type="password" placeholder="${hasLicense ? 'Token saved securely' : 'Paste license token'}" /><button id="save-license" class="primary">Save</button></label><div class="setting-row"><span><b>Local AI model</b><small>Configured through Ollama on this device.</small></span><span class="setting-value">qwen2.5-coder</span></div><div class="setting-row"><span><b>Transcription</b><small>Faster-Whisper or whisper.cpp executable.</small></span><span class="setting-value">WHISPER_EXECUTABLE</span></div></div>`;
    $('#save-license').addEventListener('click', async () => { const token = ($('#license-input') as HTMLInputElement).value.trim(); if (token) { await window.voiceCode.setLicense(token); $('#save-license').textContent = 'Saved'; } });
  } else {
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="circle-help"></i> SUPPORT</span><h1>Help center</h1><p>Everything you need to get your local workspace running.</p></div></div><div class="help-list"><details open><summary>How do I start a completion?</summary><p>Press Ctrl + Space from any app, allow microphone access, then speak naturally. The selected clipboard context is included automatically.</p></details><details><summary>Why is Ollama marked offline?</summary><p>Start Ollama and make sure qwen2.5-coder is installed with <code>ollama pull qwen2.5-coder</code>. The runtime card will update on the next launch.</p></details><details><summary>Where does my audio go?</summary><p>Audio is sent only to your configured local Whisper executable. Generated code is streamed from your local Ollama instance.</p></details></div>`;
  }
  createIcons({ icons: { Activity, ArrowUpRight, BarChart3, BookOpen, Check, Clipboard, Code2, Copy, Cpu, CircleHelp, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, Sparkles, Terminal, Wifi, X, Zap } });
}

function updateQuota(used: number, limit: number) {
  const percent = Math.min(100, Math.round((used / limit) * 100));
  $('#usage-count').innerHTML = `${used.toLocaleString()} <small>/ ${limit.toLocaleString()}</small>`;
  $('#usage-progress').style.width = `${percent}%`;
  $('#usage-remaining').textContent = `${Math.max(0, limit - used).toLocaleString()} completions left`;
  $('#usage-percent').textContent = `${percent}%`;
}

function setState(next: State, message?: string) {
  state = next;
  document.body.dataset.state = next;
  $('#record-label').textContent = next === 'recording' ? 'Stop recording' : next === 'thinking' ? 'Processing...' : 'Start recording';
  $('#capture-state').textContent = message ?? (next === 'recording' ? 'Listening for your intent...' : 'Microphone ready');
  wave.classList.toggle('active-wave', next === 'recording');
  wave.classList.toggle('idle-wave', next !== 'recording');
}

function updateSetup(progress: { phase: string; percent: number; detail: string }) {
  setupScreen.classList.remove('hidden');
  $('#setup-detail').textContent = progress.detail;
  $('#setup-phase').textContent = progress.phase === 'done' ? 'Ready to use' : progress.phase[0].toUpperCase() + progress.phase.slice(1);
  $('#setup-percent').textContent = `${progress.percent}%`;
  $('#setup-progress-bar').style.width = `${progress.percent}%`;
  if (progress.phase === 'done') window.setTimeout(() => setupScreen.classList.add('hidden'), 700);
}

async function toggleRecording() {
  if (!setupReady) { setState('idle', 'Initializing local AI workspace...'); return; }
  if (state === 'recording') { recorder?.stop(); setState('thinking', 'Cleaning up your speech...'); return; }
  if (state !== 'idle') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); await processAudio(); };
    recorder.start();
    setState('recording');
  } catch { setState('idle', 'Microphone permission is required'); }
}

async function processAudio() {
  try {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const transcribed = await window.voiceCode.transcribe(await blob.arrayBuffer());
    transcript = transcribed.transcript;
    if (!transcript) { setState('idle', transcribed.status === 'missing-whisper' ? 'Install local Whisper to enable transcription' : 'No speech detected'); return; }
    const limit = await window.voiceCode.checkLimit();
    if (!limit.allowed) { setState('paywall'); $('#paywall').classList.remove('hidden'); return; }
    $('#paywall').classList.add('hidden');
    const context = await window.voiceCode.readSelection();
    generated = '';
    output.textContent = '';
    result.classList.remove('hidden');
    setState('streaming', 'Generating locally...');
    await window.voiceCode.generate({ transcript, context: context.text, outsideIde: !context.text });
    const completion = await window.voiceCode.recordCompletion();
    updateQuota(completion.used, completion.limit);
      await window.voiceCode.saveSession({ title: transcript.length > 58 ? `${transcript.slice(0, 58)}...` : transcript, transcript, output: generated, context: context.text });
  } catch (error) {
    setState('idle', error instanceof Error ? error.message : 'Generation failed. Try again.');
  }
}

window.voiceCode.onChunk((chunk) => { generated += chunk; output.textContent = generated; output.scrollTop = output.scrollHeight; });
window.voiceCode.onComplete((completion) => {
  const message = completion.typed ? 'Inserted into your active app' : 'Code ready - native typing is unavailable';
  setState('idle', message);
  $('#result-state').textContent = completion.typed ? 'Inserted into active app' : 'Generated output';
  const toast = document.createElement('div');
  toast.className = 'hud-success';
  toast.innerHTML = `<i data-lucide="${completion.typed ? 'check' : 'code-2'}"></i> ${message}`;
  document.body.append(toast);
  createIcons({ icons: { Check, Code2 } });
  window.setTimeout(() => { toast.classList.add('fade'); if (completion.typed) result.classList.add('hidden'); window.setTimeout(() => { toast.remove(); if (completion.typed) void window.voiceCode.hideOverlay(); }, 300); }, completion.typed ? 1500 : 3000);
});
window.voiceCode.onHotkey(() => void toggleRecording());

$('#record').addEventListener('click', () => void toggleRecording());
$('#close').addEventListener('click', () => window.close());
$('#dismiss').addEventListener('click', () => result.classList.add('hidden'));
$('#copy').addEventListener('click', () => void window.voiceCode.copy(generated));
$('#regenerate').addEventListener('click', () => { if (transcript) { result.classList.remove('hidden'); generated = ''; output.textContent = ''; setState('streaming', 'Regenerating locally...'); void window.voiceCode.generate({ transcript, context: '', outsideIde: false }); } });
$('#upgrade').addEventListener('click', () => void window.voiceCode.openCheckout());
$('#paywall-upgrade').addEventListener('click', () => void window.voiceCode.openCheckout());
$('#sidebar-upgrade').addEventListener('click', () => void window.voiceCode.openCheckout());

document.querySelectorAll<HTMLElement>('[data-view]').forEach((item) => item.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
  if (item.classList.contains('nav-item')) item.classList.add('active');
  const view = item.dataset.view;
    if (view) void showView(view);
}));

void window.voiceCode.health().then((health) => {
  statusText.textContent = health.running ? 'Ollama connected' : 'Ollama needs attention';
  $('#status-dot').classList.toggle('online', health.running);
  $('#runtime-status').textContent = health.running ? 'Connected' : 'Needs attention';
});
void window.voiceCode.checkLimit().then((limit) => updateQuota(limit.used, limit.limit));
window.voiceCode.onSetupProgress(updateSetup);
void window.voiceCode.setupStatus().then((status) => {
  if (status.ready) { setupReady = true; return; }
  void window.voiceCode.bootstrapRuntime().then((finalStatus) => {
    setupReady = finalStatus.ready;
    if (finalStatus.ready) updateSetup({ phase: 'done', percent: 100, detail: 'Local AI workspace ready. You can start speaking.' });
  }).catch((error) => updateSetup({ phase: 'waiting', percent: 90, detail: error instanceof Error ? error.message : 'Setup needs your attention.' }));
});