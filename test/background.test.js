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
    updatedTabs: [],
    removedTabs: [],
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
          return overrides.createTab(details, callback, runtime);
        }
        if (callback) callback();
        else return Promise.resolve({ id: 42, windowId: 7 });
      },
      async remove(tabId) {
        calls.removedTabs.push(tabId);
        if (overrides.removeTab) return overrides.removeTab(tabId);
      },
      async update(tabId, details) {
        calls.updatedTabs.push({ tabId, details });
        if (overrides.updateTab) return overrides.updateTab(tabId, details);
        return { id: tabId, windowId: 7 };
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
    setInterval,
    clearInterval,
    WebSocket: overrides.WebSocket,
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
  assert.deepEqual(toPlain(background.calls.createdTabs), [{ url: 'https://my.a2gent.net/chat/session%2Fwith%20spaces' }]);
});

test('background allows toggling the overlay on local file pages', async () => {
  const background = loadBackground({ storageValues: { 'a2gent.adapterChrome.mode': 'design' } });

  await background.onActionClick({ id: 123, url: 'file:///tmp/local-design.html' });

  assert.deepEqual(toPlain(background.calls.sendMessages), [{
    tabId: 123,
    message: { type: 'A2GENT_TOGGLE_OVERLAY' },
  }]);
});

