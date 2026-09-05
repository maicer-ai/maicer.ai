import { Activity, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, Clipboard, Code2, Copy, Cpu, createIcons, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, ShieldCheck, Sparkles, Terminal, Wifi, X, Zap } from 'lucide';
import './styles.css';
import { APP_SHORTCUT_LABEL } from '../shared/config';

type State = 'idle' | 'recording' | 'thinking' | 'streaming' | 'paywall';
let state: State = 'idle';
let transcript = '';
let generated = '';
let recorder: MediaRecorder | undefined;
let chunks: Blob[] = [];
let setupReady = false;
type SpeechRecognitionLike = new () => { continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start(): void; stop(): void };
let speechRecognition: ReturnType<SpeechRecognitionLike> | undefined;
let pendingContext = '';
let audioContext: AudioContext | undefined;
let mediaStream: MediaStream | undefined;
let vadAnimation = 0;
let speechStarted = false;
let lastVoiceAt = 0;
let generationId = 0;
let activeGenerationId = 0;
let segmentTimer: number | undefined;
let liveTranscripts: string[] = [];
let workStartedAt = 0;
let setupRetryCount = 0;
let setupTimer: number | undefined;
const MAX_SETUP_RETRIES = 5;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="setup-screen" class="setup-screen hidden"><div class="setup-card"><div class="setup-logo"><i data-lucide="sparkles"></i></div><span class="eyebrow">FIRST-RUN SETUP</span><h1>Preparing your<br><em>voice workspace.</em></h1><p id="setup-detail">Getting things ready for your first command...</p><div class="setup-progress"><span id="setup-progress-bar"></span></div><div class="setup-progress-meta"><span id="setup-phase">Getting ready</span><span id="setup-percent">0%</span></div><div class="setup-points"><span><i data-lucide="lock-keyhole"></i> Private by default</span><span><i data-lucide="zap"></i> Ready when complete</span></div></div></div>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><i data-lucide="zap"></i></span><div><strong>MAICER</strong><small>LOCAL AI ASSISTANT</small></div></div>
      <div class="workspace-switcher"><span class="workspace-avatar">VC</span><span><b>Personal workspace</b><small>Free plan</small></span><i data-lucide="arrow-up-right"></i></div>
      <nav class="nav"><span class="nav-label">Workspace</span><button class="nav-item active" data-view="dashboard"><i data-lucide="layout-dashboard"></i> Home</button><button class="nav-item" data-view="history"><i data-lucide="history"></i> History <span class="nav-count">12</span></button><span class="nav-label">Library</span><button class="nav-item" data-view="commands"><i data-lucide="terminal"></i> Commands</button><button class="nav-item" data-view="dictionary"><i data-lucide="book-open"></i> Dictionary</button><span class="nav-label">Connect</span><button class="nav-item" data-view="integrations"><i data-lucide="plug"></i> Integrations</button><button class="nav-item" data-view="settings"><i data-lucide="settings"></i> Settings</button></nav>
      <div class="sidebar-bottom"><div class="upgrade-mini"><div class="upgrade-top"><i data-lucide="sparkles"></i><span>maicer Pro</span></div><p>Unlimited completions and priority models.</p><button id="sidebar-upgrade">Upgrade <i data-lucide="arrow-up-right"></i></button></div><div class="user-row"><span class="user-avatar">SR</span><span><b>Sarah R.</b><small>sarah@maicer.dev</small></span><button class="icon-button"><i data-lucide="settings"></i></button></div></div>
    </aside>
    <section class="content-shell">
      <header class="topbar"><div><span class="breadcrumb">Personal workspace / <b>Home</b></span><h2>Good morning, Sarah <span class="wave-hand">✦</span></h2></div><div class="top-actions"><span class="privacy"><i data-lucide="lock-keyhole"></i> Local-first</span><button class="icon-button" aria-label="Help" data-view="help"><i data-lucide="circle-help"></i></button><button id="close" class="icon-button" aria-label="Hide to tray"><i data-lucide="x"></i></button></div></header>
      <div class="dashboard-grid">
        <div class="stats-bar"><div><b id="metric-functions">0</b><span>Functions written</span></div><div><b id="metric-lines">0</b><span>Code lines written</span></div><div><b id="metric-hours">0.0h</b><span>Hours dedicated today</span></div></div>
        <section class="main-column"><div class="hero-line"><div><div class="eyebrow"><i data-lucide="activity"></i> VOICE TO CODE</div><h1>Say what you mean.<br><em>Ship what you say.</em></h1><p>Press, speak, and get clean code inserted into your active app.</p></div><div class="hotkey-hint"><span class="live-dot"></span><kbd>${APP_SHORTCUT_LABEL}</kbd><small>activate anywhere</small></div></div>
            <section class="capture-panel"><div class="capture-heading"><div><span class="eyebrow">READY TO LISTEN</span><h3>Your next command</h3></div><span id="context-badge" class="context-badge hidden"><i data-lucide="clipboard"></i> Using active editor selection</span></div><div id="wave" class="wave idle-wave" aria-hidden="true">${Array.from({ length: 36 }, (_, index) => `<span style="--i:${index}"></span>`).join('')}</div><div id="transcript-preview" class="transcript-preview" aria-live="polite"><span class="preview-placeholder">Your words will appear here while you speak.</span></div><button id="record" class="record-button"><span class="record-icon"><i data-lucide="mic"></i></span><span id="record-label">Press to speak</span><kbd>${APP_SHORTCUT_LABEL}</kbd></button><div class="capture-meta"><span id="capture-state">Microphone ready</span><span class="privacy"><i data-lucide="check"></i> Private by default</span></div></section>
          <section id="result" class="result-panel hidden"><div class="result-header"><div><span class="eyebrow"><i data-lucide="code-2"></i> GENERATED OUTPUT</span><span id="result-state" class="result-state">Streaming to active app</span></div><button id="dismiss" class="icon-button" aria-label="Dismiss"><i data-lucide="x"></i></button></div><pre id="output"></pre><div class="actions"><button id="copy" class="secondary"><i data-lucide="copy"></i> Copy</button><button id="regenerate" class="secondary"><i data-lucide="refresh-cw"></i> Regenerate</button></div></section>
          <div class="section-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Latest sessions</h3></div><button class="text-button" data-view="history">View all <i data-lucide="arrow-up-right"></i></button></div><div class="session-list"><div class="session-item"><span class="session-icon purple"><i data-lucide="code-2"></i></span><div><b>Refactor auth middleware</b><small>TypeScript · 4 minutes ago</small></div><span class="session-lines">42 lines</span></div><div class="session-item"><span class="session-icon green"><i data-lucide="code-2"></i></span><div><b>Add optimistic updates to feed</b><small>React · Yesterday</small></div><span class="session-lines">28 lines</span></div><div class="session-item"><span class="session-icon amber"><i data-lucide="code-2"></i></span><div><b>Explain this error and fix it</b><small>Python · Yesterday</small></div><span class="session-lines">12 lines</span></div></div>
        </section>
        <aside class="right-rail"><section class="rail-card runtime-card"><div class="rail-heading"><span><i data-lucide="wifi"></i> LOCAL RUNTIME</span><span id="runtime-status" class="status-label">Checking</span></div><div class="runtime-row"><span class="runtime-icon"><i data-lucide="cpu"></i></span><div><b>Ollama</b><small id="status-text">Initializing...</small></div><span id="status-dot" class="dot"></span></div><div class="runtime-row"><span class="runtime-icon"><i data-lucide="mic"></i></span><div><b>Whisper</b><small>Local transcription</small></div><span class="dot online"></span></div></section><section class="rail-card usage-card"><div class="rail-heading"><span><i data-lucide="bar-chart-3"></i> THIS MONTH</span><button class="icon-button" data-view="analytics"><i data-lucide="arrow-up-right"></i></button></div><div id="usage-count" class="usage-number">0 <small>/ 2,000</small></div><div class="progress"><span id="usage-progress"></span></div><div class="usage-foot"><span id="usage-remaining">2,000 completions left</span><b id="usage-percent">0%</b></div><button id="upgrade" class="rail-upgrade">Unlock unlimited <i data-lucide="sparkles"></i></button></section><section class="rail-card privacy-card"><span class="privacy-icon"><i data-lucide="lock-keyhole"></i></span><div><b>Your code stays yours.</b><p>Audio and context are processed locally. Nothing leaves your machine.</p></div></section></aside>
      </div>
      <section id="view-panel" class="view-panel hidden"></section>
      <section id="paywall" class="paywall hidden"><div class="paywall-icon"><i data-lucide="sparkles"></i></div><div><span class="eyebrow">MONTHLY LIMIT REACHED</span><h2>You have used your 2,000 free completions.</h2><p>Add a Pro or Corporate license, or continue next month.</p></div><button id="paywall-upgrade" class="primary">Upgrade <strong>$25/mo</strong></button></section>
      <section id="upgrade-modal" class="upgrade-modal hidden" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"><div class="upgrade-dialog"><button id="upgrade-close" class="icon-button" aria-label="Close"><i data-lucide="x"></i></button><span class="eyebrow">MAICER PREMIUM</span><h2 id="upgrade-title">Keep your flow going.</h2><p id="upgrade-copy">Join the Premium waitlist and we will let you know when early access opens.</p><form id="waitlist-form"><label class="sr-only" for="waitlist-email">Email address</label><input id="waitlist-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required /><div class="upgrade-dialog-actions"><button id="upgrade-save" class="primary" type="submit">Join waitlist</button><button id="upgrade-checkout" class="secondary" type="button">View plans</button></div></form><small id="upgrade-error" role="status" aria-live="polite"></small></div></section>
      <footer><span><i data-lucide="lock-keyhole"></i> End-to-end local processing</span><span class="build">maicer v0.1.0</span></footer>
    </section>
  </main>`;

createIcons({ icons: { Activity, ArrowUpRight, BarChart3, BookOpen, Check, Clipboard, Code2, Copy, Cpu, CircleHelp, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, ShieldCheck, Sparkles, Terminal, Wifi, X, Zap } });
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const wave = $('#wave');
const result = $('#result');
const output = $('#output');
const statusText = $('#status-text');
const dashboard = $('.dashboard-grid');
const viewPanel = $('#view-panel');
const setupScreen = $('#setup-screen');
const transcriptPreview = $('#transcript-preview');
const contextBadge = $('#context-badge');
const setupRetry = document.createElement('button');
setupRetry.className = 'secondary setup-retry hidden';
setupRetry.textContent = 'Retry setup';
setupRetry.type = 'button';
setupRetry.addEventListener('click', () => { setupRetryCount = 0; void prepareWorkspace(); });
setupScreen.querySelector('.setup-card')?.append(setupRetry);

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
    const sessions = await window.maicer.listSessions();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="history"></i> WORKSPACE</span><h1>Session history</h1><p>Your locally stored voice-to-code sessions.</p></div><span class="view-meta">${sessions.length} saved</span></div><div class="full-session-list">${sessions.length ? sessions.map((session) => `<article class="full-session"><div><b>${escapeHtml(session.title)}</b><small>${relativeTime(session.createdAt)} · ${session.output.split('\n').length} lines</small></div><button class="secondary session-open" data-session-id="${session.id}"><i data-lucide="code-2"></i> View output</button></article>`).join('') : '<div class="empty-state"><i data-lucide="history"></i><h3>No sessions yet</h3><p>Your completed generations will appear here.</p></div>'}</div>`;
  } else if (view === 'analytics') {
    const limit = await window.maicer.checkLimit();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="bar-chart-3"></i> WORKSPACE</span><h1>Usage</h1><p>Keep an eye on your monthly completion budget.</p></div></div><div class="analytics-grid"><div class="analytics-stat"><small>COMPLETIONS USED</small><strong>${limit.used.toLocaleString()}</strong><span>of ${limit.limit.toLocaleString()} available</span></div><div class="analytics-stat"><small>REMAINING</small><strong>${Math.max(0, limit.limit - limit.used).toLocaleString()}</strong><span>resets at the start of next month</span></div><div class="analytics-stat"><small>PLAN</small><strong>${limit.tier === 'pro' ? 'Pro' : 'Free'}</strong><span>${limit.tier === 'pro' ? 'Unlimited usage' : 'Upgrade for unlimited'}</span></div></div><div class="usage-large"><div class="progress"><span style="width:${Math.min(100, Math.round((limit.used / limit.limit) * 100))}%"></span></div><p>${Math.round((limit.used / limit.limit) * 100)}% of the free allowance used</p></div>`;
  } else if (view === 'settings') {
    const hasLicense = await window.maicer.hasLicense();
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="settings"></i> CONFIGURE</span><h1>Settings</h1><p>Connect your local tools and maicer account.</p></div></div><div class="settings-list"><label class="setting-row"><span><b>License token</b><small>Encrypted securely on this device.</small></span><input id="license-input" type="password" placeholder="${hasLicense ? 'Token saved securely' : 'Paste license token'}" /><button id="save-license" class="primary">Save</button></label><details class="diagnostics"><summary>Advanced diagnostics</summary><div class="diagnostic-grid"><span>Workspace services</span><b id="diagnostic-services">Checking...</b><span>Voice capture</span><b id="diagnostic-voice">Available</b></div></details></div>`;
    $('#save-license').addEventListener('click', async () => { const token = ($('#license-input') as HTMLInputElement).value.trim(); if (token) { await window.maicer.setLicense(token); $('#save-license').textContent = 'Saved'; } });
    void window.maicer.health().then((health) => { $('#diagnostic-services').textContent = health.running ? 'Ready' : 'Needs attention'; });
  } else {
    viewPanel.innerHTML = `<div class="view-heading"><div><span class="eyebrow"><i data-lucide="circle-help"></i> SUPPORT</span><h1>Help center</h1><p>Everything you need to get your local workspace running.</p></div></div><div class="help-list"><details open><summary>How do I start a completion?</summary><p>Press ${APP_SHORTCUT_LABEL} from any app, allow microphone access, then speak naturally. The selected editor context is included automatically.</p></details><details><summary>What if setup is still in progress?</summary><p>maicer keeps preparing in the background. You can leave this window open and try again when the workspace is ready.</p></details><details><summary>Where does my audio go?</summary><p>Your audio and generated code stay on this device.</p></details></div>`;
  }
  createIcons({ icons: { Activity, ArrowUpRight, BarChart3, BookOpen, Check, Clipboard, Code2, Copy, Cpu, CircleHelp, History, LayoutDashboard, LockKeyhole, Mic, Plug, RefreshCw, Settings, ShieldCheck, Sparkles, Terminal, Wifi, X, Zap } });
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

