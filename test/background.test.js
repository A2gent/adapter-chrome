const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ReadableStream } = require('node:stream/web');

const repoRoot = path.resolve(__dirname, '..');
const backgroundPath = path.join(repoRoot, 'src/background.js');
const backgroundSource = fs.readFileSync(backgroundPath, 'utf8');
// WHY: vm-created objects have a different prototype than objects in the test runner realm.
// WHAT: round-trip simple payloads before strict deep equality assertions.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

// WHY: background.js is a Manifest V3 service worker registered by Chrome, not a Node module.
// WHAT: run it in a fresh VM with a small Chrome API mock, then drive the registered listeners.
const loadBackground = (overrides = {}) => {
  const listeners = {
    actionClicks: [],
    runtimeMessages: [],
    runtimeConnects: [],
  };
  const calls = {
    sendMessages: [],
    executeScripts: [],
    createdTabs: [],
    capturedTabs: [],
    fetches: [],
  };
  const storageValues = { ...(overrides.storageValues || {}) };

  const runtime = {
    lastError: null,
    onConnect: {
      addListener(listener) {
        listeners.runtimeConnects.push(listener);
      },
    },
    onMessage: {
      addListener(listener) {
        listeners.runtimeMessages.push(listener);
      },
    },
  };

  const chrome = {
    action: {
      onClicked: {
        addListener(listener) {
          listeners.actionClicks.push(listener);
        },
      },
    },
    runtime,
    scripting: {
      async executeScript(details) {
        calls.executeScripts.push(details);
        return overrides.executeScriptResult || [];
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) {
            result[key] = storageValues[key];
          }
          callback(result);
        },
        set(payload, callback) {
          Object.assign(storageValues, payload);
          if (callback) callback();
        },
      },
    },
    tabs: {
      async sendMessage(tabId, message) {
        calls.sendMessages.push({ tabId, message });
        if (overrides.sendMessage) {
          return overrides.sendMessage(tabId, message, calls.sendMessages.length);
        }
        return undefined;
      },
      captureVisibleTab(windowId, options, callback) {
        calls.capturedTabs.push({ windowId, options });
        if (overrides.captureVisibleTab) {
          overrides.captureVisibleTab(windowId, options, callback, runtime);
          return;
        }
        callback('data:image/png;base64,c2NyZWVuc2hvdA==');
      },
      create(details, callback) {
        calls.createdTabs.push(details);
        if (overrides.createTab) {
          overrides.createTab(details, callback, runtime);
          return;
        }
        if (callback) callback();
      },
    },
  };

  const fetchImpl = async (url, init) => {
    calls.fetches.push({ url, init });
    if (overrides.fetch) {
      return overrides.fetch(url, init, calls.fetches.length);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return '{}';
      },
    };
  };

  const context = vm.createContext({
    chrome,
    fetch: fetchImpl,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    ReadableStream,
    console,
    setTimeout,
    clearTimeout,
  });

  new vm.Script(backgroundSource, { filename: backgroundPath }).runInContext(context);

  return {
    chrome,
    calls,
    listeners,
    storageValues,
    onMessage: listeners.runtimeMessages[0],
    onConnect: listeners.runtimeConnects[0],
    onActionClick: listeners.actionClicks[0],
  };
};

test('background proxies Brute JSON API requests with safe loopback defaults', async () => {
  const background = loadBackground({
    async fetch() {
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        async text() {
          return '{"id":"session-1"}';
        },
      };
    },
  });

  const responsePromise = new Promise((resolve) => {
    const keepChannelOpen = background.onMessage({
      type: 'A2GENT_BRUTE_API_FETCH',
      path: '/api/sessions',
      options: {
        method: 'POST',
        headers: {
          'X-Test': 42,
        },
        body: '{"prompt":"hello"}',
      },
    }, {}, resolve);

    assert.equal(keepChannelOpen, true);
  });

  assert.deepEqual(toPlain(await responsePromise), {
    ok: true,
    response: {
      ok: true,
      status: 201,
      statusText: 'Created',
      body: { id: 'session-1' },
      bodyText: '{"id":"session-1"}',
    },
  });

  assert.equal(background.calls.fetches.length, 1);
  assert.equal(background.calls.fetches[0].url, 'http://localhost:5445/api/sessions');
  assert.deepEqual(toPlain(background.calls.fetches[0].init), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Test': '42',
    },
    body: '{"prompt":"hello"}',
    credentials: 'omit',
  });
});

test('background rejects unsafe Brute proxy targets before fetch', async () => {
  for (const message of [
    {
      type: 'A2GENT_BRUTE_API_FETCH',
      baseUrl: 'https://example.com:5445',
      path: '/api/sessions',
    },
    {
      type: 'A2GENT_BRUTE_API_FETCH',
      baseUrl: 'http://localhost:5445',
      path: '//evil.test/api/sessions',
    },
  ]) {
    const background = loadBackground();
    const response = await new Promise((resolve) => {
      assert.equal(background.onMessage(message, {}, resolve), true);
    });

    assert.equal(response.ok, false);
    assert.match(response.error, /loopback-only|root-relative/);
    assert.equal(background.calls.fetches.length, 0);
  }
});

