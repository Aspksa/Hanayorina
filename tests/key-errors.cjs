const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const http = require('node:http');
const modulePath = resolve('dist/settings/keys.js');
const temp = mkdtempSync(join(tmpdir(), 'hanayorina-keys-'));
process.chdir(temp);
const keys = require(modulePath);
test('key-specific and temporary errors use distinct handling', async t => {
  let statuses = [], hits = [], retryAfter = undefined;
  const server = http.createServer((req, res) => {
    hits.push(req.headers.authorization);
    const status = statuses.shift();
    res.writeHead(status, retryAfter ? { 'Retry-After': retryAfter } : {}); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); });
  keys.configure(`http://127.0.0.1:${server.address().port}/v1`, true);
  keys.addKey('first', 'dummy-one'); keys.addKey('second', 'dummy-two');
  for (const status of [401, 402]) {
    keys.selectKey(keys.publicSettings().keys[0].id); hits = []; statuses = [status, 200];
    const result = await keys.testConnection(); assert.equal(result.name, 'second'); assert.equal(result.switched, true); assert.deepEqual(hits, ['Bearer dummy-one', 'Bearer dummy-two']);
  }
  for (const status of [429, 524, 403]) {
    keys.selectKey(keys.publicSettings().keys[0].id); hits = []; statuses = [status]; retryAfter = status === 429 ? '30' : undefined;
    await assert.rejects(keys.testConnection()); assert.equal(hits.length, 1); assert.equal(keys.publicSettings().activeId, keys.publicSettings().keys[0].id);
  }
  retryAfter = '0'; hits = []; statuses = [429, 200];
  assert.equal((await keys.testConnection()).name, 'first'); assert.deepEqual(hits, ['Bearer dummy-one', 'Bearer dummy-one']);
  for (const status of [502, 503, 504]) {
    retryAfter = undefined; hits = []; statuses = [status, 200];
    assert.equal((await keys.testConnection()).name, 'first'); assert.deepEqual(hits, ['Bearer dummy-one', 'Bearer dummy-one']);
  }
});
