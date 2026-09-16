// Regression coverage for the whole-repository review. Synthetic mail only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tools } from '../mcp/src/tools.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS:', name); }
  catch (e) { failed++; console.error('FAIL:', name, e.message); }
}
const tool = (name, args, api = async (_method, _path, body) => body) => tools.find(t => t.name === name).handler(args, api);
await test('MCP search preserves zero limit, size bounds and false flagged', async () => {
  const p = await tool('email_search', { sizeMax: 0, sizeMin: 0, limit: 0, flagged: false });
  assert.deepEqual(p, { limit: 0, flagged: false, sizeMin: 0, sizeMax: 0 });
});
await test('MCP list preserves zero limit', async () => assert.equal((await tool('email_list', { folderId: 'test', limit: 0 })).limit, 0));
await test('disabled MCP switches do not count as a search filter', async () => {
  await assert.rejects(tool('email_search', { unread: false, hasAttachment: false }), /requires a query/);
});
await test('MCP caps HTML and raw bodies, not only plain text', async () => {
  const r = await tool('email_read', { messageId: 1, maxBody: 3 }, async () => ({ parts: { html: 'abcdefgh' }, raw: 'abcdefgh' }));
  assert.equal(r.parts.html, 'abc\n...[truncated]'); assert.equal(r.raw, 'abc\n...[truncated]');
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ status: 200, json: async () => ({ error: 'Synthetic failure', code: 'NOT_FOUND' }) });
try {
  for (const module of ['../cli/src/client.js', '../mcp/src/client.js']) {
    await test(`${module} rejects HTTP-200 error payloads`, async () => {
      const { api } = await import(module);
      await assert.rejects(api('GET', '/test'), e => e.code === 'NOT_FOUND');
    });
  }
} finally { globalThis.fetch = originalFetch; }
await test('HTTP failures with a null JSON body retain their status', async () => {
  globalThis.fetch = async () => ({ status: 503, json: async () => null });
  try {
    for (const module of ['../cli/src/client.js', '../mcp/src/client.js']) {
      await assert.rejects((await import(module)).api('GET', '/test'), e => e.message === 'HTTP 503' && e.code === 'EXTENSION_DISCONNECTED');
    }
  } finally { globalThis.fetch = originalFetch; }
});
await test('CLI caps HTML/raw bodies inside batch output', async () => {
  const { output } = await import('../cli/src/client.js');
  const write = process.stdout.write; let text = '';
  process.stdout.write = chunk => { text += chunk; return true; };
  try { output([{ parts: { html: 'abcdefgh' }, raw: 'abcdefgh' }], 'json', { maxBody: 3 }); }
  finally { process.stdout.write = write; }
  const data = JSON.parse(text).data[0];
  assert.equal(data.parts.html, 'abc\n...[truncated]'); assert.equal(data.raw, 'abc\n...[truncated]');
});

