const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../../src/chatAssist/markdown.js'), 'utf8');

const render = (t, text) => {
  const { window } = new JSDOM('<div id="out"></div>', { runScripts: 'outside-only' });
  t.after(() => window.close());
  window.eval(source);
  const out = window.document.getElementById('out');
  out.append(window.__A2GENT_CHAT_ASSIST_MARKDOWN__(text));
  return out;
};

test('headings and inline styles become elements', (t) => {
  const out = render(t, '# Title\n\n## Sub ##\n\nA **bold** and *em* and `co*de*` and ***both***, snake_case_name stays, 2 * 3 * 4 too');
  assert.equal(out.querySelector('h1').textContent, 'Title');
  assert.equal(out.querySelector('h2').textContent, 'Sub');
  assert.equal(out.querySelector('p > strong').textContent, 'bold');
  assert.equal(out.querySelector('p > em').textContent, 'em');
  assert.equal(out.querySelector('code').textContent, 'co*de*');
  assert.equal(out.querySelector('strong > em').textContent, 'both');
  assert.match(out.textContent, /snake_case_name stays, 2 \* 3 \* 4 too/);
});

test('tables keep alignment, inline styles, escaped pipes and ragged rows', (t) => {
  const out = render(t, 'Intro:\n| Who | **Score** |\n|:---|---:|\n| Ann | a\\|b<br>c |\n| Bob |\n\nAfter');
  assert.deepEqual([...out.querySelectorAll('th')].map((cell) => cell.textContent), ['Who', 'Score']);
  assert.equal(out.querySelector('th strong').textContent, 'Score');
  assert.equal(out.querySelectorAll('tbody tr').length, 2);
  const [, cell] = out.querySelectorAll('tbody td');
  assert.equal(cell.style.textAlign, 'right');
  assert.equal(cell.textContent, 'a|bc');
  assert.ok(cell.querySelector('br'));
  assert.equal(out.querySelectorAll('tbody tr:last-child td').length, 2);
  assert.equal(out.lastElementChild.textContent, 'After');
});

test('lists nest, survive blank lines and keep their start number', (t) => {
  const out = render(t, 'Plan:\n3. one\n  - sub **a**\n    - deep\n\n4. two\n\n   more\n\n- other');
  assert.equal(out.querySelector('p').textContent, 'Plan:');
  const ol = out.querySelector('ol');
  assert.equal(ol.start, 3);
  assert.equal(ol.children.length, 2);
  assert.equal(ol.querySelector('li > ul > li > ul > li').textContent, 'deep');
  assert.equal(ol.children[1].querySelectorAll('p').length, 2);
  assert.equal(out.lastElementChild.tagName, 'UL');
});

test('code fences, quotes and rules stay separate blocks', (t) => {
  const out = render(t, '```js\n**raw** | x\n\n# no\n```\n> quoted **text**\n> - item\n\n---\nend');
  assert.equal(out.querySelector('pre code').textContent, '**raw** | x\n\n# no');
  assert.equal(out.querySelector('blockquote strong').textContent, 'text');
  assert.ok(out.querySelector('blockquote ul'));
  assert.ok(out.querySelector('hr'));
  assert.equal(out.querySelector('h1'), null);
});

test('quoted HTML and unsafe links stay inert text', (t) => {
  const out = render(t, '<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://a.example/x) see https://b.example/y.');
  assert.equal(out.querySelector('img'), null);
  assert.deepEqual([...out.querySelectorAll('a')].map((node) => node.href), ['https://a.example/x', 'https://b.example/y']);
  assert.equal(out.querySelector('a').rel, 'noopener noreferrer');
  assert.match(out.textContent, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(out.textContent, /y\.$/);
});
