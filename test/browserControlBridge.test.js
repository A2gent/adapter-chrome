const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src/browserControlBridge.js'), 'utf8');

const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const toPlain = (value) => JSON.parse(JSON.stringify(value));

class TestEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    Object.assign(this, init);
  }

  preventDefault() {
    if (this.cancelable !== false) {
      this.defaultPrevented = true;
    }
  }
}

class TestElement {
  constructor(tagName, options = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    this.id = options.id || '';
    this.className = options.className || '';
    this.classList = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
    this.innerText = options.text || '';
    this.textContent = options.text || '';
    this.value = options.value || '';
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.isContentEditable = Boolean(options.isContentEditable);
    this.attributes = { ...(options.attributes || {}) };
    this.style = { ...(options.style || {}) };
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.dispatchedEvents = [];
    this.listeners = new Map();
    this.rect = {
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      ...(options.rect || {}),
    };
    this.visible = options.visible !== false;
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (Object.prototype.hasOwnProperty.call(this.attributes, name)) {
      return this.attributes[name];
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      left: this.rect.left,
      top: this.rect.top,
      width: this.rect.width,
      height: this.rect.height,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push({
      type: event.type,
      key: event.key,
      code: event.code,
      data: event.data,
      inputType: event.inputType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event);
    }
    return !event.defaultPrevented;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  scrollIntoView() {}

  scrollBy(options = {}) {
    this.scrollLeft += Number(options.left) || 0;
    this.scrollTop += Number(options.top) || 0;
  }

  animate(frames, options) {
    this.lastAnimation = { frames, options };
  }
}

const createDocumentMock = () => {
  const document = {
    title: 'Bridge Test Page',
    visibilityState: 'visible',
    activeElement: null,
    documentElement: null,
    body: null,
    createElement(tagName) {
      const element = new TestElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    getElementById(id) {
      return walk(document.documentElement).find((element) => element.id === id) || null;
    },
    querySelector(selector) {
      return walk(document.documentElement).find((element) => selectorForMock(element) === selector) || null;
    },
    querySelectorAll() {
      return document.__interactiveElements.slice();
    },
    elementFromPoint(x, y) {
      return document.__interactiveElements.find((element) => {
        const rect = element.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) || document.body;
    },
  };

  const root = new TestElement('html');
  const body = new TestElement('body', { text: 'Visible body text for the bridge.' });
  root.ownerDocument = document;
  body.ownerDocument = document;
  root.appendChild(body);
  root.outerHTML = '<html><body><button id="save">Save</button><input id="prompt" aria-label="Prompt"><div id="scroller"></div></body></html>';
  root.textContent = 'Fallback document text';

  const button = new TestElement('button', {
    id: 'save',
    text: 'Save',
    rect: { left: 20, top: 30, width: 100, height: 30 },
  });
  const input = new TestElement('input', {
    id: 'prompt',
    attributes: { 'aria-label': 'Prompt', type: 'text' },
    rect: { left: 20, top: 80, width: 220, height: 28 },
  });
  const scroller = new TestElement('div', {
    id: 'scroller',
    attributes: { tabindex: '0' },
    rect: { left: 10, top: 220, width: 300, height: 120 },
  });
  const hidden = new TestElement('button', {
    id: 'hidden',
    text: 'Hidden',
    visible: false,
    rect: { left: 0, top: 0, width: 0, height: 0 },
  });
  for (const element of [button, input, scroller, hidden]) {
    element.ownerDocument = document;
    body.appendChild(element);
  }

  document.documentElement = root;
  document.body = body;
  document.activeElement = body;
  document.__interactiveElements = [button, input, scroller, hidden];
  document.__elements = { button, input, scroller, hidden };
  return document;
};

const walk = (root) => {
  if (!root) return [];
  return [root, ...root.children.flatMap((child) => walk(child))];
};

const selectorForMock = (element) => (element.id ? `#${element.id}` : element.localName);

const proxiedResponse = (body, status = 200) => ({
  ok: true,
  response: {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    body,
    bodyText: JSON.stringify(body),
  },
});

const loadBridge = ({ commands = [], diagnosticsPayload } = {}) => {
  const document = createDocumentMock();
  const listeners = new Map();
  const runtimeMessages = [];
  const resultPosts = [];
  const waiters = [];
  const storageValues = {};
  let timerId = 0;

  const maybeResolveWaiters = () => {
    for (const waiter of waiters.slice()) {
      if (resultPosts.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(resultPosts);
      }
    }
  };

  const waitForResults = (count) => {
    if (resultPosts.length >= count) return Promise.resolve(resultPosts);
    return new Promise((resolve) => waiters.push({ count, resolve }));
  };

  const window = {
    __A2GENT_BROWSER_CONTROL_BRIDGE__: false,
    innerWidth: 640,
    innerHeight: 480,
    devicePixelRatio: 2,
    scrollX: 12,
    scrollY: 34,
    sessionStorage: new Map(),
    getSelection: () => ({ toString: () => '  selected text  ' }),
    setTimeout(callback, ms) {
      const id = ++timerId;
      if (Number(ms) <= 100) {
        queueMicrotask(callback);
      }
      return id;
    },
    clearTimeout() {},
    setInterval() {
      return ++timerId;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    postMessage(message) {
      const listener = listeners.get('message');
      if (!listener) return;
      if (message.type === 'A2GENT_PAGE_EVAL') {
        queueMicrotask(() => listener({
          source: window,
          data: {
            type: 'A2GENT_PAGE_EVAL_RESULT',
            requestId: message.requestId,
            ok: true,
            result: { evaluated: message.script },
          },
        }));
      }
      if (message.type === 'A2GENT_GET_PAGE_DIAGNOSTICS') {
        queueMicrotask(() => listener({
          source: window,
          data: {
            type: 'A2GENT_PAGE_DIAGNOSTICS',
            requestId: message.requestId,
            payload: diagnosticsPayload || {
              console_logs: [{ level: 'info', message: 'ready' }],
              page_errors: [{ message: 'boom' }],
              network_activity: [{ endpoint: 'https://api.example.test/items', status: 200 }],
            },
          },
        }));
      }
    },
    scrollBy(options = {}) {
      window.scrollX += Number(options.left) || 0;
      window.scrollY += Number(options.top) || 0;
    },
    getComputedStyle(element) {
      return {
        visibility: element.visible ? 'visible' : 'hidden',
        display: element.visible ? 'block' : 'none',
        opacity: element.visible ? '1' : '0',
      };
    },
  };
  window.sessionStorage.getItem = window.sessionStorage.get.bind(window.sessionStorage);
  window.sessionStorage.setItem = window.sessionStorage.set.bind(window.sessionStorage);

  const chrome = {
    runtime: {
      lastError: null,
      getURL: (assetPath) => `chrome-extension://a2gent/${assetPath}`,
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (typeof callback === 'function') {
          if (message.type === 'A2GENT_BRUTE_API_FETCH') {
            const { path: apiPath, options = {} } = message;
            if (apiPath === '/browser-extension/pages/register') {
              queueMicrotask(() => callback(proxiedResponse({ registered: true })));
              return undefined;
            }
            if (/\/browser-extension\/pages\/[^/]+\/poll/.test(apiPath)) {
              if (commands.length === 0) {
                return undefined;
              }
              const command = commands.shift();
              queueMicrotask(() => callback(proxiedResponse({ command })));
              return undefined;
            }
            const resultMatch = apiPath.match(/\/browser-extension\/commands\/([^/]+)\/result/);
            if (resultMatch) {
              resultPosts.push({
                commandId: decodeURIComponent(resultMatch[1]),
                payload: JSON.parse(options.body),
              });
              maybeResolveWaiters();
              queueMicrotask(() => callback(proxiedResponse({ accepted: true })));
              return undefined;
            }
          }
          queueMicrotask(() => callback({ ok: false, error: `Unexpected message: ${message.type}` }));
          return undefined;
        }
        if (message.type === 'A2GENT_CAPTURE_VISIBLE_TAB') {
          return Promise.resolve({ ok: true, dataUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==' });
        }
        return Promise.resolve({ ok: false, error: `Unexpected promise message: ${message.type}` });
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) result[key] = storageValues[key];
          callback(result);
        },
      },
    },
  };

  const context = vm.createContext({
    window,
    document,
    location: { href: 'https://example.test/app?debug=1#hash' },
    navigator: { userAgent: 'Unit Test Browser/1.0' },
    chrome,
    URL,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Promise,
    Error,
    console,
    queueMicrotask,
    Node: { ELEMENT_NODE: 1 },
    CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    Event: TestEvent,
    InputEvent: TestEvent,
    KeyboardEvent: TestEvent,
    MouseEvent: TestEvent,
  });

  new vm.Script(bridgeSource, { filename: path.join(repoRoot, 'src/browserControlBridge.js') }).runInContext(context);
  return { document, runtimeMessages, resultPosts, waitForResults };
};

test('browser control bridge exposes required agent command actions', () => {
  const bridge = readFile('src/browserControlBridge.js');

  for (const action of [
    'eval',
    'get_text',
    'read_content',
    'get_interactive_elements',
    'type',
    'press_key',
    'click',
    'click_at',
    'move_mouse',
    'scroll',
    'get_console_logs',
    'get_network_logs',
    'get_diagnostics',
    'screenshot',
  ]) {
    assert.match(bridge, new RegExp(`case ['"]${action}['"]`), `${action} must be handled by the content bridge`);
  }

  assert.match(bridge, /a2gent-browser-adapter-ai-cursor/, 'bridge should render a visible virtual AI cursor');
  assert.match(bridge, /CURSOR_IMAGE_PATH = 'cursor\.png'/, 'virtual cursor should use the bundled cursor asset');
  assert.match(bridge, /CURSOR_WIDTH_PX = 24/, 'virtual cursor should render near normal pointer size');
  assert.doesNotMatch(bridge, /border-radius:999px/, 'virtual cursor should not fall back to the old circular marker');
});

test('browser control bridge executes polled commands and posts structured results', async () => {
  const commands = [
    { id: 'text', action: 'get_text' },
    { id: 'content', action: 'read_content' },
    { id: 'interactive', action: 'get_interactive_elements', params: { page: 1, page_size: 2 } },
    { id: 'type', action: 'type', params: { selector: '#prompt', text: 'hello bridge' } },
    { id: 'press', action: 'press_key', params: { key: 'Enter' } },
    { id: 'click', action: 'click', params: { selector: '#save' } },
    { id: 'move', action: 'move_mouse', params: { x: 9999, y: -5 } },
    { id: 'scroll-element', action: 'scroll', params: { selector: '#scroller', x: 5, y: 25 } },
    { id: 'console', action: 'get_console_logs', params: { detail_level: 'full' } },
    { id: 'network', action: 'get_network_logs', params: { detail_level: 'full' } },
    { id: 'diagnostics', action: 'get_diagnostics', params: { detail_level: 'compact' } },
    { id: 'screenshot', action: 'screenshot' },
    { id: 'eval', action: 'eval', params: { script: '1 + 1' } },
  ];
  const { document, runtimeMessages, waitForResults } = loadBridge({ commands: commands.slice() });

  const results = await waitForResults(commands.length);
  const byId = Object.fromEntries(results.map((result) => [result.commandId, toPlain(result.payload)]));

  assert.equal(runtimeMessages[0].type, 'A2GENT_BRUTE_API_FETCH');
  assert.equal(runtimeMessages[0].path, '/browser-extension/pages/register');

  assert.equal(byId.text.ok, true);
  assert.equal(byId.text.result.text, 'Visible body text for the bridge.');
  assert.equal(byId.text.result.page.title, 'Bridge Test Page');

  assert.equal(byId.content.result.html, document.documentElement.outerHTML);

  assert.deepEqual(byId.interactive.result, {
    page: 1,
    page_size: 2,
    total: 3,
    items: [
      {
        selector: '#save',
        tag: 'button',
        text: 'Save',
        role: '',
        aria_label: '',
        type: '',
        disabled: false,
        typeable: false,
        viewport: { x: 20, y: 30, width: 100, height: 30, center_x: 70, center_y: 45 },
      },
      {
        selector: '#prompt',
        tag: 'input',
        text: 'Prompt',
        role: '',
        aria_label: 'Prompt',
        type: 'text',
        disabled: false,
        typeable: true,
        viewport: { x: 20, y: 80, width: 220, height: 28, center_x: 130, center_y: 94 },
      },
    ],
  });

  assert.deepEqual(byId.type.result, { selector: '#prompt', text_length: 'hello bridge'.length });
  assert.equal(document.__elements.input.value, 'hello bridge');
  assert.deepEqual(document.__elements.input.dispatchedEvents.slice(0, 2).map((event) => event.type), ['input', 'change']);

  assert.deepEqual(byId.press.result, { key: 'Enter', target: '#prompt', value: 'hello bridge' });
  assert.deepEqual(document.__elements.input.dispatchedEvents.slice(2, 4).map((event) => event.type), ['keydown', 'keyup']);

  assert.equal(byId.click.result.target, '#save');
  assert.equal(byId.click.result.text, 'Save');
  assert.deepEqual(document.__elements.button.dispatchedEvents.map((event) => event.type), ['mousemove', 'mousedown', 'mouseup', 'click']);

  assert.deepEqual(byId.move.result, { x: 640, y: 0 });
  const cursor = document.getElementById('a2gent-browser-adapter-ai-cursor');
  assert.equal(cursor.style.backgroundImage, 'url("chrome-extension://a2gent/cursor.png")');

  assert.deepEqual(byId['scroll-element'].result, {
    selector: '#scroller',
    scroll_left: 5,
    scroll_top: 25,
    viewport: { x: 10, y: 220 },
  });

  assert.deepEqual(byId.console.result, {
    console_logs: [{ level: 'info', message: 'ready' }],
    page_errors: [{ message: 'boom' }],
  });
  assert.deepEqual(byId.network.result, {
    network_activity: [{ endpoint: 'https://api.example.test/items', status: 200 }],
  });
  assert.equal(byId.diagnostics.result.schema, 'a2gent.browser.control_diagnostic.v1');
  assert.equal(byId.diagnostics.result.selected_text, 'selected text');
  assert.equal(byId.diagnostics.result.dom_snapshot.active_element.selector, '#prompt');
  assert.deepEqual(byId.screenshot.result, {
    data_url: 'data:image/png;base64,c2NyZWVuc2hvdA==',
    media_type: 'image/png',
  });
  assert.deepEqual(byId.eval.result, { value: { evaluated: '1 + 1' } });
});

test('press_key applies native text-editing defaults to focused input controls', async () => {
  const commands = [
    { id: 'type', action: 'type', params: { selector: '#prompt', text: 'whitepaper = pdf icon or?' } },
    { id: 'backspace', action: 'press_key', params: { key: 'Backspace' } },
    { id: 'delete', action: 'press_key', params: { key: 'Delete' } },
    { id: 'enter', action: 'press_key', params: { key: 'Enter' } },
  ];
  const { document, waitForResults } = loadBridge({ commands: commands.slice() });

  const results = await waitForResults(commands.length);
  const byId = Object.fromEntries(results.map((result) => [result.commandId, toPlain(result.payload)]));
  const input = document.__elements.input;

  assert.equal(byId.backspace.result.value, 'whitepaper = pdf icon or');
  assert.equal(byId.delete.result.value, 'whitepaper = pdf icon or');
  assert.equal(byId.enter.result.value, 'whitepaper = pdf icon or');
  assert.equal(input.value, 'whitepaper = pdf icon or');
  assert.deepEqual(
    input.dispatchedEvents.slice(2).map((event) => event.type),
    ['keydown', 'beforeinput', 'input', 'keyup', 'keydown', 'keyup', 'keydown', 'keyup'],
  );
  assert.deepEqual(
    input.dispatchedEvents.slice(2).map((event) => event.inputType || ''),
    ['', 'deleteContentBackward', 'deleteContentBackward', '', '', '', '', ''],
  );
});

test('press_key respects cancelled beforeinput events', async () => {
  const commands = [
    { id: 'type', action: 'type', params: { selector: '#prompt', text: 'locked text' } },
    { id: 'backspace', action: 'press_key', params: { key: 'Backspace' } },
  ];
  const { document, waitForResults } = loadBridge({ commands: commands.slice() });
  document.__elements.input.addEventListener('beforeinput', (event) => event.preventDefault());

  const results = await waitForResults(commands.length);
  const byId = Object.fromEntries(results.map((result) => [result.commandId, toPlain(result.payload)]));

  assert.equal(byId.backspace.result.value, 'locked text');
  assert.equal(document.__elements.input.value, 'locked text');
  assert.deepEqual(
    document.__elements.input.dispatchedEvents.slice(2).map((event) => event.type),
    ['keydown', 'beforeinput', 'keyup'],
  );
});

test('browser control bridge posts command errors without stopping polling', async () => {
  const commands = [
    { id: 'missing', action: 'type', params: { selector: '#does-not-exist', text: 'ignored' } },
    { id: 'next', action: 'get_text' },
  ];
  const { waitForResults } = loadBridge({ commands: commands.slice() });

  const results = await waitForResults(commands.length);
  const byId = Object.fromEntries(results.map((result) => [result.commandId, toPlain(result.payload)]));

  assert.equal(byId.missing.ok, false);
  assert.match(byId.missing.error, /element not found: #does-not-exist/);
  assert.equal(byId.next.ok, true);
  assert.equal(byId.next.result.text, 'Visible body text for the bridge.');
});

test('page hook can return full logs on demand without changing compact defaults', () => {
  const pageHook = readFile('src/pageHook.js');

  assert.match(pageHook, /A2GENT_GET_PAGE_DIAGNOSTICS/);
  assert.match(pageHook, /detailLevel\s*=\s*event\.data\.detailLevel/);
  assert.match(pageHook, /network_activity:\s*includeFull \? fullNetwork\(\) : latestNetwork\(\)/);
  assert.match(pageHook, /console_logs:\s*includeFull \? logs\.slice\(\) : latestLogs\(\)/);
});
