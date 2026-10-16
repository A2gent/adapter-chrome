import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChunks, wordAtTime } from '../../src/hearhear/chunks.js';

test('queues one chunk per paragraph and keeps original offsets', () => {
  const text = 'A heading\n\nHello world! Another sentence.\n\nПривет мир! Ещё текст.';
  const chunks = splitChunks(text, 'ru');
  assert.deepEqual(chunks.map(c => c.text), ['A heading', 'Hello world! Another sentence.', 'Привет мир! Ещё текст.']);
  for (const c of chunks) assert.equal(text.slice(c.start, c.end), c.text);
});
test('bounds even punctuation-free paragraphs without losing text or splitting surrogate pairs', () => {
  for (const text of ['word '.repeat(600), 'я'.repeat(1001), '😀'.repeat(301)]) {
    const chunks = splitChunks(text, 'en');
    assert.ok(chunks.every(c => c.text.length <= 400 && c.text.length > 0));
    assert.equal(chunks.map(c => c.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c.text)));
  }
  assert.deepEqual(splitChunks('  '), []);
});
test('estimated word timing uses chunk offsets and has no highlight without duration', () => {
  const chunk = splitChunks('Title\n\none two three')[1];
  assert.equal(wordAtTime(chunk, 0, 10)?.start, 7);
  assert.equal(wordAtTime(chunk, 9.9, 10)?.text, 'three');
  assert.equal(wordAtTime(chunk, 4, 0), null);
});
