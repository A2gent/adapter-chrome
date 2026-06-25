const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('overlay composers submit on Enter and reserve Shift+Enter for newlines', () => {
  const contentScript = readFile('src/contentScript.js');
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
});
