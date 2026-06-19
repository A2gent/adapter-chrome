const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStroke,
  createAnnotation,
  summarizeAnnotations,
} = require('../src/drawingAnnotation');

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

test('createStroke preserves document coordinates beyond the visible viewport', () => {
  const stroke = createStroke([
    { x: 180, y: 280 },
    { x: 220, y: 360 },
    { x: 900, y: 1200 },
  ], { width: 200, height: 300, pageWidth: 800, pageHeight: 1000 });

  assert.deepEqual(stroke, [
    { x: 180, y: 280 },
    { x: 220, y: 360 },
    { x: 800, y: 1000 },
  ]);
});

test('createAnnotation normalizes arrow references with page coordinates and text', () => {
  const annotation = createAnnotation({
    type: 'arrow',
    number: '3',
    text: '  resize this button  ',
    start: { x: -5, y: 10.4 },
    end: { x: 460.6, y: 260 },
  }, { width: 300, height: 200, pageWidth: 450, pageHeight: 250 });

  assert.deepEqual(annotation, {
    number: 3,
    type: 'arrow',
    text: 'resize this button',
    geometry: {
      start: { x: 0, y: 10 },
      end: { x: 450, y: 250 },
    },
  });
});

test('createAnnotation normalizes dragged regions and rejects non-visible shapes', () => {
  assert.deepEqual(createAnnotation({
    type: 'region',
    number: 2,
    text: 'hero card',
    start: { x: 80, y: 90 },
    end: { x: 20, y: 30 },
  }, { width: 200, height: 200 }), {
    number: 2,
    type: 'region',
    text: 'hero card',
    geometry: { x: 20, y: 30, width: 60, height: 60 },
  });

  assert.equal(createAnnotation({ type: 'arrow', start: { x: 1, y: 1 }, end: { x: 2, y: 2 } }, { width: 200, height: 200 }), null);
  assert.equal(createAnnotation({ type: 'region', start: { x: 1, y: 1 }, end: { x: 3, y: 3 } }, { width: 200, height: 200 }), null);
  assert.equal(createAnnotation({ type: 'freeform', start: { x: 1, y: 1 }, end: { x: 30, y: 30 } }, { width: 200, height: 200 }), null);
});

test('summarizeAnnotations returns compact numbered references without screenshot geometry', () => {
  const summary = summarizeAnnotations([
    { number: 1, type: 'arrow', text: 'resize this button', geometry: { start: { x: 5, y: 5 }, end: { x: 55, y: 55 } } },
    { number: 2, type: 'region', text: 'too small', geometry: { x: 1, y: 1, width: 2, height: 2 } },
    { number: 3, type: 'region', text: 'keep this card', geometry: { x: 10, y: 20, width: 90, height: 40 } },
  ], { width: 300, height: 200, devicePixelRatio: 2 });

  assert.deepEqual(summary, {
    schema: 'a2gent.browser.annotation.v2',
    type: 'numbered_references',
    viewport: { width: 300, height: 200, device_pixel_ratio: 2 },
    annotation_count: 2,
    references: [
      { number: 1, type: 'arrow', text: 'resize this button' },
      { number: 3, type: 'region', text: 'keep this card' },
    ],
  });
});
