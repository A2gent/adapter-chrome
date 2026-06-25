const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/contentDrawing.js'), 'utf8');

test('annotation shapes render non-obscuring regions and 10px arrow target circles', () => {
  assert.match(source, /<circle\s+[\s\S]*class="arrow-dot"[\s\S]*r="5"[\s\S]*><\/circle>/);
  assert.doesNotMatch(source, /marker-end="url\(#a2gent-arrow-head\)"/);
  assert.doesNotMatch(source, /id="a2gent-arrow-head"/);
  assert.match(source, /\.region-rect\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*#ff3b30;[\s\S]*stroke-width:\s*8;/);
  assert.doesNotMatch(source, /\.region-rect\s*\{[^}]*fill:\s*rgba/);
});

test('annotation overlay defaults to rectangle mode', () => {
  assert.match(source, /const DEFAULT_TOOL = 'region';/);
  assert.match(source, /activeTool = DEFAULT_TOOL;/);
  assert.match(source, /data-tool="arrow" aria-pressed="false">Arrow/);
  assert.match(source, /data-tool="region" aria-pressed="true">Rectangle/);
});

test('annotation tools include precise DOM element selection with red highlight', () => {
  assert.match(source, /const DEFAULT_TOOL = 'region';/);
  assert.match(source, /const TOOLS = \['arrow', 'region', 'element'\];/);
  assert.match(source, /if \(!TOOLS\.includes\(tool\)\) return;/);
  assert.match(source, /data-tool="element" aria-pressed="false">Element/);
  assert.match(source, /\.surface\s*\{[\s\S]*z-index:\s*1;[\s\S]*cursor:\s*crosshair;/);
  assert.match(source, /\.shape-layer\s*\{\s*z-index:\s*2;\s*\}/);
  assert.match(source, /\.element-rect\s*\{[\s\S]*fill:\s*rgba\(255, 59, 48, 0\.10\);[\s\S]*stroke:\s*#ff3b30;[\s\S]*stroke-width:\s*2;/);
  assert.match(source, /\.element-preview-rect\s*\{[\s\S]*stroke-dasharray:\s*6 4;/);
  assert.match(source, /const elementFromViewportPoint = \(clientX, clientY\) =>/);
  // Hit-testing must suppress the surface pointer-events, not just the host, or the
  // overlay swallows the lookup and nothing under the cursor is ever highlighted.
  assert.match(source, /if \(surface\) surface\.style\.pointerEvents = 'none';/);
  assert.match(source, /cursor:\s*cell;/);
});

test('annotation editor commits reference text only when Done is clicked', () => {
  assert.match(source, /updateAnnotationText\(annotation\.number, event\.target\.value, \{ emit: false \}\)/);
  assert.match(source, /emitChange\(\{ committedReference: \{ number: committed\.number, type: committed\.type, text: committed\.text \} \}\)/);
  assert.doesNotMatch(source, /updatedReference/);
});
