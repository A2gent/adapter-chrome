const test = require('node:test');
const assert = require('node:assert/strict');

const caesarApi = require('../src/contentScript/caesarApi.js');

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

const createRuntimeMock = ({ sendResponse } = {}) => {
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback(sendResponse ? sendResponse(message) : { ok: true, response: { ok: true, status: 200, body: {} } });
    },
  };
  return { runtime, messages };
};

const createPortMock = () => {
  const messageListeners = new Set();
  const disconnectListeners = new Set();
  const postedMessages = [];
  let disconnectCount = 0;

  const createEvent = (listeners) => ({
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
  });

  return {
    postedMessages,
    get disconnectCount() {
      return disconnectCount;
    },
    get messageListenerCount() {
      return messageListeners.size;
    },
    get disconnectListenerCount() {
      return disconnectListeners.size;
    },
    port: {
      onMessage: createEvent(messageListeners),
      onDisconnect: createEvent(disconnectListeners),
      postMessage(message) {
        postedMessages.push(message);
      },
      disconnect() {
        disconnectCount += 1;
      },
    },
    emitMessage(message) {
      for (const listener of [...messageListeners]) listener(message);
    },
    emitDisconnect() {
      for (const listener of [...disconnectListeners]) listener();
    },
  };
};

test('apiErrorDetail returns the most helpful Brute failure detail', () => {
  assert.equal(caesarApi.apiErrorDetail({ body: { error: 'bad request' } }), 'bad request');
  assert.equal(caesarApi.apiErrorDetail({ body: { message: 'not found' } }), 'not found');
  assert.equal(caesarApi.apiErrorDetail({ bodyText: 'plain text failure' }), 'plain text failure');
  assert.equal(caesarApi.apiErrorDetail({ status: 502, statusText: 'Bad Gateway' }), '502 Bad Gateway');
  assert.equal(caesarApi.apiErrorDetail({}), 'Brute request failed.');
});

test('apiFetch proxies JSON API calls through the runtime and normalizes responses', async (t) => {
  const { runtime, messages } = createRuntimeMock({
    sendResponse(message) {
      assert.equal(message.baseUrl, 'http://localhost:5445/custom');
      if (message.path === '/empty') {
        return { ok: true, response: { ok: true, status: 204 } };
      }
      return { ok: true, response: { ok: true, status: 200, body: { ok: true } } };
    },
  });
  withChrome(t, { runtime });

  const client = caesarApi.createApiClient({ getBaseUrl: async () => ' http://localhost:5445/custom?token=secret#debug ' });

  assert.deepEqual(
    await client.apiFetch('/items', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: '{"hello":"world"}',
      credentials: 'include',
    }),
    { ok: true },
  );
  assert.equal(await client.apiFetch('/empty'), null);

  assert.deepEqual(messages[0], {
    type: 'A2GENT_BRUTE_API_FETCH',
    baseUrl: 'http://localhost:5445/custom',
    path: '/items',
    options: {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: '{"hello":"world"}',
    },
  });
  assert.deepEqual(messages[1].options, { method: 'GET' });
});

