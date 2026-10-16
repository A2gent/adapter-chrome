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
  const imageOperations = { closed: false };
  restoreGlobal(t, 'createImageBitmap', async (blob) => {
    assert.equal(blob.type, 'image/png');
    assert.equal(await blob.text(), 'screenshot');
    return { width: 2560, height: 1440, close() { imageOperations.closed = true; } };
  });
  restoreGlobal(t, 'OffscreenCanvas', class {
    constructor(width, height) { imageOperations.dimensions = { width, height }; }
    getContext(type, options) {
      assert.equal(type, '2d');
      assert.deepEqual(options, { alpha: false });
      return { drawImage(...args) { imageOperations.drawArgs = args.slice(1); } };
    }
    async convertToBlob(options) {
      imageOperations.encoding = options;
      return new Blob(['screenshot'], { type: options.type });
    }
  });
  restoreGlobal(t, 'FileReader', class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      });
    }
  });

  return { animationFrames, postedMessages, removedSelectors, sentMessages, imageOperations };
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

  assert.equal(screenshot, 'data:image/jpeg;base64,c2NyZWVuc2hvdA==');
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
  assert.equal(result.screenshotDataUrl, 'data:image/jpeg;base64,c2NyZWVuc2hvdA==');
  assert.deepEqual(sentMessages, [{ type: 'A2GENT_CAPTURE_VISIBLE_TAB' }]);
  assert.equal(host.style.visibility, '');

  for (const field of ['schema', 'source', 'extension_version', 'exclusions']) {
    assert.equal(Object.hasOwn(result.payload, field), false);
  }
  assert.equal(result.payload.diagnostic_bundle_type, 'initial');
  assert.equal(Object.prototype.hasOwnProperty.call(result.payload, 'user_prompt'), false);
  assert.deepEqual(result.payload.focus_annotation, { strokes: 1, bounds: { x: 10, y: 20, width: 30, height: 40 } });
  assert.equal(result.payload.selected_text, 'selected browser text');
  assert.deepEqual(result.payload.page, {
    url: 'https://example.test/app?token=secret#debug',
    title: 'Example page',
    referrer: 'https://referrer.example/',
    viewport: {
      width: 1280,
      height: 720,
      device_pixel_ratio: 2,
      scroll_x: 12,
      scroll_y: 34,
    },
  });
  assert.deepEqual(result.payload.console_logs, [{ captured_at: '2026-01-01T00:00:00.000Z', level: 'info', message: 'ready' }]);
  assert.deepEqual(result.payload.page_errors, [{ message: 'boom' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.payload, 'dom_snapshot'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.payload, 'network_activity'), false);

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
    /^Initial prompt\n\n```json a2gent_browser_diagnostic\n[\s\S]*"ok":true[\s\S]*```$/,
  );
  assert.match(
    pageDiagnostics.createFollowupMessage('Follow up', lightweightPayload),
    /^Follow up\n\n```json a2gent_browser_context\n[\s\S]*"schema":"a2gent\.browser\.lightweight_context\.v1"[\s\S]*```$/,
  );
  assert.match(
    pageDiagnostics.createRecaptureMessage(diagnosticPayload),
    /^Manual full browser diagnostic recapture from the Chrome extension\.\n\n```json a2gent_browser_diagnostic/,
  );
});

test('screenshot dimensions remove retina scale, cap either long edge and handle browser zoom', () => {
  const dimensions = pageDiagnostics.screenshotDimensions;
  assert.equal(pageDiagnostics.SCREENSHOT_MAX_LONG_EDGE, 1280);
  assert.deepEqual(dimensions(2000, 1200, 2), { width: 1000, height: 600 });
  assert.deepEqual(dimensions(3272, 1858, 2), { width: 1280, height: 727 });
  assert.deepEqual(dimensions(3826, 2462, 2), { width: 1280, height: 824 });
  assert.deepEqual(dimensions(1800, 3200, 2), { width: 720, height: 1280 });
  assert.deepEqual(dimensions(1920, 1080, 1.5), { width: 1280, height: 720 });
  assert.deepEqual(dimensions(640, 480, 0.8), { width: 800, height: 600 });
  for (const ratio of [0, -1, NaN, Infinity, undefined]) {
    assert.deepEqual(dimensions(640, 480, ratio), { width: 640, height: 480 });
  }
  assert.deepEqual(dimensions(1, 3000, 2), { width: 1, height: 1280 });
});

test('captureScreenshot draws CSS-sized pixels and encodes JPEG at quality 0.8', async (t) => {
  const { imageOperations } = installBrowserGlobals(t);
  restoreGlobal(t, 'fetch', () => { throw new Error('Host CSP blocks fetch'); });
  await pageDiagnostics.captureScreenshot({});
  assert.deepEqual(imageOperations.dimensions, { width: 1280, height: 720 });
  assert.deepEqual(imageOperations.drawArgs, [0, 0, 1280, 720]);
  assert.deepEqual(imageOperations.encoding, { type: 'image/jpeg', quality: 0.8 });
  assert.equal(imageOperations.closed, true);
});

test('captureScreenshot restores the panel and closes the bitmap on encoding failure', async (t) => {
  const { imageOperations } = installBrowserGlobals(t);
  restoreGlobal(t, 'OffscreenCanvas', class {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { throw new Error('Encoding failed'); }
  });
  const host = { style: { visibility: 'visible' } };
  await assert.rejects(pageDiagnostics.captureScreenshot({ host, isOverlayOpen: true }), /Encoding failed/);
  assert.equal(host.style.visibility, 'visible');
  assert.equal(imageOperations.closed, true);
});

test('captureScreenshot restores the panel when Chrome capture fails', async (t) => {
  installBrowserGlobals(t);
  chrome.runtime.sendMessage = async () => ({ ok: false, error: 'Capture failed' });
  const host = { style: { visibility: '' } };
  await assert.rejects(pageDiagnostics.captureScreenshot({ host, isOverlayOpen: true }), /Capture failed/);
  assert.equal(host.style.visibility, '');
});

test('imageFromScreenshot preserves the actual MIME type and matches the filename', () => {
  for (const [type, extension] of [['jpeg', 'jpg'], ['webp', 'webp'], ['png', 'png']]) {
    assert.deepEqual(pageDiagnostics.imageFromScreenshot(`data:image/${type};base64,aW1hZ2U=`, 'capture.png'), {
      name: `capture.${extension}`,
      media_type: `image/${type}`,
      data_base64: 'aW1hZ2U=',
    });
  }
  assert.throws(() => pageDiagnostics.imageFromScreenshot('not an image', 'capture.png'), /Invalid screenshot/);
});


test('initial diagnostics omit defaults and compact annotation references without mutating them', async (t) => {
  installBrowserGlobals(t, { pageDiagnosticsPayload: {
    console_logs: [{ captured_at: '2026-01-01T00:00:00.000Z', level: 'info', message: 'Application ready' }],
    page_errors: [{ captured_at: '2026-01-01T00:00:01.000Z', type: 'error', message: 'Request failed', source: 'app.js', lineno: 42 }],
  } });
  document.referrer = '';
  window.scrollX = 0;
  window.scrollY = 0;
  window.getSelection = () => ({ toString: () => '' });
  const annotation = {
    schema: 'a2gent.browser.annotation.v2',
    type: 'numbered_references',
    viewport: { width: 1280, height: 720, device_pixel_ratio: 2 },
    annotation_count: 2,
    references: [
      { number: 1, type: 'element', text: 'Fix this button', element: { tag: 'BUTTON', id: '', className: '', text: 'Save' } },
      { number: 2, type: 'element', text: 'Inspect this section', element: { tag: 'SECTION', id: 'main', className: 'content' } },
    ],
    strokes: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }],
  };
  const original = structuredClone(annotation);
  const { payload } = await pageDiagnostics.collectFullDiagnostics({
    userPrompt: 'Inspect this page', reason: 'initial', getDrawingSummary: () => annotation,
  });
  const serialized = JSON.stringify(payload);
  const wire = JSON.parse(serialized);
  assert.equal(Object.hasOwn(wire.page, 'referrer'), false);
  assert.equal(Object.hasOwn(wire, 'selected_text'), false);
  assert.deepEqual(wire.page.viewport, { width: 1280, height: 720, device_pixel_ratio: 2 });
  const { schema, viewport, ...expected } = structuredClone(original);
  delete expected.references[0].element.id;
  delete expected.references[0].element.className;
  expected.strokes = [{ points: [[10, 20], [30, 40]] }];
  assert.deepEqual(wire.focus_annotation, expected);
  assert.deepEqual(annotation, original);
  assert.ok(serialized.length < 1000, `Representative payload was ${serialized.length} chars`);
  t.diagnostic(`Representative compact payload: ${serialized.length} chars`);
});

test('page errors collapse nonconsecutive identical messages and retain the latest 20 unique errors', async (t) => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    captured_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    type: 'error', message: `Failure ${index}`, source: 'app.js', lineno: index + 1,
  }));
  entries.push({ ...entries[24], captured_at: '2026-01-01T00:01:00.000Z' });
  entries.push({ type: 'unhandledrejection', reason: 'Rejected promise' });
  entries.push({ type: 'unhandledrejection', reason: 'Rejected promise' });
  const original = structuredClone(entries);
  installBrowserGlobals(t, { pageDiagnosticsPayload: { page_errors: entries } });
  const { payload } = await pageDiagnostics.collectFullDiagnostics({ reason: 'initial' });
  assert.equal(payload.page_errors.length, 20);
  assert.deepEqual(payload.page_errors[0], { ...entries[25], repeat_count: 2 });
  assert.equal(payload.page_errors.at(-1).message, 'Failure 5');
  assert.deepEqual(entries, original);
});

test('page error compaction preserves unhandled rejections and handles missing errors', async (t) => {
  const diagnostics = { page_errors: [
    { type: 'unhandledrejection', reason: 'Promise failed' },
    { type: 'error', message: 'Other failure' },
    { type: 'unhandledrejection', reason: 'Promise failed' },
  ] };
  installBrowserGlobals(t, { pageDiagnosticsPayload: diagnostics });
  const { payload } = await pageDiagnostics.collectFullDiagnostics({ reason: 'initial' });
  assert.deepEqual(payload.page_errors, [
    { type: 'unhandledrejection', reason: 'Promise failed', repeat_count: 2 },
    { type: 'error', message: 'Other failure' },
  ]);
  delete diagnostics.page_errors;
  const empty = await pageDiagnostics.collectFullDiagnostics({ reason: 'initial' });
  assert.deepEqual(empty.payload.page_errors, []);
  assert.equal(empty.payload.focus_annotation, undefined);
});


test('page errors with the same message at different locations stay distinct', async (t) => {
  const entries = [
    { type: 'error', message: 'Failed', source: 'a.js', lineno: 1, colno: 2 },
    { type: 'error', message: 'Failed', source: 'b.js', lineno: 1, colno: 2 },
    { type: 'error', message: 'Failed', source: 'a.js', lineno: 2, colno: 2 },
    { type: 'error', message: 'Failed', source: 'a.js', lineno: 1, colno: 3 },
  ];
  installBrowserGlobals(t, { pageDiagnosticsPayload: { page_errors: entries } });
  const { payload } = await pageDiagnostics.collectFullDiagnostics({ reason: 'initial' });
  assert.deepEqual(payload.page_errors, entries.toReversed());
});