function showTranscript(text: string) {
  transcriptPreview.textContent = text || 'Listening...';
  transcriptPreview.classList.toggle('has-transcript', Boolean(text));
}

function startLivePreview() {
  const speechWindow = window as unknown as { SpeechRecognition?: SpeechRecognitionLike; webkitSpeechRecognition?: SpeechRecognitionLike };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) { showTranscript('Listening...'); return; }
  speechRecognition = new Recognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'en-US';
  speechRecognition.onresult = (event) => {
    const words = Array.from(event.results).map((result) => result[0].transcript).join(' ');
    showTranscript(words);
  };
  speechRecognition.onerror = () => showTranscript('Listening...');
  speechRecognition.onend = () => { speechRecognition = undefined; };
  try { speechRecognition.start(); } catch { showTranscript('Listening...'); }
}

function stopLivePreview() {
  speechRecognition?.stop();
  speechRecognition = undefined;
}

function stopVoiceCapture() {
  if (state !== 'recording') return;
  stopLivePreview();
  cancelAnimationFrame(vadAnimation);
  if (segmentTimer) window.clearTimeout(segmentTimer);
  recorder?.stop();
  setState('thinking', 'Turning your words into a command...');
}

function transcribeBlob(blob: Blob) {
  return window.maicer.transcribe(blob.arrayBuffer());
}

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was denied. Allow maicer in Windows microphone privacy settings, then retry.';
  if (name === 'NotFoundError' || name === 'NotReadableError') return 'No usable microphone was found. Remote Desktop and headless sessions may not expose audio devices.';
  if (name === 'OverconstrainedError') return 'The available microphone does not support the requested settings.';
  return 'Microphone capture is unavailable. Connect a microphone or leave Remote Desktop, then retry.';
}

