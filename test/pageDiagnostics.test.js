const test = require('node:test');
const assert = require('node:assert/strict');

const pageDiagnostics = require('../src/contentScript/pageDiagnostics.js');
const shared = require('../src/contentScript/shared.js');

const restoreGlobal = (t, name, value) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(global, name);
  Object.defineProperty(global, name, {
    value,
    configurable: true,
    writable: true,
  });
  t.after(() => {
    if (previousDescriptor) {
      Object.defineProperty(global, name, previousDescriptor);
    } else {
      delete global[name];
    }
  });
};

const createDocumentMock = () => {
  const removedSelectors = [];
  const clone = {
    outerHTML: '<html><body><main>Visible page</main></body></html>',
    querySelector(selector) {
      return {
        remove() {
          removedSelectors.push(selector);
        },
      };
    },
  };

  return {
    removedSelectors,
    document: {
      title: 'Example page',
      referrer: 'https://referrer.example/',
      visibilityState: 'visible',
      documentElement: {
        cloneNode(deep) {
          assert.equal(deep, true);
          return clone;
        },
        textContent: 'Fallback document text',
      },
      body: {
        innerText: 'Visible body text',
      },
      activeElement: {
        tagName: 'BUTTON',
        id: 'submit-button',
        className: 'primary cta',
        getAttribute(name) {
          return name === 'aria-label' ? 'Submit prompt' : null;
        },
      },
    },
  };
};

