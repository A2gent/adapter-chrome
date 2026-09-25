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

test('createSession sends the selected host provider/model and list helpers use catalog endpoints', async (t) => {
  const { runtime, messages } = createRuntimeMock({
    sendResponse(message) {
      if (message.path === '/sessions') {
        return { ok: true, response: { ok: true, status: 200, body: { id: 'session-1' } } };
      }
      if (message.path === '/providers') {
        return { ok: true, response: { ok: true, status: 200, body: [{ type: 'cursor', is_active: true }] } };
      }
      if (message.path === '/providers/cursor/models') {
        return { ok: true, response: { ok: true, status: 200, body: { models: ['composer-2'] } } };
      }
      if (message.path === '/unified-agents/') {
        return { ok: true, response: { ok: true, status: 200, body: { agents: [{ id: 'reviewer', runtime: 'docker' }] } } };
      }
      return { ok: true, response: { ok: true, status: 200, body: [{ id: 'project-1' }] } };
    },
  });
  withChrome(t, { runtime });

  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://127.0.0.1:5445/' });
  const sessionLaunch = require('../src/contentScript/sessionLaunch.js');

  const initialImages = [{ name: 'screen.png', media_type: 'image/png', data_base64: 'abc' }];
  assert.deepEqual(
    await client.createSession('', { source: 'adapter-chrome' }, {
      task: 'Initial prompt',
      images: initialImages,
      agent: sessionLaunch.createBuiltInHostAgent(),
      provider: 'openai_codex',
      model: 'gpt-5.5',
    }),
    { id: 'session-1' },
  );
  assert.deepEqual(await client.listProjects(), [{ id: 'project-1' }]);
  assert.deepEqual(await client.listProviders(), [{ type: 'cursor', is_active: true }]);
  assert.deepEqual(await client.listProviderModels({ type: 'cursor', model: 'composer-2' }), ['composer-2']);
  assert.deepEqual(await client.listUnifiedAgents(), [{ id: 'reviewer', runtime: 'docker' }]);

  assert.equal(messages[0].path, '/sessions');
  assert.equal(messages[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(messages[0].options.body), {
    agent_id: 'build',
    provider: 'openai_codex',
    model: 'gpt-5.5',
    task: 'Initial prompt',
    images: initialImages,
    queued: true,
    queue_mode: 'serial',
    metadata: {
      source: 'adapter-chrome',
      launch_target: 'agent',
      launch_agent_id: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
      launch_agent_name: 'Built-in agent on host',
      launch_agent_runtime: 'host',
    },
  });
  assert.equal(messages[1].path, '/projects');
  assert.equal(messages[2].path, '/providers');
  assert.equal(messages[3].path, '/providers/cursor/models');
  assert.equal(messages[4].path, '/unified-agents/');
});

test('createSession launches docker agents without provider/model fields', async (t) => {
  const { runtime, messages } = createRuntimeMock({
    sendResponse() {
      return { ok: true, response: { ok: true, status: 200, body: { id: 'session-1' } } };
    },
  });
  withChrome(t, { runtime });

  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://127.0.0.1:5445/' });
  assert.deepEqual(
    await client.createSession('project-1', { source: 'adapter-chrome' }, {
      task: 'Initial prompt',
      agent: { id: 'reviewer', name: 'Reviewer', runtime: 'docker', definition: { id: 'reviewer' } },
      provider: 'cursor',
      model: 'composer-2',
    }),
    { id: 'session-1' },
  );

  assert.deepEqual(JSON.parse(messages[0].options.body), {
    agent_id: 'build',
    project_id: 'project-1',
    unified_agent_id: 'reviewer',
    task: 'Initial prompt',
    queued: true,
    queue_mode: 'serial',
    metadata: {
      source: 'adapter-chrome',
      launch_target: 'agent',
      launch_agent_id: 'reviewer',
      launch_agent_name: 'Reviewer',
      launch_agent_runtime: 'docker',
    },
  });
});

test('createSession omits blank tasks but preserves images for queued creation', async (t) => {
  const { runtime, messages } = createRuntimeMock({
    sendResponse() {
      return { ok: true, response: { ok: true, status: 200, body: { id: 'session-1' } } };
    },
  });
  withChrome(t, { runtime });

  const client = caesarApi.createApiClient({ getBaseUrl: () => 'http://127.0.0.1:5445/' });
  const images = [{ name: 'screen.png', media_type: 'image/png', data_base64: 'abc' }];

  const sessionLaunch = require('../src/contentScript/sessionLaunch.js');
  await client.createSession('project-1', { source: 'adapter-chrome' }, {
    task: '   ',
    images,
    agent: sessionLaunch.createBuiltInHostAgent(),
  });

  assert.deepEqual(JSON.parse(messages[0].options.body), {
    agent_id: 'build',
    project_id: 'project-1',
    images,
    queued: true,
    queue_mode: 'serial',
    metadata: {
      source: 'adapter-chrome',
      launch_target: 'agent',
      launch_agent_id: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
      launch_agent_name: 'Built-in agent on host',
      launch_agent_runtime: 'host',
    },
  });
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

test('subscribeSessionEvents opens a live SSE port and emits parsed session events', async (t) => {
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
  const subscription = client.subscribeSessionEvents('session/with space', {
    onEvent(event) {
      events.push(event);
    },
  });
  await Promise.resolve();

  assert.deepEqual(portMock.postedMessages, [{
    type: 'A2GENT_BRUTE_STREAM_START',
    requestId: '1234567890-8',
    baseUrl: 'http://localhost:5445',
    path: '/sessions/session%2Fwith%20space/events',
    options: {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
    },
  }]);

  portMock.emitMessage({
    requestId: '1234567890-8',
    type: 'A2GENT_BRUTE_STREAM_CHUNK',
    chunk: ':heartbeat\n\nevent: session_snapshot\ndata: {"type":"session_snapshot","status":"queued","messages":[]}\n\n',
  });
  portMock.emitMessage({
    requestId: '1234567890-8',
    type: 'A2GENT_BRUTE_STREAM_CHUNK',
    chunk: 'event: assistant_delta\ndata: {"type":"assistant_delta","delta":"Hi"}\n\n',
  });

  assert.deepEqual(events, [
    { type: 'session_snapshot', status: 'queued', messages: [] },
    { type: 'assistant_delta', delta: 'Hi' },
  ]);

  subscription.stop();
  assert.equal(portMock.disconnectCount, 1);
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