test('background handles screenshot, default base URL, and session tab messages', async () => {
  const background = loadBackground();

  const screenshot = await new Promise((resolve) => {
    assert.equal(background.onMessage({ type: 'A2GENT_CAPTURE_VISIBLE_TAB' }, { tab: { windowId: 7 } }, resolve), true);
  });
  assert.deepEqual(toPlain(screenshot), { ok: true, dataUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==' });
  assert.deepEqual(toPlain(background.calls.capturedTabs), [{ windowId: 7, options: { format: 'png' } }]);

  let defaultBaseUrl;
  assert.equal(background.onMessage({ type: 'A2GENT_GET_DEFAULT_BASE_URL' }, {}, (payload) => {
    defaultBaseUrl = payload;
  }), false);
  assert.deepEqual(toPlain(defaultBaseUrl), { ok: true, baseUrl: 'http://localhost:5445' });

  const emptySession = await new Promise((resolve) => {
    assert.equal(background.onMessage({ type: 'A2GENT_OPEN_SESSION_DETAIL', sessionId: '   ' }, {}, resolve), false);
  });
  assert.deepEqual(toPlain(emptySession), { ok: false, error: 'sessionId is required' });

  const openedSession = await new Promise((resolve) => {
    assert.equal(background.onMessage({ type: 'A2GENT_OPEN_SESSION_DETAIL', sessionId: 'session/with spaces' }, {}, resolve), true);
  });
  assert.deepEqual(toPlain(openedSession), { ok: true });
  assert.deepEqual(toPlain(background.calls.createdTabs), [{ url: 'http://localhost:5173/chat/session%2Fwith%20spaces' }]);
});

test('background injects content scripts when action toggle misses the tab', async () => {
  const background = loadBackground({
    async sendMessage(tabId, message, callNumber) {
      assert.deepEqual(toPlain({ tabId, message }), { tabId: 123, message: { type: 'A2GENT_TOGGLE_OVERLAY' } });
      if (callNumber === 1) {
        throw new Error('Receiving end does not exist.');
      }
      return undefined;
    },
  });

  await background.onActionClick({ id: 123, url: 'https://example.test/app' });

  assert.equal(background.calls.sendMessages.length, 2);
  assert.equal(background.calls.executeScripts.length, 2);
  assert.deepEqual(toPlain(background.calls.executeScripts[0]), {
    target: { tabId: 123 },
    files: ['src/pageHook.js'],
    world: 'MAIN',
  });
  assert.ok(
    background.calls.executeScripts[1].files.includes('src/browserControlBridge.js'),
    'fallback injection should include the browser control bridge after the overlay scripts',
  );
});

test('background streams Brute response chunks over extension ports', async () => {
  const responseDone = new Promise((resolve) => {
    const background = loadBackground({
      async fetch() {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello '));
              controller.enqueue(new TextEncoder().encode('world'));
              controller.close();
            },
          }),
        };
      },
    });
    const postedMessages = [];
    const port = {
      name: 'A2GENT_BRUTE_STREAM',
      onDisconnect: {
        addListener(listener) {
          this.listener = listener;
        },
        removeListener(listener) {
          if (this.listener === listener) {
            delete this.listener;
          }
        },
      },
      onMessage: {
        addListener(listener) {
          this.listener = listener;
        },
      },
      postMessage(payload) {
        postedMessages.push(payload);
        if (payload.type === 'A2GENT_BRUTE_STREAM_DONE') {
          resolve({ background, postedMessages });
        }
      },
    };

    background.onConnect(port);
    port.onMessage.listener({
      type: 'A2GENT_BRUTE_STREAM_START',
      requestId: 'request-1',
      path: '/api/stream',
    });
  });

  const { background, postedMessages } = await responseDone;
  assert.equal(background.calls.fetches.length, 1);
  assert.equal(background.calls.fetches[0].url, 'http://localhost:5445/api/stream');
  assert.deepEqual(toPlain(postedMessages), [
    { type: 'A2GENT_BRUTE_STREAM_CHUNK', requestId: 'request-1', chunk: 'hello ' },
    { type: 'A2GENT_BRUTE_STREAM_CHUNK', requestId: 'request-1', chunk: 'world' },
    { type: 'A2GENT_BRUTE_STREAM_DONE', requestId: 'request-1' },
  ]);
});

test('background reports Brute stream request errors over extension ports', async () => {
  const responseDone = new Promise((resolve) => {
    const background = loadBackground({
      async fetch() {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          body: null,
          async text() {
            return '{"error":"upstream unavailable"}';
          },
        };
      },
    });
    const postedMessages = [];
    const port = {
      name: 'A2GENT_BRUTE_STREAM',
      onDisconnect: {
        addListener(listener) {
          this.listener = listener;
        },
        removeListener(listener) {
          if (this.listener === listener) {
            delete this.listener;
          }
        },
      },
      onMessage: {
        addListener(listener) {
          this.listener = listener;
        },
      },
      postMessage(payload) {
        postedMessages.push(payload);
        if (payload.type === 'A2GENT_BRUTE_STREAM_ERROR') {
          resolve({ background, postedMessages });
        }
      },
    };

    background.onConnect(port);
    port.onMessage.listener({
      type: 'A2GENT_BRUTE_STREAM_START',
      requestId: 'request-2',
      path: '/api/stream',
    });
  });

  const { background, postedMessages } = await responseDone;
  assert.equal(background.calls.fetches.length, 1);
  assert.deepEqual(toPlain(postedMessages), [
    { type: 'A2GENT_BRUTE_STREAM_ERROR', requestId: 'request-2', error: 'upstream unavailable' },
  ]);
});