function startVoiceActivityDetection(stream: MediaStream) {
  audioContext ??= new AudioContext();
  void audioContext.resume();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  const samples = new Uint8Array(analyser.fftSize);
  const bars = Array.from(wave.querySelectorAll<HTMLElement>('span'));
  audioContext.createMediaStreamSource(stream).connect(analyser);
  speechStarted = false;
  lastVoiceAt = Date.now();
  const check = () => {
    if (state !== 'recording') return;
    analyser.getByteTimeDomainData(samples);
    const volume = Math.sqrt(samples.reduce((total, sample) => total + ((sample - 128) / 128) ** 2, 0) / samples.length);
    bars.forEach((bar, index) => { const sample = samples[Math.floor(index * samples.length / bars.length)] ?? 128; bar.style.height = `${Math.max(8, Math.min(40, 8 + Math.abs(sample - 128) * 0.55))}px`; });
    if (volume > 0.035) { speechStarted = true; lastVoiceAt = Date.now(); }
    if (speechStarted && Date.now() - lastVoiceAt > 1300) { stopVoiceCapture(); return; }
    vadAnimation = requestAnimationFrame(check);
  };
  vadAnimation = requestAnimationFrame(check);
}

function playTone(frequency: number, duration: number) {
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.035, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch { /* audio feedback is optional */ }
}