const header = id => ({ id, date: new Date('2026-01-01'), subject: 'Topic', headerMessageId: 'root@example.invalid', tags: [] });
const messenger = {
  folders: { get: async id => ({ id }), getSubFolders: async () => [], getFolderInfo: async () => ({ totalMessageCount: 7, unreadMessageCount: 2 }) },
  messages: {
    get: async id => header(id), getRaw: async () => 'Message-ID: <root@example.invalid>\r\n\r\nBody',
    getFull: async () => ({ parts: [{ contentType: 'text/plain', body: 'body' }, { contentType: 'text/plain', name: 'note.txt', partName: '1.2', body: 'file content' }] }),
    listAttachments: async () => [{ name: 'note.txt', partName: '1.2', contentType: 'text/plain', size: 12 }],
    query: async q => q.headerMessageId ? { messages: [header(1)], id: 'more' } : { messages: [] },
    continueList: async () => ({ messages: [header(2)] }), abortList: async () => {},
  },
};
const ctx = vm.createContext({ messenger, console, WebSocket: class {}, setTimeout() {}, clearTimeout() {} });
// These regressions exercise explicitly enabled write operations on synthetic mail.
ctx.TB_ACCESS_CONFIG = { send: true, tag: true };
for (const file of ['access-control.js', 'thread-utils.js', 'background.js']) vm.runInContext(fs.readFileSync(new URL('../extension/src/' + file, import.meta.url), 'utf8'), ctx);
const handle = (method, path, body) => ctx.handleRequest({ method, path, body });
await test('account roots skip native counts while real-folder failures propagate', async () => {
  const savedFolders = messenger.folders, savedAccounts = messenger.accounts;
  const leaf = { id: 'leaf', name: 'Leaf', isRoot: false };
  const child = { id: 'child', name: 'Child', isRoot: false, subFolders: [leaf] };
  const rootFolder = { id: 'root', name: 'Root', isRoot: true, subFolders: [child] };
  messenger.accounts = { get: async () => ({ rootFolder }), list: async () => [{ id: 'account', rootFolder }] };
  const routes = [['GET', '/accounts/account/folders'],
    ['GET', '/stats'], ['POST', '/stats', {}], ['POST', '/stats', { folders: true }]];
  let failedFolder, count = 7, queried = [];
  messenger.folders = { get: async id => [rootFolder, child, leaf].find(f => f.id === id), getFolderInfo: async folder => {
    queried.push(folder.id);
    if (folder.isRoot) throw Error('Native API does not support root counts');
    if (folder.id === failedFolder) throw Error('Native count failure');
    return { totalMessageCount: count, unreadMessageCount: count ? 2 : 0, newMessageCount: 0 };
  } };
  try {
    for (count of [7, 0]) {
      for (const [method, path, body] of routes) {
        queried = [];
        const result = await handle(method, path, body);
        assert(!queried.includes('root'));
        assert(queried.includes('child') && queried.includes('leaf'));
        const rows = Array.isArray(result) ? result : result.accounts[0].folderDetails;
        if (rows) {
          assert.equal(rows.length, 3);
          assert.equal(rows[0].totalMessageCount, 0);
          assert.equal(rows[1].totalMessageCount, count);
          assert.equal(rows[2].depth, 2);
        }
        if (!Array.isArray(result)) {
          assert.equal(result.totalMessages, 2 * count);
          assert.equal(result.totalUnread, count ? 4 : 0);
        }
      }
    }
    for (failedFolder of ['child', 'leaf']) {
      for (const [method, path, body] of routes) {
        await assert.rejects(handle(method, path, body), /Native count failure/);
      }
      await assert.rejects(handle('POST', '/folders/info', { folderId: failedFolder }), /Native count failure/);
    }
    failedFolder = null;
    assert.equal((await handle('POST', '/folders/info', { folderId: 'child' })).totalMessageCount, 0);
    await assert.rejects(handle('POST', '/folders/info', { folderId: 'root' }), /does not support root/);
    rootFolder.subFolders = [];
    assert.equal((await handle('GET', '/stats')).totalMessages, 0);
  } finally { messenger.folders = savedFolders; messenger.accounts = savedAccounts; }
});
await test('download status uses native headersOnly, accepts empty bodies and propagates read failures', async () => {
  const savedGet = messenger.messages.get, savedFull = messenger.messages.getFull;
  try {
    for (const headersOnly of [false, true]) {
      messenger.messages.get = async id => ({ ...header(id), headersOnly });
      for (const full of [{ contentType: 'text/plain', body: '' },
        { parts: [{ contentType: 'application/pdf', name: 'file.pdf', partName: '1.2' }] }]) {
        messenger.messages.getFull = async (id, options) => {
          assert.equal(id, 1); assert.equal(options.decrypt, false);
          return full;
        };
        const check = await handle('GET', '/messages/1/check-download');
        const status = await handle('GET', '/messages/1/download-status');
        assert.equal(check.downloadState, headersOnly ? 'headers_only' : 'full');
        assert.equal(status.state, check.downloadState);
        assert.equal(check.hasBody, !headersOnly);
      }
    }
    for (const path of ['check-download', 'download-status']) {
      let headersOnly = true;
      messenger.messages.get = async id => ({ ...header(id), headersOnly });
      messenger.messages.getFull = async () => { headersOnly = false; return { contentType: 'text/plain', body: '' }; };
      const result = await handle('GET', '/messages/1/' + path);
      assert.equal(result.state ?? result.downloadState, 'full');
    }
    messenger.messages.get = async () => { throw Error('Native header failure'); };
    for (const path of ['check-download', 'download-status']) {
      await assert.rejects(handle('GET', '/messages/1/' + path), /Native header failure/);
    }
    messenger.messages.getFull = async () => { throw Error('Native read failure'); };
    for (const path of ['check-download', 'download-status']) {
      await assert.rejects(handle('GET', '/messages/1/' + path), /Native read failure/);
    }
  } finally { messenger.messages.get = savedGet; messenger.messages.getFull = savedFull; }
});
await test('download check reports real attachment presence and propagates listing failures', async () => {
  const original = messenger.messages.listAttachments;
  try {
    for (const count of [0, 1, 2]) {
      messenger.messages.listAttachments = async id => {
        assert.equal(id, 1);
        return Array.from({ length: count }, () => ({ name: 'note.txt', partName: '1.2' }));
      };
      const result = await handle('GET', '/messages/1/check-download');
      assert.equal(result.hasAttachments, count > 0);
      assert.equal(result.hasBody, true);
    }
    messenger.messages.listAttachments = async () => { throw new Error('Attachment listing failed'); };
    await assert.rejects(handle('GET', '/messages/1/check-download'), /Attachment listing failed/);
  } finally { messenger.messages.listAttachments = original; }
});
await test('extension rejects malformed IDs and non-boolean operation flags before doing work', async () => {
  for (const body of [{ messageIds: [1.2] }, { messageId: '1' }, { send: 'false' }, { flagged: 'false' }, []]) {
    await assert.rejects(handle('POST', '/compose', body), /INVALID_ARGS/);
  }
});
await test('reply preserves native quotation and refuses to send after preparation failure', async () => {
  let opened, updated, sent = 0;
  messenger.compose = {
    beginReply: async (...args) => { opened = args; return { id: 7 }; },
    getComposeDetails: async () => ({ type: 'reply', relatedMessageId: 1, plainTextBody: 'Original quotation', isPlainText: true }),
    setComposeDetails: async (_id, details) => { updated = details; },
    sendMessage: async () => { sent++; },
  };
  const r = await handle('POST', '/reply', { messageId: 1, body: 'Answer', open: true });
  assert.equal(r.tabId, 7); assert.equal(opened[0], 1); assert.equal(opened[2].plainTextBody, undefined);
  assert.equal(updated.plainTextBody, 'Answer\n\nOriginal quotation'); assert.equal(sent, 0);
  messenger.compose.setComposeDetails = async () => { throw Error('preparation failure'); };
  await assert.rejects(handle('POST', '/reply', { messageId: 1, body: 'Answer', send: true }), /tab 7.*inspect it/);
  assert.equal(sent, 0);
});
await test('compose uses native priority and forwards custom headers', async () => {
  let details;
  messenger.compose.beginNew = async (_id, d) => { details = d; return { id: 8 }; };
  await handle('POST', '/compose', { to: 'test@example.invalid', body: 'Text', priority: 'high', header: 'X-Test: one:two', open: true });
  assert.equal(details.priority, 'high'); assert.equal(details.customHeaders[0].name, 'X-Test');
  assert.equal(details.customHeaders[0].value, 'one:two');
  await assert.rejects(handle('POST', '/compose', { header: 'X-Test: one\r\nBcc: injected@example.invalid' }), /INVALID_ARGS/);
});
await test('HTML reply prepends content inside the native document without replacing its quotation', async () => {
  let details, parsed, inserted, opened;
  ctx.DOMParser = class {
    parseFromString(html, type) {
      parsed = { html, type };
      return { createElement: () => ({}), body: { prepend: node => { inserted = node.innerHTML; } },
        documentElement: { get outerHTML() { return `<html><body><div>${inserted}</div>${html}</body></html>`; } } };
    }
  };
  messenger.compose.beginReply = async (_id, _type, d) => { opened = d; return { id: 7 }; };
  messenger.compose.getComposeDetails = async () => ({ type: 'reply', relatedMessageId: 1, body: '<blockquote>Quote</blockquote>', isPlainText: false });
  messenger.compose.setComposeDetails = async (_id, d) => { details = d; };
  await handle('POST', '/reply', { messageId: 1, body: '<b>Answer</b>', isHTML: true, open: true });
  assert.equal(opened.isPlainText, false); assert.equal(parsed.type, 'text/html');
  assert.equal(parsed.html, '<blockquote>Quote</blockquote>'); assert.equal(inserted, '<b>Answer</b>');
  assert.equal(details.body, '<html><body><div><b>Answer</b></div><blockquote>Quote</blockquote></body></html>');
});
await test('bulk filters and already-tagged messages are skipped before limiting', async () => {
  const saved = messenger.messages.continueList;
  messenger.messages.list = async () => ({ messages: [{ ...header(1), author: 'other' }], id: 'second' });
  messenger.messages.continueList = async () => ({ messages: [
    { ...header(2), author: 'wanted', tags: ['tag'] }, { ...header(3), author: 'wanted' },
  ] });
  const updated = [];
  messenger.messages.update = async id => { updated.push(id); };
  try {
    await handle('POST', '/bulk/tag', { folderId: 'test', from: 'wanted', limit: 1, tagKey: 'tag' });
    assert.deepEqual(updated, [3]);
    const r = await handle('POST', '/messages/list', { folderId: 'test', from: 'wanted', subjectPattern: '^Top', limit: 1 });
    assert.equal(r.messages[0].id, 2); assert.equal(r.hasMore, true);
    await handle('POST', '/bulk/tag', { folderId: 'test', limit: 0, tagKey: 'tag' });
    assert.deepEqual(updated, [3]);
    await assert.rejects(handle('POST', '/bulk/tag', { folderId: 'test', olderThan: null }), /INVALID_ARGS/);
  } finally { messenger.messages.continueList = saved; }
});
await test('attachment listing includes native text attachments', async () => {
  const r = await handle('GET', '/messages/1/attachments'); assert.equal(r[0]?.name, 'note.txt');
});
await test('text attachment is not merged into message body', async () => {
  const r = await handle('GET', '/messages/1'); assert.equal(r.parts.text, 'body'); assert.equal(r.parts.attachments[0]?.name, 'note.txt');
});
await test('thread query consumes later native pages', async () => {
  const r = await handle('GET', '/messages/1/thread'); assert(r.thread.some(m => m.id === 2));
});
await test('thread query failure is not reported as a complete empty result', async () => {
  const saved = messenger.messages.query;
  messenger.messages.query = async () => { throw Error('query failed'); };
  try { await assert.rejects(handle('GET', '/messages/1/thread'), /query failed/); }
  finally { messenger.messages.query = saved; }
});
await test('sync does not fake success by listing folders', async () => assert.rejects(handle('POST', '/sync', { folderId: 'test' }), /Manual sync required/));
await test('sync status uses native message counts', async () => {
  const r = await handle('POST', '/sync/status', { folderId: 'test' }); assert.equal(r.totalMessages, 7); assert.equal(r.unread, 2);
});

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fs.mkdtempSync(root + '.review-test-');
let filename = '../escape.txt', received = 0, lastBody, listResult = { messages: [{ id: 9 }], bulkFiltersApplied: true }, lastListBody;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (body) lastBody = JSON.parse(body);
  if (req.url === '/messages/list') lastListBody = lastBody;
  received++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/messages/list' ? listResult : req.url.endsWith('/attachments') ? [{ name: filename, partName: '1.2' }]
    : req.url.endsWith('/attachment') ? { data: Buffer.from('synthetic').toString('base64') }
    : req.url === '/messages/1' ? { parts: { text: 'x'.repeat(2000) } } : { success: true }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
