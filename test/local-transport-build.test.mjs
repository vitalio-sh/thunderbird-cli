// Synthetic transport/build tests. No real Thunderbird, mail or token is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const httpPort = await freePort(), wsPort = await freePort();
const token = 'synthetic-local-regression-token';
const proc = spawn(process.execPath, ['bridge/bridge.js', '--port', String(httpPort), '--ws-port', String(wsPort)], {
  cwd: root, env: { ...process.env, TB_AUTH_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(proc, 'exit');
let logs = '', socket, fixture;
proc.stdout.on('data', b => { logs += b; });
proc.stderr.on('data', b => { logs += b; });
const url = `http://127.0.0.1:${httpPort}`;
const headers = { Authorization: `Bearer ${token}` };
try {
  for (let i = 0; i < 250 && !logs.includes('Waiting for Thunderbird'); i++) await delay(20);
  assert(logs.includes('Waiting for Thunderbird'), logs);
  assert.equal((await fetch(url + '/bridge/status')).status, 401);
  assert.equal((await fetch(url + '/bridge/status', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  await new Promise((resolve, reject) => {
    const denied = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    denied.on('open', () => { denied.terminate(); reject(new Error('Unauthenticated WebSocket accepted')); });
    denied.on('unexpected-response', (_, res) => { res.resume(); denied.terminate(); assert.equal(res.statusCode, 401); resolve(); });
    denied.on('error', () => {});
  });
  socket = new WebSocket(`ws://127.0.0.1:${wsPort}/?token=${token}`);
  await once(socket, 'open');
  let forwarded = 0;
  socket.on('message', raw => {
    const m = JSON.parse(raw); forwarded++;
    socket.send(JSON.stringify({ id: m.id, result: m.body }));
  });
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: wsPort, path: '//[', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13',
    } }, res => {
      res.resume();
      try { assert.equal(res.statusCode, 401); resolve(); } catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Malformed upgrade was not rejected')));
    req.on('upgrade', (_, upgraded) => {
      upgraded.destroy(); reject(new Error('Malformed upgrade was accepted'));
    });
    req.end();
  });
  assert.equal(proc.exitCode, null, 'Malformed URLs must not kill the bridge');
  assert.equal(socket.readyState, WebSocket.OPEN, 'Existing extension must remain connected');
  console.log('PASS: malformed unauthenticated WebSocket URL rejected without disrupting the bridge');
  const original = { body: 'Gr\u00fc\u00dfe, \u0395\u03bb\u03bb\u03ac\u03b4\u03b1' };
  const encoded = Buffer.from(JSON.stringify(original));
  const split = encoded.indexOf(Buffer.from('\u00fc')) + 1;
  const received = await new Promise((resolve, reject) => {
    const req = request(url + '/reply', { method: 'POST', headers }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', b => { data += b; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(encoded.subarray(0, split));
    setTimeout(() => req.end(encoded.subarray(split)), 100);
  });
  assert.deepEqual(received, original);
  assert.equal((await fetch(url + '/reply', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(url + '/reply', { method: 'POST', headers, body: 'x'.repeat(40 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(forwarded, 1, 'Invalid and oversized payloads must not reach the add-on');
  await new Promise(resolve => {
    const req = request(url + '/reply', { method: 'POST', headers: { ...headers, 'Content-Length': '10000' } });
    req.on('error', () => {});
    req.on('close', resolve);
    req.write('{');
    setTimeout(() => req.destroy(), 100);
  });
  await delay(100);
  assert.equal((await fetch(url + '/bridge/status', { headers })).status, 200);
  console.log('PASS: HTTP/WS auth, split UTF-8, invalid/oversized/interrupted requests');

  // Run the actual CLI asynchronously so the fake extension can answer it.
  const cli = spawn(process.execPath, ['cli/src/cli.js', 'reply', '42', '--body', 'Synthetic reply',
    '--to', 'test@example.invalid', '--from', 'test-identity', '--attach', 'test/quick-test.mjs', '--open'], {
    cwd: root, env: { ...process.env, TB_AUTH_TOKEN: token, TB_BRIDGE_HOST: '127.0.0.1', TB_BRIDGE_PORT: String(httpPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cliOut = '', cliErr = '';
  cli.stdout.on('data', b => { cliOut += b; });
  cli.stderr.on('data', b => { cliErr += b; });
  assert.equal((await once(cli, 'exit'))[0], 0, cliErr);
  const payload = JSON.parse(cliOut).data;
  assert.equal(payload.messageId, 42);
  assert.equal(payload.body, 'Synthetic reply');
  assert.equal(payload.identityId, 'test-identity');
  assert.deepEqual(payload.to, ['test@example.invalid']);
  assert.equal(payload.open, true);
  assert.equal(payload.send, undefined);
  assert.equal(payload.attachments[0].name, 'quick-test.mjs');
  assert(Buffer.from(payload.attachments[0].data, 'base64').equals(fs.readFileSync(root + 'test/quick-test.mjs')));
  console.log('PASS: actual CLI preserves reply ID, identity, recipient, open mode and attachment bytes');

  fs.mkdirSync(root + 'local-runtime', { recursive: true, mode: 0o700 });
  fixture = fs.mkdtempSync(root + 'local-runtime/build-test-');
  fs.mkdirSync(fixture + '/scripts');
  fs.copyFileSync(root + 'scripts/build-xpi.mjs', fixture + '/scripts/build-xpi.mjs');
  fs.copyFileSync(root + 'scripts/configure-local.mjs', fixture + '/scripts/configure-local.mjs');
  fs.copyFileSync(root + 'tb', fixture + '/tb');
  const configure = () => spawnSync(process.execPath, [fixture + '/scripts/configure-local.mjs'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(configure().status, 0);
  const env = fs.readFileSync(fixture + '/local-runtime/bridge.env', 'utf8');
  assert.equal(configure().status, 0);
  assert.equal(fs.readFileSync(fixture + '/local-runtime/bridge.env', 'utf8'), env);
  assert.equal(fs.statSync(fixture + '/local-runtime/bridge.env').mode & 0o777, 0o600);
  const service = fixture + '/local-runtime/thunderbird-cli-bridge.service';
  assert(fs.readFileSync(service, 'utf8').includes('Environment=TB_AUTH_TOKEN=\n'));
  if (process.platform === 'linux') {
    const verify = spawnSync('systemd-analyze', ['--user', 'verify', service], { encoding: 'utf8', timeout: 10000 });
    if (verify.error?.code === 'ENOENT') console.log('SKIP: systemd-analyze unavailable');
    else { assert.equal(verify.status, 0, verify.stderr); assert.equal(verify.stderr, ''); }
  }
  fs.writeFileSync(fixture + '/local-runtime/bridge.env', 'invalid');
  assert.notEqual(configure().status, 0, 'Invalid credentials must not be replaced');
  assert.equal(fs.readFileSync(fixture + '/local-runtime/bridge.env', 'utf8'), 'invalid');
  console.log('PASS: setup preserves private credentials and produces a valid fail-closed service');
  fs.cpSync(root + 'extension', fixture + '/extension', {
    recursive: true, filter: p => !p.endsWith('/bridge-auth.js'),
  });
  fs.writeFileSync(fixture + '/auth.env', 'TB_AUTH_TOKEN=' + 'a'.repeat(64) + '\n');
  for (const existing of [false, true]) {
    const out = fixture + '/dist/thunderbird-codex.xpi';
    if (existing) fs.chmodSync(out, 0o666);
    const build = spawnSync(process.execPath, [fixture + '/scripts/build-xpi.mjs', '--auth-file', fixture + '/auth.env', '--addon-id', 'test@local', '--addon-version', '2.1.0.4', '--output', out], { encoding: 'utf8', timeout: 10000 });
    assert.equal(build.status, 0, build.stderr);
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    const zip = new AdmZip(out);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    assert.equal(manifest.browser_specific_settings.gecko.id, 'test@local');
    assert.equal(manifest.version, '2.1.0.4');
    assert(!manifest.permissions.includes('messagesDelete'));
    assert(!manifest.permissions.includes('compose.send'));
    assert(zip.readAsText('src/bridge-auth.js').includes('a'.repeat(64)));
    assert.equal(manifest.background.scripts[0], 'src/bridge-auth.js');
  }
  console.log('PASS: new and existing private XPI builds stay mode 600');
} finally {
  socket?.terminate();
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  await exited;
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
}