function updateSetup(progress: { phase: string; percent: number; detail: string }) {
  setupScreen.classList.remove('hidden');
  const failed = progress.phase === 'error';
  $('#setup-detail').textContent = progress.detail || (progress.phase === 'done' ? 'Your workspace is ready.' : 'Getting everything ready for your first command...');
  $('#setup-phase').textContent = progress.phase === 'done' ? 'Ready to use' : failed ? 'Setup paused' : 'Preparing';
  $('#setup-percent').textContent = `${progress.percent}%`;
  $('#setup-progress-bar').style.width = `${progress.percent}%`;
  setupRetry.classList.toggle('hidden', !failed);
  if (progress.phase === 'done') window.setTimeout(() => setupScreen.classList.add('hidden'), 700);
}

function renderMetrics(metrics: { functions: number; lines: number; seconds: number }) {
  $('#metric-functions').textContent = metrics.functions.toLocaleString();
  $('#metric-lines').textContent = metrics.lines.toLocaleString();
  $('#metric-hours').textContent = `${(metrics.seconds / 3600).toFixed(1)}h`;
}

async function toggleRecording() {
  if (!setupReady) { setState('idle', 'Your workspace is still getting ready.'); return; }
  if (state === 'recording') { stopVoiceCapture(); return; }
  if (state !== 'idle') return;
  if (!navigator.mediaDevices?.getUserMedia) { setState('idle', 'This environment does not provide microphone access. Try a local Windows session.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    mediaStream = stream;
    liveTranscripts = [];
    const startSegment = () => {
      if (state !== 'recording') return;
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => {
        const segment = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];
        if (state === 'recording') {
          try {
            const partial = await transcribeBlob(segment);
            if (partial.transcript) { liveTranscripts.push(partial.transcript); showTranscript(liveTranscripts.join(' ')); }
          } catch { showTranscript(liveTranscripts.join(' ') || 'Listening...'); }
          if (state === 'recording') startSegment();
        } else {
          stream.getTracks().forEach((track) => track.stop());
          mediaStream = undefined;
          await processAudio(segment);
        }
      };
      recorder.start();
      segmentTimer = window.setTimeout(() => recorder?.stop(), 1600);
    };
    setState('recording');
    startSegment();
    showTranscript('Listening...');
    startLivePreview();
    setState('recording');
    startVoiceActivityDetection(stream);
    playTone(520, 0.08);
  } catch (error) {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = undefined;
    recorder = undefined;
    stopLivePreview();
    cancelAnimationFrame(vadAnimation);
    setState('idle', microphoneError(error));
  }
}

