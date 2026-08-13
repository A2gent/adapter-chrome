const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { focusTextarea } = require('../src/contentScript/overlayFocus.js');

const repoRoot = path.resolve(__dirname, '..');
const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('focus textarea helper prevents scrolling and moves the cursor to the end', () => {
  const calls = [];
  const textarea = {
    value: 'existing text',
    focus: (options) => calls.push(['focus', options]),
    setSelectionRange: (start, end) => calls.push(['selection', start, end]),
  };

  focusTextarea(textarea);

  assert.deepEqual(calls, [
    ['focus', { preventScroll: true }],
    ['selection', 13, 13],
  ]);
});

test('overlay composers submit on Enter and reserve Shift+Enter for newlines', () => {
  const contentScript = readFile('src/contentScript.js');
  const renderWiring = readFile('src/contentScript/renderWiring.js');
  const overlayFocus = readFile('src/contentScript/overlayFocus.js');
  const pageHook = readFile('src/pageHook.js');
  const contentUi = readFile('src/contentUi.js');

  for (const source of [overlayFocus, pageHook]) {
    assert.match(source, /const shouldSubmitOverlayComposer = \(event, role\) => \(/);
    assert.match(source, /role === 'prompt' \|\| role === 'followup'/);
    assert.match(source, /event\.key === 'Enter'/);
    assert.match(source, /!event\.shiftKey/);
    assert.match(source, /event\.preventDefault\(\)/);
  }

  assert.match(overlayFocus, /shared\.OVERLAY_SUBMIT_EVENT/);
  assert.match(pageHook, /a2gent-overlay-submit/);
  assert.match(contentScript, /if \(role === 'prompt'\) \{\n\s+void startSession\(\);/);
  assert.match(contentScript, /if \(role === 'followup'\) \{\n\s+void sendFollowup\(\);/);
  assert.match(contentUi, /Start a new chat\.\.\. Enter to send, Shift\+Enter for newline\./);
  assert.match(contentUi, /Follow up\. Enter to send, Shift\+Enter for newline\./);
  assert.match(contentUi, /data-role="focus-composer" data-target="prompt"/);
  assert.match(contentUi, /data-role="focus-composer" data-target="followup"/);
  assert.match(renderWiring, /\[data-role="focus-composer"\]/);
  assert.match(renderWiring, /focus\.focusTextarea\(textarea\)/);
});

test('overlay keyboard shield consumes composer typing before website shortcuts', () => {
  const overlayFocus = readFile('src/contentScript/overlayFocus.js');
  const pageHook = readFile('src/pageHook.js');

  for (const source of [overlayFocus, pageHook]) {
    assert.match(source, /event\.stopImmediatePropagation\(\);/);
    assert.match(source, /window\.addEventListener\(eventType, handleOverlayKeyboardEvent, \{ capture: true \}\)/);
    assert.match(source, /document\.addEventListener\(eventType, handleOverlayKeyboardEvent, \{ capture: true \}\)/);
  }

  assert.match(overlayFocus, /event\.stopPropagation\(\);[\s\S]*event\.stopImmediatePropagation\(\);/);
  assert.match(pageHook, /event\.stopPropagation\(\);[\s\S]*event\.stopImmediatePropagation\(\);/);
});

test('new sessions are queued with initial diagnostics in the create request', () => {
  const contentScript = readFile('src/contentScript.js');

  assert.match(contentScript, /const initialMessage = createInitialMessage\(prompt, diagnosticsBundle\.payload\);/);
  assert.match(contentScript, /const initialImages = \[imageFromScreenshot\(diagnosticsBundle\.screenshotDataUrl, 'initial-page-screenshot\.png'\)\];/);
  assert.match(contentScript, /createSession\(state\.selectedProjectId, metadata, \{\s*task: initialMessage,\s*images: initialImages,\s*\}\)/);
  assert.doesNotMatch(
    contentScript,
    /await sendStreamMessage\(\s*created\.id,\s*createInitialMessage\(prompt, diagnosticsBundle\.payload\)/,
    'queued session creation must not immediately start the session stream',
  );
});