async function cli(args) {
  const p = spawn(process.execPath, ['cli/src/cli.js', ...args], { cwd: root,
    env: { ...process.env, TB_BRIDGE_HOST: '127.0.0.1', TB_BRIDGE_PORT: String(server.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  p.stdout.on('data', b => { stdout += b; }); p.stderr.on('data', b => { stderr += b; });
  const [code] = await once(p, 'exit'); return { code, stdout, stderr };
}
try {
  await test('actual CLI body-only output obeys max-body without changing short or uncapped output', async () => {
    for (const [limit, expected] of [[10, 'x'.repeat(10) + '\n...[truncated]'], [2000, 'x'.repeat(2000)], [null, 'x'.repeat(2000)]]) {
      const r = await cli([...(limit === null ? [] : ['--max-body', String(limit)]), 'read', '1', '--body-only']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout), expected);
    }
  });
  await test('bridge rejects unsupported read-only mode instead of silently enabling writes', async () => {
    const p = spawn(process.execPath, ['bridge/bridge.js', '--read-only'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; p.stderr.on('data', b => { stderr += b; }); p.stdout.resume();
    const [code] = await once(p, 'exit'); assert.equal(code, 1); assert.match(stderr, /not implemented/);
  });
  await test('XPI build preserves package contents and private permissions on create and overwrite', async () => {
    const build = dir + '/build'; fs.mkdirSync(build + '/scripts', { recursive: true });
    fs.cpSync(root + 'extension', build + '/extension', { recursive: true });
    fs.copyFileSync(root + 'scripts/build-xpi.mjs', build + '/scripts/build-xpi.mjs');
    const version = JSON.parse(fs.readFileSync(build + '/extension/manifest.json')).version;
    const xpi = build + `/dist/thunderbird-cli-${version}.xpi`;
    for (let i = 0; i < 2; i++) {
      if (i) fs.chmodSync(xpi, 0o666);
      const p = spawn(process.execPath, [build + '/scripts/build-xpi.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = ''; p.stderr.on('data', b => { stderr += b; }); p.stdout.resume();
      const [code] = await once(p, 'exit'); assert.equal(code, 0, stderr);
      assert.equal(fs.statSync(xpi).mode & 0o777, 0o600);
    }
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(xpi);
    assert.equal(zip.readAsText('src/background.js'), fs.readFileSync(build + '/extension/src/background.js', 'utf8'));
    assert.equal(JSON.parse(zip.readAsText('manifest.json')).version, version);
  });
  fs.mkdirSync(dir + '/downloads');
  await test('download-all rejects attachment path traversal', async () => {
    const r = await cli(['attachment-download', '1', '--all', '--output-dir', dir + '/downloads']);
    assert.notEqual(r.code, 0); assert(!fs.existsSync(dir + '/escape.txt'));
  });
  await test('download-all will not overwrite an existing file', async () => {
    filename = 'saved.txt'; fs.writeFileSync(dir + '/downloads/saved.txt', 'keep');
    const r = await cli(['attachment-download', '1', '--all', '--output-dir', dir + '/downloads']);
    assert.notEqual(r.code, 0); assert.equal(fs.readFileSync(dir + '/downloads/saved.txt', 'utf8'), 'keep');
  });
  await test('downloaded attachment stays private', async () => {
    filename = 'new.txt'; const r = await cli(['attachment-download', '1', '--all', '--output-dir', dir + '/downloads']);
    assert.equal(r.code, 0, r.stderr); assert.equal(fs.statSync(dir + '/downloads/new.txt').mode & 0o777, 0o600);
  });
  await test('malformed destructive IDs do not reach the bridge', async () => {
    const before = received;
    for (const id of ['42oops', '42.5', '42,', '-1', '9007199254740993']) assert.notEqual((await cli(['move', id, 'trash'])).code, 0);
    assert.equal(received, before);
  });
  await test('malformed single-message IDs and bulk counts do not reach the bridge', async () => {
    const before = received;
    for (const args of [['reply', '1oops'], ['forward', '1.2', '--to', 'test@example.invalid'],
      ['fetch', '1oops'], ['bulk', 'tag', 'folder', 'tag', '--older-than', 'oops'],
      ['bulk', 'tag', 'folder', 'tag', '--limit', '1oops']]) assert.notEqual((await cli(args)).code, 0);
    assert.equal(received, before);
  });
  await test('CLI forwards reply HTML flag', async () => {
    const r = await cli(['reply', '1', '--html', '--body', '<b>Answer</b>', '--open']);
    assert.equal(r.code, 0, r.stderr); assert.equal(lastBody.isHTML, true);
  });
  await test('bulk move forwards filters before limiting and requires a compatible extension', async () => {
    const args = ['bulk', 'move', 'source', 'destination', '--from', 'wanted', '--subject', '^Topic', '--older-than', '3', '--limit', '1'];
    const r = await cli(args); assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(lastListBody, { folderId: 'source', limit: 1, from: 'wanted', subjectPattern: '^Topic', olderThan: 3 });
    assert.deepEqual(lastBody, { messageIds: [9], destinationFolderId: 'destination' });
    listResult = { messages: [{ id: 9 }] }; const before = received;
    assert.notEqual((await cli(args)).code, 0); assert.equal(received, before + 1);
  });
} finally {
  await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