async function processAudio(finalSegment?: Blob) {
  try {
    const transcribed = finalSegment ? await transcribeBlob(finalSegment) : { transcript: '', status: 'ready' };
    transcript = [...liveTranscripts, transcribed.transcript].filter(Boolean).join(' ');
    showTranscript(transcript);
    if (!transcript) { setState('idle', 'I didn\'t catch that. Try speaking a little closer to your microphone.'); return; }
    const limit = await window.maicer.checkLimit();
    if (!limit.allowed) { setState('paywall'); $('#paywall').classList.remove('hidden'); $('#upgrade-modal').classList.remove('hidden'); return; }
    $('#paywall').classList.add('hidden');
    const context = await window.maicer.readSelection();
    pendingContext = context.text;
    contextBadge.classList.toggle('hidden', !pendingContext);
    generated = '';
    output.textContent = '';
    result.classList.remove('hidden');
    setState('streaming', 'Creating your code...');
    workStartedAt = Date.now();
    activeGenerationId = ++generationId;
    await window.maicer.generate({ transcript, context: context.text, outsideIde: !context.text, requestId: activeGenerationId });
      await window.maicer.saveSession({ title: transcript.length > 58 ? `${transcript.slice(0, 58)}...` : transcript, transcript, output: generated, context: context.text });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    if (detail.includes('Monthly completion limit')) { $('#upgrade-modal').classList.remove('hidden'); setState('paywall'); return; }
    setState('idle', detail.includes('ready') ? 'Your workspace is still warming up. Please try again in a moment.' : 'That didn\'t go through. Check your microphone and try again.');
  }
}

