import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractArticle } from '../../src/hearhear/article.js';
import { createHighlighter } from '../../src/hearhear/highlight.js';

test('maps cleaned words across inline nodes without changing article DOM', () => {
  const dom = new JSDOM(`<article><h1>Title</h1><p>«Hello» https://skip.test H<strong>DR</strong> café ﬁne <code>secret</code> word. ${'Some substantial prose about photographs. '.repeat(12)}</p></article>`);
  const d = dom.window.document; const article = extractArticle(d);
  const before = article.root.innerHTML;
  const registry = new Map();
  const scrolls = [];
  dom.window.scrollTo = options => scrolls.push(options);
  dom.window.scrollY = 40;
  dom.window.matchMedia = () => ({matches:false});
  dom.window.innerHeight = 800;
  const createRange = d.createRange.bind(d);
  d.createRange = () => {
    const range = createRange();
    range.getBoundingClientRect = () => ({top:700, bottom:720});
    return range;
  };
  dom.window.CSS = {highlights:registry};
  dom.window.Highlight = class {constructor(...ranges) {this.ranges = ranges;}};
  const highlighter = createHighlighter(article);
  const show = text => {
    const start = article.text.indexOf(text);
    highlighter.update({phase:'playing', wordStart:start, wordEnd:start + text.length});
    return registry.get('hearhear-word')?.ranges.map(r => r.toString()).join('');
  };
  assert.equal(show('Hello'), 'Hello');
  assert.deepEqual(scrolls, [{top:340, behavior:'smooth'}]);
  assert.equal(show('HDR'), 'HDR');
  assert.equal(show('fine'), 'ﬁne');
  assert.equal(show('secret'), 'secret');
  assert.equal(show('word'), 'word');
  assert.equal(article.root.innerHTML, before);
  highlighter.update({phase:'loading'});
  assert.equal(registry.size, 0);
  show('Hello'); highlighter.destroy();
  assert.equal(registry.size, 0);
  assert.equal(d.querySelector('[data-hearhear-highlight]'), null);
});
test('highlighting is optional in browsers without CSS Highlight API', () => {
  const d = new JSDOM('<article></article>').window.document;
  const h = createHighlighter({root:d.querySelector('article'), segments:[]});
  h.update({phase:'playing', wordStart:0, wordEnd:1}); h.destroy();
});
