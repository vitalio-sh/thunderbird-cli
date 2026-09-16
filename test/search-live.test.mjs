// Read-only checks against the running, restricted local add-on. Never sends or edits mail.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
process.env.TB_AUTH_TOKEN = fs.readFileSync(new URL('local-runtime/bridge.env', root), 'utf8').trim().split('=')[1];
const { api } = await import('../cli/src/client.js');
const baseline = JSON.parse(fs.readFileSync(new URL('local-runtime/search-live-baseline.json', root)));
const expectedVersion = process.argv[2];
assert(expectedVersion, 'Pass the installed add-on version as the argument');
let passed = 0;
function check(name, condition) {
  assert(condition, name);
  passed++;
  console.log('PASS:', name);
}
const ids = messages => messages.map(m => m.headerMessageId);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const search = filters => api('POST', '/messages/search', { query: '', subject: baseline.subject, limit: 50, ...filters });
const health = await api('GET', '/health');
check('patched add-on is running', health.version === expectedVersion);
const all = await search({});
check('comparison sample is complete and unchanged', !all.hasMore && all.total > 1 &&
  same(ids(all.messages).sort(), ids(baseline.messages).sort()));
const beforeFlags = all.messages.map(m => ({ id: m.id, read: m.read, flagged: m.flagged, tags: m.tags }));
for (const limit of [0, 1, all.total, all.total + 1]) {
  const r = await search({ limit });
  check(`search limit ${limit}: records and hasMore`, r.total === Math.min(limit, all.total) &&
    same(ids(r.messages), ids(all.messages.slice(0, limit))) && r.hasMore === (all.total > limit));
}
const sizes = [...new Set(all.messages.map(m => m.size))].sort((a, b) => a - b);
check('sample includes different message sizes', sizes.length > 1);
for (const filters of [
  { sizeMin: sizes[1] }, { sizeMax: sizes[0] },
  { sizeMin: sizes[1], sizeMax: sizes[1] }, { sizeMax: 0 },
]) {
  const matching = all.messages.filter(m => (filters.sizeMin == null || m.size >= filters.sizeMin) &&
    (filters.sizeMax == null || m.size <= filters.sizeMax));
  const r = await search({ ...filters, limit: 1 });
  check(`native size filtering ${JSON.stringify(filters)}`, same(ids(r.messages), ids(matching.slice(0, 1))) &&
    r.hasMore === (matching.length > 1));
}
const missingTag = await search({ tag: 'codex-nonexistent-search-test-tag', limit: 1 });
check('nonexistent tag returns no matches', missingTag.total === 0 && !missingTag.hasMore);
let testedPositiveTag = false;
for (const tag of ['$label1', '$label2', '$label3', '$label4', '$label5']) {
  const r = await api('POST', '/messages/search', { tag, limit: 2 });
  check(`tag ${tag}: every returned message matches`, r.messages.every(m => m.tags.includes(tag)));
  if (r.total) {
    const one = await api('POST', '/messages/search', { tag, limit: 1 });
    check('positive tag result survives limit', one.total === 1 && one.messages[0].tags.includes(tag) &&
      (r.total < 2 || one.hasMore));
    testedPositiveTag = true;
    break;
  }
}
if (!testedPositiveTag) console.log('NOT COVERED LIVE: no messages found with built-in tags; positive-tag cases covered by regression tests.');
const folderId = baseline.inboxId;
const list = filters => api('POST', '/messages/list', { folderId, ...filters });
const inbox = await list({ limit: 151 });
check('real multi-page sample available', inbox.total > 101);
for (const [limit, offset] of [[1, 0], [100, 0], [101, 0], [2, 99]]) {
  const r = await list({ limit, offset });
  check(`folder listing limit=${limit} offset=${offset}`, same(ids(r.messages), ids(inbox.messages.slice(offset, offset + limit))) && r.hasMore);
}
for (const limit of [-1, 1.5]) {
  let rejected = false;
  try { await search({ limit }); } catch (e) { rejected = e.message.includes('INVALID_ARGS'); }
  check(`invalid limit ${limit} rejected`, rejected);
}
const after = await search({});
check('comparison messages remain unchanged', same(beforeFlags, after.messages.map(m => ({ id: m.id, read: m.read, flagged: m.flagged, tags: m.tags }))));
check('bridge remains connected after repeated queries', (await api('GET', '/health')).version === health.version);
console.log(JSON.stringify({ passed, positiveTagTested: testedPositiveTag, version: health.version }));
