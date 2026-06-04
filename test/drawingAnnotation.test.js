const test = require('node:test');
const assert = require('node:assert/strict');

const { createStroke, summarizeDrawing } = require('../src/drawingAnnotation');

test('createStroke clamps points to viewport and removes duplicate consecutive points', () => {
  const stroke = createStroke([
    { x: -10.2, y: 5.8 },
    { x: -10.2, y: 5.8 },
    { x: 20.4, y: 40.5 },
    { x: 250, y: 140 },
  ], { width: 200, height: 100 });

  assert.deepEqual(stroke, [
    { x: 0, y: 6 },
    { x: 20, y: 41 },
    { x: 200, y: 100 },
  ]);
});

test('createStroke ignores tap-only annotations because screenshots need visible curves', () => {
  assert.equal(createStroke([{ x: 10, y: 10 }], { width: 100, height: 100 }), null);
});

test('summarizeDrawing returns compact metadata for all visible freeform strokes', () => {
  const summary = summarizeDrawing([
    [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    [{ x: 10, y: 10 }],
    [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 6 }],
  ], { width: 300, height: 200, devicePixelRatio: 2 });

  assert.deepEqual(summary, {
    schema: 'a2gent.browser.annotation.v1',
    type: 'freeform_curve',
    viewport: { width: 300, height: 200, device_pixel_ratio: 2 },
    strokes: [
      [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      [{ x: 5, y: 5 }, { x: 6, y: 6 }],
    ],
    stroke_count: 2,
    point_count: 4,
  });
});