window.maicer.onChunk((event) => {
  if (event.requestId !== activeGenerationId) return;
  generated += event.chunk;
  output.textContent = generated;
  output.scrollTop = output.scrollHeight;
});
window.maicer.onComplete(async (event) => {
  if (event.requestId !== activeGenerationId) return;
  const insertion = await window.maicer.typeOutput(generated);
  const inserted = insertion.inserted;
  if (!inserted) await window.maicer.copy(generated);
  const completion = await window.maicer.recordCompletion(generated, Math.max(0, (Date.now() - workStartedAt) / 1000));
  updateQuota(completion.used, completion.limit);
  renderMetrics(completion.metrics);
  const message = inserted ? 'Inserted into your active app' : 'Your code is ready to copy';
  playTone(760, 0.12);
  setState('idle', message);
  $('#result-state').textContent = inserted ? 'Inserted into active app' : 'Generated output';
  const toast = document.createElement('div');
  toast.className = 'hud-success';
  toast.innerHTML = `<i data-lucide="code-2"></i> ${message}`;
  document.body.append(toast);
  createIcons({ icons: { Check, Code2 } });
  window.setTimeout(() => { toast.classList.add('fade'); window.setTimeout(() => { toast.remove(); if (inserted) { result.classList.add('hidden'); void window.voiceCode.hideOverlay(); } }, 300); }, inserted ? 1500 : 3000);
});
window.maicer.onHotkey(() => void toggleRecording());

$('#record').addEventListener('click', () => void toggleRecording());
$('#close').addEventListener('click', () => void window.maicer.hideOverlay());
$('#dismiss').addEventListener('click', () => { const previous = activeGenerationId; activeGenerationId = ++generationId; void window.maicer.cancelGeneration(previous); result.classList.add('hidden'); });
$('#copy').addEventListener('click', () => void window.maicer.copy(generated));
$('#regenerate').addEventListener('click', () => { if (transcript) { result.classList.remove('hidden'); generated = ''; output.textContent = ''; activeGenerationId = ++generationId; setState('streaming', 'Regenerating locally...'); void window.maicer.generate({ transcript, context: pendingContext, outsideIde: !pendingContext, requestId: activeGenerationId }); } });
window.addEventListener('beforeunload', () => {
  stopLivePreview();
  cancelAnimationFrame(vadAnimation);
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
});
function openUpgradeModal() {
  $('#upgrade-modal').classList.remove('hidden');
  $('#upgrade-title').textContent = 'Keep your flow going.';
  $('#upgrade-copy').textContent = 'Join the Premium waitlist and we will let you know when early access opens.';
  $('#waitlist-form').classList.remove('hidden');
  ($('#waitlist-email') as HTMLInputElement).value = '';
  $('#upgrade-error').textContent = '';
  window.setTimeout(() => $('#waitlist-email').focus(), 0);
}

