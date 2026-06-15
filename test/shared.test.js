const test = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../src/contentScript/shared.js');

const withChrome = (t, chromeMock) => {
  const previousChrome = global.chrome;
  global.chrome = chromeMock;
  t.after(() => {
    if (previousChrome === undefined) {
      delete global.chrome;
    } else {
      global.chrome = previousChrome;
    }
  });
};

test('validateLoopbackBaseUrl normalizes allowed local Brute endpoints', () => {
  assert.equal(shared.validateLoopbackBaseUrl(''), shared.DEFAULT_BRUTE_BASE_URL);
  assert.equal(
    shared.validateLoopbackBaseUrl(' http://localhost:5445/path/?token=secret#debug '),
    'http://localhost:5445/path',
  );
  assert.equal(shared.validateLoopbackBaseUrl('https://127.0.0.1:5445/'), 'https://127.0.0.1:5445');
  assert.equal(shared.validateLoopbackBaseUrl('http://[::1]:5445/?debug=1#hash'), 'http://[::1]:5445');
});

test('validateLoopbackBaseUrl rejects non-loopback or non-http base URLs', () => {
  assert.throws(
    () => shared.validateLoopbackBaseUrl('file:///tmp/brute.sock'),
    /Use http:\/\/ or https:\/\/ loopback URLs only\./,
  );
  assert.throws(
    () => shared.validateLoopbackBaseUrl('https://example.com:5445'),
    /Brute base URL must be localhost, 127\.0\.0\.1, or ::1\./,
  );
});

test('serializeApiOptions keeps only proxy-safe fetch fields', () => {
  assert.deepEqual(shared.serializeApiOptions(), { method: 'GET' });
  assert.deepEqual(
    shared.serializeApiOptions({
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: '',
      credentials: 'include',
      cache: 'reload',
    }),
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: '',
    },
  );
});

test('buildSessionDetailUrl encodes Caesar session route ids', () => {
  assert.equal(
    shared.buildSessionDetailUrl('session/with spaces'),
    'http://localhost:5173/chat/session%2Fwith%20spaces',
  );
});

test('storage helpers read and write through chrome local storage', async (t) => {
  const stored = { [shared.STORAGE_BASE_URL_KEY]: 'http://localhost:9999' };
  withChrome(t, {
    storage: {
      local: {
        get(keys, callback) {
          assert.deepEqual(keys, [shared.STORAGE_BASE_URL_KEY]);
          callback({ [shared.STORAGE_BASE_URL_KEY]: stored[shared.STORAGE_BASE_URL_KEY] });
        },
        set(payload, callback) {
          Object.assign(stored, payload);
          callback();
        },
      },
    },
  });

  assert.equal(await shared.storageGet(shared.STORAGE_BASE_URL_KEY), 'http://localhost:9999');
  await shared.storageSet(shared.STORAGE_BASE_URL_KEY, 'http://localhost:5446');
  assert.equal(stored[shared.STORAGE_BASE_URL_KEY], 'http://localhost:5446');
});

test('sendRuntimeMessage resolves responses and rejects Chrome runtime failures', async (t) => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      assert.deepEqual(message, { type: 'PING' });
      callback({ ok: true });
    },
  };
  withChrome(t, { runtime });

  assert.deepEqual(await shared.sendRuntimeMessage({ type: 'PING' }), { ok: true });

  runtime.sendMessage = (message, callback) => {
    assert.deepEqual(message, { type: 'PING' });
    runtime.lastError = { message: 'service worker unavailable' };
    callback();
    runtime.lastError = null;
  };
  await assert.rejects(
    shared.sendRuntimeMessage({ type: 'PING' }),
    /service worker unavailable/,
  );

  runtime.sendMessage = () => {
    throw new Error('extension context invalidated');
  };
  await assert.rejects(
    shared.sendRuntimeMessage({ type: 'PING' }),
    /extension context invalidated/,
  );
});