test('background injects content scripts when action toggle misses the tab', async () => {
  const background = loadBackground({
    storageValues: { 'a2gent.adapterChrome.mode': 'design' },
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

test('background multiplexes browser-control tabs over one Brute WebSocket', async () => {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.closed = true;
    }
  }
  const background = loadBackground({ WebSocket: FakeWebSocket });

  const makePort = () => {
    const port = {
      name: 'A2GENT_BROWSER_CONTROL',
      posted: [],
      onMessage: { addListener(listener) { port.onMessageListener = listener; } },
      onDisconnect: { addListener(listener) { port.onDisconnectListener = listener; } },
      postMessage(payload) { port.posted.push(payload); },
    };
    background.onConnect(port);
    return port;
  };
  const first = makePort();
  const second = makePort();
  first.onMessageListener({ type: 'register', page_id: 'page-a', page: { title: 'A' } });
  second.onMessageListener({ type: 'register', page_id: 'page-b', page: { title: 'B' } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sockets.length, 1, 'all tabs share one socket');
  const socket = sockets[0];
  assert.equal(socket.url, 'ws://localhost:5445/browser-extension/ws');
  socket.readyState = FakeWebSocket.OPEN;
  socket.onopen();
  assert.deepEqual(socket.sent.map((message) => message.page_id), ['page-a', 'page-b']);

  socket.onmessage({ data: JSON.stringify({ type: 'command', page_id: 'page-b', command: { id: 'c1', action: 'get_text' } }) });
  assert.equal(first.posted.length, 0);
  assert.equal(second.posted[0].command.id, 'c1');

  first.onDisconnectListener();
  assert.deepEqual(toPlain(socket.sent.at(-1)), { type: 'unregister', page_id: 'page-a' });
  second.onDisconnectListener();
  assert.equal(socket.closed, true, 'socket closes when no tabs remain');
});

const setupTabControl = async (overrides = {}) => {
  let socket;
  class FakeWebSocket {
    static OPEN = 1;
    constructor() {
      socket = this;
      this.readyState = 1;
      this.sent = [];
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
  }
  const background = loadBackground({ ...overrides, WebSocket: FakeWebSocket });
  const port = {
    name: 'A2GENT_BROWSER_CONTROL',
    sender: { tab: { id: 17, windowId: 7 } },
    posted: [],
    onMessage: { addListener(fn) { port.register = fn; } },
    onDisconnect: { addListener(fn) { port.disconnect = fn; } },
    postMessage(message) { port.posted.push(message); },
  };
  background.onConnect(port);
  port.register({ type: 'register', page_id: 'page-1' });
  await new Promise(setImmediate);
  socket.onopen();
  return {
    ...background, port, socket,
    command(action, url) {
      socket.onmessage({ data: JSON.stringify({
        type: 'command', page_id: 'page-1', command: { id: 'tab-cmd', action, params: { url } },
      }) });
    },
    cleanup() { port.disconnect(); },
  };
};

test('open_tab uses Chrome tabs API without page eval or popup windows', async (t) => {
  const control = await setupTabControl();
  t.after(() => control.cleanup());
  control.command('open_tab', 'https://www.linkedin.com/messaging/');
  await new Promise(setImmediate);
  assert.deepEqual(toPlain(control.calls.createdTabs), [{ url: 'https://www.linkedin.com/messaging/', active: true }]);
  assert.equal(control.port.posted.length, 0);
  assert.equal(control.calls.executeScripts.length, 0);
  assert.equal(control.calls.fetches[0].url, 'http://localhost:5445/browser-extension/commands/tab-cmd/result');
  assert.deepEqual(JSON.parse(control.calls.fetches[0].init.body), {
    page_id: 'page-1', ok: true,
    result: { tab_id: 42, window_id: 7, url: 'https://www.linkedin.com/messaging/' },
  });
});

test('navigate keeps registration until its result is posted even if source port disconnects', async (t) => {
  let control;
  let acknowledge;
  control = await setupTabControl({
    async updateTab(tabId) {
      control.port.disconnect();
      return { id: tabId, windowId: 7 };
    },
    fetch() {
      return new Promise((resolve) => {
        acknowledge = () => resolve({ ok: true, status: 200, async text() { return '{}'; } });
      });
    },
  });
  t.after(() => control.cleanup());
  control.command('navigate', 'https://example.test/next');
  await new Promise(setImmediate);
  assert.deepEqual(toPlain(control.calls.updatedTabs), [{ tabId: 17, details: { url: 'https://example.test/next' } }]);
  assert.equal(JSON.parse(control.calls.fetches[0].init.body).ok, true);
  assert.equal(control.socket.sent.some((m) => m.type === 'unregister'), false);
  acknowledge();
  await new Promise(setImmediate);
  assert.equal(control.socket.sent.at(-1).type, 'unregister');
  assert.equal(control.socket.readyState, 3);
});

test('close_tab closes the selected tab and returns success after its port disconnects', async (t) => {
  let control;
  let acknowledge;
  control = await setupTabControl({
    removeTab(tabId) {
      control.port.disconnect();
      return Promise.resolve(tabId);
    },
    fetch() {
      return new Promise((resolve) => {
        acknowledge = () => resolve({ ok: true, status: 200, async text() { return '{}'; } });
      });
    },
  });
  t.after(() => control.cleanup());
  control.command('close_tab');
  await new Promise(setImmediate);
  assert.deepEqual(toPlain(control.calls.removedTabs), [17]);
  assert.deepEqual(JSON.parse(control.calls.fetches[0].init.body), {
    page_id: 'page-1', ok: true, result: { tab_id: 17, closed: true },
  });
  assert.equal(control.socket.sent.some((m) => m.type === 'unregister'), false);
  acknowledge();
  await new Promise(setImmediate);
  assert.equal(control.socket.sent.at(-1).type, 'unregister');
  assert.equal(control.socket.readyState, 3);
});

test('close_tab reports Chrome tab removal failures', async (t) => {
  const control = await setupTabControl({ removeTab() { throw new Error('Tab removal denied'); } });
  t.after(() => control.cleanup());
  control.command('close_tab');
  await new Promise(setImmediate);
  const result = JSON.parse(control.calls.fetches.at(-1).init.body);
  assert.equal(result.ok, false);
  assert.ok(result.error.endsWith('Tab removal denied'));
});

test('tab commands reject missing, malformed and unsafe URLs without touching tabs', async (t) => {
  const control = await setupTabControl();
  t.after(() => control.cleanup());
  for (const action of ['open_tab', 'navigate']) {
    for (const url of [undefined, '', '/relative', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'chrome://extensions']) {
      control.command(action, url);
      await new Promise(setImmediate);
      const result = JSON.parse(control.calls.fetches.at(-1).init.body);
      assert.equal(result.ok, false, `${action}: ${url}`);
      assert.ok(result.error);
    }
  }
  assert.equal(control.calls.createdTabs.length, 0);
  assert.equal(control.calls.updatedTabs.length, 0);
});

test('tab API failures are returned as command errors', async (t) => {
  const control = await setupTabControl({
    createTab() { return Promise.reject(new Error('Tab creation denied')); },
    updateTab() { throw new Error('Tab no longer exists'); },
  });
  t.after(() => control.cleanup());
  for (const [action, error] of [['open_tab', 'Tab creation denied'], ['navigate', 'Tab no longer exists']]) {
    control.command(action, 'https://example.test/');
    await new Promise(setImmediate);
    const result = JSON.parse(control.calls.fetches.at(-1).init.body);
    assert.equal(result.page_id, 'page-1');
    assert.equal(result.ok, false);
    assert.ok(result.error.endsWith(error));
  }
});

test('background action click toggles the HearHear player in the default audio mode', async () => {
  const background = loadBackground();

  await background.onActionClick({ id: 123, url: 'https://example.test/article' });

  assert.deepEqual(toPlain(background.calls.sendMessages), [{
    tabId: 123,
    message: { target: 'content', action: 'toggleVisibility' },
  }]);
  assert.equal(background.calls.executeScripts.length, 0);
});

test('background action click toggles the people sync panel in sync mode', async () => {
  const background = loadBackground({ storageValues: { 'a2gent.adapterChrome.mode': 'sync' } });

  await background.onActionClick({ id: 123, url: 'https://www.linkedin.com/in/anna/' });

  assert.deepEqual(toPlain(background.calls.sendMessages), [{
    tabId: 123,
    message: { type: 'A2GENT_PEOPLE_SYNC_TOGGLE' },
  }]);
  assert.equal(background.calls.executeScripts.length, 0);
});
