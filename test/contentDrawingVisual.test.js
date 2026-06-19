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
  assert.doesNotMatch(source, /\.region-rect\s*\{[\s\S]*fill:\s*rgba/);
});
