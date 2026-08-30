import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';

const log = [];
const state = { users: new Map(), tokens: new Set(), completions: 0 };

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function startMockServices() {
  const server = createServer(async (request, response) => {
    const rawBody = await readBody(request);
    const body = request.headers['content-type']?.includes('application/json') ? JSON.parse(rawBody.toString('utf8') || '{}') : {};
    if (request.url === '/auth/signup' && request.method === 'POST') {
      if (!body.email || !body.password) return json(response, 400, { error: 'credentials required' });
      state.users.set(body.email, body.password);
      log.push('account created');
      return json(response, 201, { user: { email: body.email } });
    }
    if (request.url === '/auth/login' && request.method === 'POST') {
      if (state.users.get(body.email) !== body.password) return json(response, 401, { error: 'invalid credentials' });
      const token = `test-token-${body.email}`;
      state.tokens.add(token);
      log.push('authenticated');
      return json(response, 200, { access_token: token });
    }
    if (request.url === '/ollama/api/generate' && request.method === 'POST') {
      if (!state.tokens.has(request.headers.authorization?.replace('Bearer ', ''))) return json(response, 401, { error: 'unauthorized' });
      log.push('ollama generated code');
      return json(response, 200, { response: 'const greeting = "Hello from Voice Code";' });
    }
    if (request.url === '/api/check-limit' && request.method === 'GET') return json(response, 200, { allowed: state.completions < 2000, used: state.completions, limit: 2000, tier: 'free' });
    if (request.url === '/api/record-completion' && request.method === 'POST') { state.completions += 1; log.push('quota recorded'); return json(response, 200, { used: state.completions, limit: 2000 }); }
    if (request.url === '/whisper/transcribe' && request.method === 'POST') { log.push('whisper transcribed audio'); return json(response, 200, { transcript: 'write a greeting constant' }); }
    json(response, 404, { error: 'not found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${options.method ?? 'GET'} ${url} returned ${response.status}`);
  return response.json();
}

test('complete user journey: auth, speech, local AI, quota, and editor insertion', async (t) => {
  const services = await startMockServices();
  t.after(() => services.server.close());
  const email = 'e2e@example.test';
  const password = 'test-password';
  const editor = { text: '' };

  await request(`${services.url}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = await request(`${services.url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

  const audioStream = Readable.from([Buffer.from('mock-webm-opus-audio')]);
  const audio = Buffer.concat(await (async () => { const chunks = []; for await (const chunk of audioStream) chunks.push(chunk); return chunks; })());
  const transcript = await request(`${services.url}/whisper/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: audio });
  assert.equal(transcript.transcript, 'write a greeting constant');

  const quota = await request(`${services.url}/api/check-limit`);
  assert.equal(quota.limit, 2000);
  assert.equal(quota.allowed, true);
  const generated = await request(`${services.url}/ollama/api/generate`, { method: 'POST', headers, body: JSON.stringify({ model: 'qwen2.5-coder:0.5b', prompt: transcript.transcript }) });
  editor.text = generated.response;
  assert.equal(editor.text, 'const greeting = "Hello from Voice Code";');
  await request(`${services.url}/api/record-completion`, { method: 'POST', headers, body: JSON.stringify({ output: editor.text }) });
  assert.equal(state.completions, 1);
  assert.deepEqual(log, ['account created', 'authenticated', 'whisper transcribed audio', 'ollama generated code', 'quota recorded']);

  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/e2e-journey.log', `${log.join('\n')}\neditor insertion: ${editor.text}\n`, 'utf8');
});