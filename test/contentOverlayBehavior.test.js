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

test('render wiring routes dialog tool buttons to the drawing overlay', () => {
  const renderWiring = readFile('src/contentScript/renderWiring.js');
  const drawingBridge = readFile('src/contentScript/drawingBridge.js');
  const contentScript = readFile('src/contentScript.js');

  assert.match(renderWiring, /setDrawingTool/);
  assert.match(renderWiring, /shadow\.querySelectorAll\('\[data-tool\]'\)/);
  assert.match(drawingBridge, /drawingOverlay\.setTool\(tool\)/);
  assert.match(drawingBridge, /drawingTool: drawingOverlay\.getActiveTool/);
  assert.match(contentScript, /drawingTool: detail\.activeTool/);
  assert.match(contentScript, /setDrawingTool,/);
});

test('clampOverlayWidth defaults to 30 percent and ignores unset widths', () => {
  const { clampOverlayWidth } = require('../src/contentScript/renderWiring.js');
  const shared = require('../src/contentScript/shared.js');

  assert.equal(clampOverlayWidth(0, 1400), Math.round(1400 * shared.SIDEBAR_OVERLAY_WIDTH_RATIO));
  assert.equal(clampOverlayWidth(500, 1400), 500);
  assert.equal(clampOverlayWidth(80, 1400), shared.SIDEBAR_OVERLAY_MIN_WIDTH);
  assert.equal(clampOverlayWidth(1300, 1400), Math.round(1400 * shared.SIDEBAR_OVERLAY_MAX_WIDTH_RATIO));
});

test('render wiring resizes session sidebar width and keeps bottom bar drag before session', () => {
  const renderWiring = readFile('src/contentScript/renderWiring.js');

  assert.match(renderWiring, /const clampOverlayWidth = /);
  assert.match(renderWiring, /const applyOverlayLayout = /);
  assert.match(renderWiring, /usesSessionSidebar\(state\)/);
  assert.match(renderWiring, /shared\.SIDEBAR_OVERLAY_WIDTH_RATIO/);
  assert.match(renderWiring, /startWidth \+ \(startX - moveEvent\.clientX\)/);
  assert.match(renderWiring, /host\.style\.setProperty\('--a2gent-overlay-width'/);
  assert.match(renderWiring, /host\.style\.setProperty\('--a2gent-overlay-left'/);
  assert.match(renderWiring, /host\.style\.setProperty\('--a2gent-overlay-bottom'/);
  assert.match(renderWiring, /const startPanelDrag = /);
});

test('overlay rendering is isolated from RTL pages', () => {
  const contentUi = readFile('src/contentUi.js');
  const renderWiring = readFile('src/contentScript/renderWiring.js');
  const contentDrawing = readFile('src/contentDrawing.js');

  assert.match(contentUi, /\.panel \{[\s\S]*direction: ltr;[\s\S]*text-align: left;/);
  assert.match(contentUi, /\.panel \{[\s\S]*unicode-bidi: isolate;/);
  assert.match(renderWiring, /host\.setAttribute\('dir', 'ltr'\);/);
  assert.match(contentDrawing, /host\.setAttribute\('dir', 'ltr'\);/);
  assert.match(contentDrawing, /\.wrap \{[\s\S]*direction: ltr;[\s\S]*unicode-bidi: isolate;/);
});

test('overlay hosts promote to top layer so high page z-index cannot steal focus', () => {
  const sharedSource = readFile('src/contentScript/shared.js');
  const renderWiring = readFile('src/contentScript/renderWiring.js');
  const contentUi = readFile('src/contentUi.js');
  const contentDrawing = readFile('src/contentDrawing.js');

  assert.match(sharedSource, /const setOverlayHostTopLayer = /);
  assert.match(sharedSource, /showPopover/);
  assert.match(sharedSource, /popover',\s*'manual'/);
  assert.match(sharedSource, /const DRAWING_TOP_LAYER_Z_INDEX = OVERLAY_TOP_LAYER_Z_INDEX/);
  assert.match(sharedSource, /const root = host\.ownerDocument\?\.documentElement/);
  assert.match(sharedSource, /root\.appendChild\(host\)/);
  assert.match(renderWiring, /shared\.setOverlayHostTopLayer\(host,\s*state\.open[\s\S]*raise:\s*state\.open/);
  assert.match(contentDrawing, /DRAWING_TOP_LAYER_Z_INDEX \|\| 2147483647/);
  assert.match(contentDrawing, /setOverlayHostTopLayer\(chatHost, true/);
  assert.match(contentDrawing, /raise:\s*true/);
  assert.match(contentUi, /:host \{[\s\S]*pointer-events:\s*none;/);
  assert.match(contentUi, /\.panel \{[\s\S]*pointer-events:\s*auto;/);
});

test('annotation reference text is synchronized only after committed editor submit', () => {
  const contentScript = readFile('src/contentScript.js');

  assert.match(contentScript, /if \(detail\.committedReference\) \{/);
  assert.match(contentScript, /syncAnnotationReferenceText\(detail\.committedReference\);/);
  assert.doesNotMatch(contentScript, /updatedReference/);
});
