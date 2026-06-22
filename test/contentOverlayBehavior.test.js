const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('opening the adapter overlay enters annotation mode immediately', () => {
  const contentScript = readFile('src/contentScript.js');
  const drawingBridge = readFile('src/contentScript/drawingBridge.js');

  assert.match(drawingBridge, /const enableDrawingInput = \(\) => \{/);
  assert.match(drawingBridge, /drawingOverlay\.setEnabled\(true\);/);
  assert.match(contentScript, /if \(nextOpen\) \{[\s\S]*enableDrawingInput\(\);[\s\S]*\}/);
});

test('render wiring supports dragging the overlay panel independently of resizing', () => {
  const renderWiring = readFile('src/contentScript/renderWiring.js');

  assert.match(renderWiring, /const clampOverlayPosition = /);
  assert.match(renderWiring, /const applyOverlayLayout = /);
  assert.match(renderWiring, /const dragHandle = shadow\.querySelector\('header'\);/);
  assert.match(renderWiring, /left: startPosition\.left \+ \(moveEvent\.clientX - startX\)/);
  assert.match(renderWiring, /bottom: startPosition\.bottom - \(moveEvent\.clientY - startY\)/);
  assert.match(renderWiring, /host\.style\.setProperty\('--a2gent-overlay-left'/);
  assert.match(renderWiring, /host\.style\.setProperty\('--a2gent-overlay-bottom'/);
});