$('#upgrade').addEventListener('click', openUpgradeModal);
$('#paywall-upgrade').addEventListener('click', openUpgradeModal);
const closeUpgradeModal = () => $('#upgrade-modal').classList.add('hidden');
$('#upgrade-close').addEventListener('click', (event) => { event.stopPropagation(); closeUpgradeModal(); });
$('#upgrade-modal').addEventListener('click', (event) => { if (event.target === $('#upgrade-modal')) closeUpgradeModal(); });
$('.upgrade-dialog').addEventListener('click', (event) => event.stopPropagation());
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#upgrade-modal').classList.contains('hidden')) closeUpgradeModal(); });
$('#upgrade-checkout').addEventListener('click', () => void window.maicer.openCheckout());
$('#waitlist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const emailInput = $('#waitlist-email') as HTMLInputElement;
  const submit = $('#upgrade-save') as HTMLButtonElement;
  const error = $('#upgrade-error');
  const email = emailInput.value.trim().toLowerCase();
  if (!emailInput.validity.valid) { error.textContent = 'Enter a valid email address.'; return; }
  submit.disabled = true;
  submit.textContent = 'Joining...';
  error.textContent = '';
  try {
    await window.maicer.joinWaitlist(email);
    $('#upgrade-title').textContent = 'You are on the list.';
    $('#upgrade-copy').textContent = 'Thanks. We will email you when maicer Premium is ready.';
    $('#waitlist-form').classList.add('hidden');
    error.textContent = '';
  } catch (reason) { error.textContent = reason instanceof Error ? reason.message : 'Could not join the waitlist. Please try again.'; }
  finally { submit.disabled = false; if (!$('#waitlist-form').classList.contains('hidden')) submit.textContent = 'Join waitlist'; }
});
$('#sidebar-upgrade').addEventListener('click', openUpgradeModal);

document.querySelectorAll<HTMLElement>('[data-view]').forEach((item) => item.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
  if (item.classList.contains('nav-item')) item.classList.add('active');
  const view = item.dataset.view;
    if (view) void showView(view);
}));

void window.maicer.health().then((health) => {
  statusText.textContent = health.running ? 'Ollama connected' : 'Ollama needs attention';
  $('#status-dot').classList.toggle('online', health.running);
  $('#runtime-status').textContent = health.running ? 'Connected' : 'Needs attention';
});
void window.maicer.checkLimit().then((limit) => updateQuota(limit.used, limit.limit));
void window.maicer.todayMetrics().then(renderMetrics);
window.maicer.onSetupProgress(updateSetup);
async function prepareWorkspace() {
  if (setupTimer) window.clearTimeout(setupTimer);
  if (setupRetryCount >= MAX_SETUP_RETRIES) {
    updateSetup({ phase: 'error', percent: 0, detail: 'Setup could not finish. Check Ollama and retry.' });
    return;
  }
  setupRetryCount++;
  try {
    const status = await window.maicer.setupStatus();
    if (status.ready) { setupReady = true; updateSetup({ phase: 'done', percent: 100, detail: 'Your workspace is ready.' }); return; }
    const finalStatus = await window.maicer.bootstrapRuntime();
    setupReady = finalStatus.ready;
    if (finalStatus.ready) updateSetup({ phase: 'done', percent: 100, detail: 'Your workspace is ready.' });
    else if (setupRetryCount < MAX_SETUP_RETRIES) setupTimer = window.setTimeout(() => void prepareWorkspace(), 5000);
    else updateSetup({ phase: 'error', percent: 0, detail: 'Setup could not finish. Check Ollama and retry.' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Setup could not finish.';
    if (setupRetryCount < MAX_SETUP_RETRIES) {
      updateSetup({ phase: 'waiting', percent: 90, detail: `${detail} Retrying...` });
      setupTimer = window.setTimeout(() => void prepareWorkspace(), 5000);
    } else updateSetup({ phase: 'error', percent: 0, detail });
  }
}
void prepareWorkspace();