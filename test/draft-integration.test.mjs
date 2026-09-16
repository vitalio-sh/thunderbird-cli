import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
assert(!manifest.permissions.includes('messagesDelete'));
let began = 0;
let updated;
let attached = 0;
const original = { type: 'reply', relatedMessageId: 42, isPlainText: true,
  plainTextBody: '> Original message\n> Keep this exactly', to: ['original@example.org'] };
const context = vm.createContext({
  console, TB_ACCESS_CONFIG: {},
  WebSocket: class { constructor() { this.readyState = 0; } },
  setTimeout() {}, clearTimeout() {}, atob, Uint8Array, File,
  messenger: {
    compose: {
      async beginReply(id, type, details) {
        assert.equal(id, 42); assert.equal(type, 'replyToSender');
        assert.equal(details.plainTextBody, undefined); assert.equal(details.body, undefined);
        began++; return { id: 7 };
      },
      async getComposeDetails() { return { ...original, ...updated }; },
      async setComposeDetails(id, update) { assert.equal(id, 7); updated = update; },
      async addAttachment(id, attachment) {
        assert.equal(id, 7); assert.equal(await attachment.file.text(), 'attachment'); attached++;
      },
      async sendMessage() { assert.fail('Never send'); },
    },
  },
});
for (const file of ['access-control.js', 'background.js']) vm.runInContext(readFileSync(new URL('../extension/src/' + file, import.meta.url), 'utf8'), context);
const request = vm.runInContext('handleRequest', context);
const reply = { messageId: 42, body: 'Test reply', open: true, to: ['test@example.org'],
  attachments: [{ name: 'test.txt', data: btoa('attachment') }] };
const result = await request({ method: 'POST', path: '/reply', body: reply });
assert.equal(result.tabId, 7);
assert.equal(updated.plainTextBody, 'Test reply\n\n' + original.plainTextBody);
assert.equal(updated.to[0], 'test@example.org');
assert.equal(updated.cc.length + updated.bcc.length, 0);
assert.equal(attached, 1);
for (const path of ['/reply', '/compose', '/forward', '/messages/delete', '/tags/create']) {
  await assert.rejects(request({ method: 'POST', path, body: { ...reply, send: true } }), /FORBIDDEN/);
}
await assert.rejects(request({ method: 'POST', path: '/messages/delete', body: {} }), /FORBIDDEN/);
await assert.rejects(request({ method: 'POST', path: '/reply', body: { ...reply, messageId: -1 } }), /INVALID_ARGS/);
await assert.rejects(request({ method: 'POST', path: '/reply', body: { ...reply,
  attachments: [{ name: '../bad', data: '' }] } }), /INVALID_ARGS/);
await assert.rejects(request({ method: 'POST', path: '/reply', body: { ...reply, to: ['invalid'] } }), /INVALID_ARGS/);
await assert.rejects(request({ method: 'POST', path: '/reply', body: { ...reply, attachments: [null] } }), /INVALID_ARGS/);
assert.equal(began, 1, 'Rejected requests must not open a composer');
console.log('PASS: native reply, original quote, safe recipient override, attachment, send/mutation rejection');

const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
context.DOMParser = class {
  parseFromString(html) {
    let intro;
    return { createElement: () => ({ children: [], append(child) { this.children.push(child); } }),
      body: { prepend(node) { intro = node; } },
      documentElement: { get outerHTML() {
        return '<html><body><div>' + intro.children.map(p => '<p>' + escape(p.textContent) + '</p>').join('') + '</div>' + html + '</body></html>';
      } } };
  }
};
original.isPlainText = false;
original.body = '<blockquote>Original &amp; unchanged</blockquote>';
updated = undefined;
await request({ method: 'POST', path: '/reply', body: { messageId: 42, body: '<Not HTML>\n\nSecond paragraph', open: true } });
assert.equal(updated.body, '<html><body><div><p>&lt;Not HTML&gt;</p><p>Second paragraph</p></div><blockquote>Original &amp; unchanged</blockquote></body></html>');
let newDetails;
context.messenger.compose.beginNew = async (_id, details) => { newDetails = details; return { id: 8 }; };
await request({ method: 'POST', path: '/compose', body: { to: 'test@example.invalid', body: '<p>Hello</p>', isHTML: true, open: true, attachments: reply.attachments } });
assert.equal(newDetails.body, '<p>Hello</p>');
assert.equal(await newDetails.attachments[0].file.text(), 'attachment');
console.log('PASS: plain reply text keeps native HTML quote; new HTML draft includes attachment');

const decode = vm.runInContext('decodeAttachments', context);
const max = 25 * 1024 * 1024;
assert.equal(decode([{ name: 'large.bin', data: Buffer.alloc(max).toString('base64') }])[0].file.size, max);
assert.throws(() => decode([{ name: 'too-large.bin', data: Buffer.alloc(max + 1).toString('base64') }]), /25 MiB/);
assert.throws(() => decode([{ name: 'bad.bin', data: 'a===' }]), /INVALID_ARGS/);
console.log('PASS: 25 MiB attachment limit works without regex stack overflow');