const installBrowserGlobals = (t, { pageDiagnosticsPayload } = {}) => {
  const listeners = new Map();
  const postedMessages = [];
  const sentMessages = [];
  const animationFrames = [];
  const { document, removedSelectors } = createDocumentMock();

  const windowMock = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    scrollX: 12,
    scrollY: 34,
    getSelection: () => ({ toString: () => '  selected browser text  ' }),
    setTimeout: () => ({ timeout: true }),
    clearTimeout: () => {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
    postMessage(message) {
      postedMessages.push(message);
      const listener = listeners.get('message');
      if (!listener || message.type !== 'A2GENT_GET_PAGE_DIAGNOSTICS') return;
      listener({
        source: windowMock,
        data: {
          type: 'A2GENT_PAGE_DIAGNOSTICS',
          requestId: message.requestId,
          payload: pageDiagnosticsPayload || { console_logs: [], page_errors: [], network_activity: [] },
        },
      });
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      callback();
    },
  };

  const locationMock = {
    href: 'https://example.test/app?token=secret#debug',
  };
  const navigatorMock = {
    userAgent: 'Unit Test Browser/1.0',
  };
  const chromeMock = {
    runtime: {
      async sendMessage(message) {
        sentMessages.push(message);
        return { ok: true, dataUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==' };
      },
    },
  };

  restoreGlobal(t, 'window', windowMock);
  restoreGlobal(t, 'document', document);
  restoreGlobal(t, 'location', locationMock);
  restoreGlobal(t, 'navigator', navigatorMock);
  restoreGlobal(t, 'chrome', chromeMock);

  return { animationFrames, postedMessages, removedSelectors, sentMessages };
};

test('collectDomSnapshot removes extension chrome and captures bounded page context', (t) => {
  const { removedSelectors } = installBrowserGlobals(t);

  const snapshot = pageDiagnostics.collectDomSnapshot();

  assert.deepEqual(removedSelectors, [
    '#a2gent-browser-adapter-root',
    `#${shared.DRAWING_ROOT_ID}`,
  ]);
  assert.deepEqual(snapshot, {
    html: '<html><body><main>Visible page</main></body></html>',
    text: 'Visible body text',
    active_element: {
      tag: 'BUTTON',
      id: 'submit-button',
      class_name: 'primary cta',
      aria_label: 'Submit prompt',
    },
  });
});

test('captureScreenshot hides only the adapter panel while Chrome captures the visible tab', async (t) => {
  const { animationFrames, sentMessages } = installBrowserGlobals(t);
  const host = { style: { visibility: 'visible' } };

  const screenshot = await pageDiagnostics.captureScreenshot({ host, isOverlayOpen: true });

  assert.equal(screenshot, 'data:image/png;base64,c2NyZWVuc2hvdA==');
  assert.equal(host.style.visibility, 'visible');
  assert.equal(animationFrames.length, 2);
  assert.deepEqual(sentMessages, [{ type: 'A2GENT_CAPTURE_VISIBLE_TAB' }]);
});

test('collectFullDiagnostics builds a privacy-preserving diagnostic bundle', async (t) => {
  const { sentMessages } = installBrowserGlobals(t, {
    pageDiagnosticsPayload: {
      console_logs: [{ captured_at: '2026-01-01T00:00:00.000Z', level: 'info', args: ['ready'] }],
      page_errors: [{ message: 'boom' }],
      network_activity: [{
        method: 'POST',
        url: 'https://api.example.test/items?access_token=secret#debug',
        status: 201,
        ok: true,
        content_type: 'application/json',
        duration_ms: 12.4,
        captured_at: '2026-01-01T00:00:01.000Z',
        request_headers: { authorization: 'Bearer secret' },
        response_body_preview: '{"secret":true}',
      }],
    },
  });
  let drawingInputDisabled = false;
  const host = { style: { visibility: '' } };

  const result = await pageDiagnostics.collectFullDiagnostics({
    userPrompt: 'Please inspect this page.',
    reason: 'initial',
    disableDrawingInput: () => {
      drawingInputDisabled = true;
    },
    getDrawingSummary: () => ({ strokes: 1, bounds: { x: 10, y: 20, width: 30, height: 40 } }),
    host,
    isOverlayOpen: true,
  });

  assert.equal(drawingInputDisabled, true);
  assert.equal(result.screenshotDataUrl, 'data:image/png;base64,c2NyZWVuc2hvdA==');
  assert.deepEqual(sentMessages, [{ type: 'A2GENT_CAPTURE_VISIBLE_TAB' }]);
  assert.equal(host.style.visibility, '');

  assert.equal(result.payload.schema, 'a2gent.browser.diagnostic.v1');
  assert.equal(result.payload.source, shared.SOURCE);
  assert.equal(result.payload.extension_version, shared.EXTENSION_VERSION);
  assert.equal(result.payload.diagnostic_bundle_type, 'initial');
  assert.equal(Object.prototype.hasOwnProperty.call(result.payload, 'user_prompt'), false);
  assert.deepEqual(result.payload.focus_annotation, { strokes: 1, bounds: { x: 10, y: 20, width: 30, height: 40 } });
  assert.equal(result.payload.selected_text, 'selected browser text');
  assert.deepEqual(result.payload.page, {
    url: 'https://example.test/app?token=secret#debug',
    title: 'Example page',
    referrer: 'https://referrer.example/',
    visibility_state: 'visible',
    viewport: {
      width: 1280,
      height: 720,
      device_pixel_ratio: 2,
      scroll_x: 12,
      scroll_y: 34,
    },
    user_agent: 'Unit Test Browser/1.0',
  });
  assert.deepEqual(result.payload.console_logs, [{ captured_at: '2026-01-01T00:00:00.000Z', level: 'info', message: 'ready' }]);
  assert.deepEqual(result.payload.page_errors, [{ message: 'boom' }]);
  assert.deepEqual(result.payload.network_activity, [{
    method: 'POST',
    endpoint: 'https://api.example.test/items',
    status: 201,
    ok: true,
    content_type: 'application/json',
    duration_ms: 12,
    captured_at: '2026-01-01T00:00:01.000Z',
  }]);
  assert.match(result.payload.exclusions.cookies, /does not read document\.cookie/);
  assert.match(result.payload.exclusions.browser_storage, /does not read localStorage/);
  assert.match(result.payload.exclusions.network_details, /URL query strings/);
});

test('message helpers append labeled JSON payloads and strip screenshot data-url prefixes', () => {
  const diagnosticPayload = { schema: 'a2gent.browser.diagnostic.v1', ok: true };
  const lightweightPayload = { schema: 'a2gent.browser.lightweight_context.v1', page: { url: 'https://example.test/' } };

  assert.deepEqual(pageDiagnostics.imageFromScreenshot('data:image/png;base64,aW1hZ2U=', 'capture.png'), {
    name: 'capture.png',
    media_type: 'image/png',
    data_base64: 'aW1hZ2U=',
  });
  assert.match(
    pageDiagnostics.createInitialMessage('Initial prompt', diagnosticPayload),
    /^Initial prompt\n\n```json a2gent_browser_diagnostic\n[\s\S]*"ok": true[\s\S]*```$/,
  );
  assert.match(
    pageDiagnostics.createFollowupMessage('Follow up', lightweightPayload),
    /^Follow up\n\n```json a2gent_browser_context\n[\s\S]*"schema": "a2gent\.browser\.lightweight_context\.v1"[\s\S]*```$/,
  );
  assert.match(
    pageDiagnostics.createRecaptureMessage(diagnosticPayload),
    /^Manual full browser diagnostic recapture from the Chrome extension\.\n\n```json a2gent_browser_diagnostic/,
  );
});
