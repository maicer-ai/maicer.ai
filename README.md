# Voice Code

Local-first voice-to-code and productivity assistant for Windows, built with Electron, TypeScript, Vite, and Tailwind CSS.

## Local prerequisites

- Node.js 20+
- Ollama running locally with `qwen2.5-coder` available
- A pinned Windows Whisper-compatible executable hosted at the configured `WHISPER_DOWNLOAD_URL` (it must accept WebM/Opus bytes on stdin and print the transcript to stdout)
- Windows accessibility permission for native paste simulation
- Native build tools when developing locally (`robotjs` is rebuilt for Electron)

```powershell
ollama pull qwen2.5-coder
$env:WHISPER_EXECUTABLE = "C:\\tools\\whisper-cli.exe"
```

## Development

```bash
npm install
npm run dev
```

Run the automated quota regression test with `npm test`. It builds the TypeScript output first, then verifies the 2,000-completion monthly boundary. Full voice and UI interaction checks require Windows, a microphone, Ollama, and the packaged runtime assets.

The Windows release workflow runs `npm run test:e2e:windows` before packaging. This deterministic journey test creates and authenticates a test account against local mock services, streams mocked audio to a Whisper mock, sends the transcript to an Ollama mock, checks the 2,000-completion quota, and verifies insertion into a simulated editor. It does not replace a manual Windows test with real microphone, Ollama, Whisper, or editor accessibility; those remain required before launch because the current app has no account-auth or cloud session/snippet API.

Press `Ctrl + Alt + S` to show the always-on-top overlay and speak. Voice Code shows live partial transcription and finalizes after a short pause; press the shortcut again to stop immediately. Generated text is pasted into the previously active app automatically. The tray icon remains available after the window is hidden.

The Windows packaging command runs `electron-rebuild` so the native typing module matches the bundled Electron version. On Linux development machines, install the X11 Test extension headers (`libxtst-dev`) before running `npm install`; Wayland may still restrict native input simulation.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_URL` | Local Ollama endpoint | `http://127.0.0.1:11434` |
| `WHISPER_EXECUTABLE` | Absolute local transcription executable | unset |
| `WHISPER_DOWNLOAD_URL` | HTTPS URL for the pinned Windows whisper.cpp binary | unset |
| `WHISPER_SHA256` | SHA-256 for the Whisper binary | unset |
| `QWEN_MODEL_DOWNLOAD_URL` | HTTPS URL for the pinned Qwen 0.5B GGUF weights | unset |
| `QWEN_MODEL_SHA256` | SHA-256 for the Qwen weights | unset |
| `VOICE_CODE_API_URL` | Cloud quota endpoint | `https://api.voicecode.local` |
| `STRIPE_CHECKOUT_URL` | Pro checkout URL opened externally | Stripe placeholder |

Without configuration, packaged builds use pinned public defaults: the whisper.cpp `v1.7.4` Windows x64 release bundle and the Qwen2.5-Coder 0.5B Instruct Q4_K_M GGUF on Hugging Face. The app validates HTTPS URLs, downloads missing assets into `%LOCALAPPDATA%/Voice Code/runtime`, verifies hashes when supplied, extracts the Whisper executable from its ZIP, and resumes the setup screen on the next launch if a dependency is not ready. For release pinning, set `VOICE_CODE_ASSET_MANIFEST_URL` to a JSON manifest with `whisperUrl`, `whisperSha256`, `qwenUrl`, `qwenSha256`, and optional Ollama installer fields.

On first launch, the app provisions the Whisper binary and Qwen 0.5B GGUF weights into `%LOCALAPPDATA%/Voice Code/runtime`, verifies SHA-256 when supplied, and registers the weights with Ollama as `qwen2.5-coder:0.5b`. Configure the asset URLs in `.env` from your private HTTPS object storage; the example URLs are placeholders and must be replaced before release. Free accounts are limited to 2,000 successful completions per calendar month. The app checks `/api/check-limit` before each generation and keeps an encrypted-device-local completion ledger as a fallback guard when the cloud service is unavailable. Pro accounts bypass the free limit when the API reports the `pro` tier.

## Windows installer

```bash
npm run package:win
```

The NSIS installer is written to `dist/` as `Voice-Code-Setup-<version>.exe`.

You can also create it automatically with GitHub Actions by pushing a tag such as `v0.1.0` or by running the `Windows installer` workflow manually. The workflow uses a Windows runner and uploads the generated `.exe` as a downloadable workflow artifact.

## Security boundaries

The renderer runs without Node integration under a strict CSP and accesses privileged operations only through the typed `contextBridge`. License tokens are encrypted with Electron `safeStorage`; no shell commands are executed by the app. The selected editor context is read from the clipboard because Windows does not expose a universal selected-text API without an editor extension or accessibility integration.