test('createSession omits empty project IDs and listProjects uses the projects endpoint', async (t) => {
  const { runtime, messages } = createRuntimeMock({
    sendResponse(message) {
      if (message.path === '/sessions') {
        return { ok: true, response: { ok: true, status: 200, body: { id: 'session-1' } } };
      }
      return { ok: true, response: { ok: true, status: 200, body: [{ id: 'project-1' }] } };
    },
  });
  withChrome(t, { runtime });

  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://127.0.0.1:5445/' });

  assert.deepEqual(await client.createSession('', { source: 'adapter-chrome' }), { id: 'session-1' });
  assert.deepEqual(await client.listProjects(), [{ id: 'project-1' }]);

  assert.equal(messages[0].path, '/sessions');
  assert.equal(messages[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(messages[0].options.body), {
    agent_id: 'build',
    metadata: { source: 'adapter-chrome' },
  });
  assert.equal(messages[1].path, '/projects');
});

test('apiFetch reports runtime proxy and Brute HTTP failures', async (t) => {
  const { runtime } = createRuntimeMock({
    sendResponse(message) {
      if (message.path === '/proxy-error') return { ok: false, error: 'service worker offline' };
      return { ok: true, response: { ok: false, status: 500, statusText: 'Internal Server Error', body: { message: 'Brute exploded' } } };
    },
  });
  withChrome(t, { runtime });
  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://localhost:5445' });

  await assert.rejects(client.apiFetch('/proxy-error'), /service worker offline/);
  await assert.rejects(client.apiFetch('/brute-error'), /Brute exploded/);
});

test('sendStreamMessage starts a background stream and emits chunked NDJSON events', async (t) => {
  const portMock = createPortMock();
  const previousNow = Date.now;
  const previousRandom = Math.random;
  Date.now = () => 1234567890;
  Math.random = () => 0.5;
  t.after(() => {
    Date.now = previousNow;
    Math.random = previousRandom;
  });
  withChrome(t, {
    runtime: {
      connect(options) {
        assert.deepEqual(options, { name: 'A2GENT_BRUTE_STREAM' });
        return portMock.port;
      },
    },
  });

  const events = [];
  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://localhost:5445?debug=1#hash' });
  const stream = client.sendStreamMessage('session/with space', 'Hello', [{ name: 'screen.png' }], {
    onEvent(event) {
      events.push(event);
    },
  });
  await Promise.resolve();

  assert.deepEqual(portMock.postedMessages, [{
    type: 'A2GENT_BRUTE_STREAM_START',
    requestId: '1234567890-8',
    baseUrl: 'http://localhost:5445',
    path: '/sessions/session%2Fwith%20space/chat/stream',
    options: {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Hello', images: [{ name: 'screen.png' }] }),
    },
  }]);

  portMock.emitMessage({ requestId: 'other-request', type: 'A2GENT_BRUTE_STREAM_CHUNK', chunk: '{"ignored":true}\n' });
  portMock.emitMessage({ requestId: '1234567890-8', type: 'A2GENT_BRUTE_STREAM_CHUNK', chunk: '{"type":"delta","text":"Hel"}\n{"type"' });
  portMock.emitMessage({ requestId: '1234567890-8', type: 'A2GENT_BRUTE_STREAM_CHUNK', chunk: ':"delta","text":"lo"}\n' });
  portMock.emitMessage({ requestId: '1234567890-8', type: 'A2GENT_BRUTE_STREAM_CHUNK', chunk: '{"type":"done"}' });
  portMock.emitMessage({ requestId: '1234567890-8', type: 'A2GENT_BRUTE_STREAM_DONE' });

  await stream;

  assert.deepEqual(events, [
    { type: 'delta', text: 'Hel' },
    { type: 'delta', text: 'lo' },
    { type: 'done' },
  ]);
  assert.equal(portMock.disconnectCount, 1);
  assert.equal(portMock.messageListenerCount, 0);
  assert.equal(portMock.disconnectListenerCount, 0);
});

test('sendStreamMessage rejects stream errors and unexpected disconnects', async (t) => {
  const errorPort = createPortMock();
  withChrome(t, { runtime: { connect: () => errorPort.port } });
  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://localhost:5445' });

  const failedStream = client.sendStreamMessage('session-1', 'Hello');
  await Promise.resolve();
  const errorRequestId = errorPort.postedMessages[0].requestId;
  errorPort.emitMessage({ requestId: errorRequestId, type: 'A2GENT_BRUTE_STREAM_ERROR', error: 'stream failed' });
  await assert.rejects(failedStream, /stream failed/);
  assert.equal(errorPort.disconnectCount, 1);

  const disconnectPort = createPortMock();
  global.chrome.runtime.connect = () => disconnectPort.port;
  const disconnectedStream = client.sendStreamMessage('session-2', 'Hello');
  await Promise.resolve();
  disconnectPort.emitDisconnect();
  await assert.rejects(disconnectedStream, /Brute stream disconnected/);
});
