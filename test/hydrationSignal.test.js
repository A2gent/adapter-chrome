const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const open = (t, html, url) => {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  return dom.window;
};

test('a Remix page is marked only after React has taken the document', async (t) => {
  const html = '<!DOCTYPE html><html><body><script>window.__remixContext={}</script></body></html>';
  const window = open(t, html, 'https://job-boards.greenhouse.io/acme/jobs/1');

  window.eval(source('pageHook.js'));
  assert.equal(window.document.documentElement.hasAttribute('data-a2gent-hydrated'), false);

  window.document.__reactContainer$job = {};
  await pause(80);
  assert.equal(window.document.documentElement.hasAttribute('data-a2gent-hydrated'), false);
  window.document.body.append(window.document.createElement('div'));
  await pause(150);
  assert.equal(window.document.documentElement.hasAttribute('data-a2gent-hydrated'), false);
  await pause(250);
  assert.equal(window.document.documentElement.getAttribute('data-a2gent-hydrated'), '');
});

test('a Next.js page root is enough to mark the document', async (t) => {
  const html = '<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{}</script><div id="__next"></div></body></html>';
  const window = open(t, html, 'https://example.com/blog');

  window.eval(source('pageHook.js'));
  window.document.getElementById('__next').__reactContainer$next = {};
  await pause(80);
  assert.equal(window.document.documentElement.hasAttribute('data-a2gent-hydrated'), false);
  await pause(250);
  assert.equal(window.document.documentElement.getAttribute('data-a2gent-hydrated'), '');
});

test('a page that is not server-rendered React is left unmarked', async (t) => {
  const window = open(t, '<!DOCTYPE html><html><body><p>Hello</p></body></html>', 'https://www.ashbyhq.com/careers');

  window.eval(source('pageHook.js'));
  window.document.__reactContainer$job = {};
  await pause(40);

  assert.equal(window.document.documentElement.hasAttribute('data-a2gent-hydrated'), false);
});

test('the read-aloud player waits for the same signal on a Remix page', async (t) => {
  const html = '<!DOCTYPE html><html><body><script>window.__remixContext={}</script><main><h1>Role</h1><p>This paragraph is long enough to look like an article that the player would otherwise read aloud before the form is ready.</p></main></body></html>';
  const window = open(t, html, 'https://job-boards.greenhouse.io/acme/jobs/1');
  let observed = false;
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class SpyObserver extends NativeObserver {
    observe(...args) {
      observed = true;
      return super.observe(...args);
    }
  };
  window.chrome = {
    runtime: {
      id: 'a2gent',
      sendMessage() {},
      onMessage: { addListener() {} },
    },
    storage: {
      local: { get: () => Promise.resolve({}) },
      onChanged: { addListener() {} },
    },
  };

  window.eval(fs.readFileSync(path.join(__dirname, '../dist/hearhear-content.js'), 'utf8'));
  assert.equal(observed, false);
  window.document.dispatchEvent(new window.Event('a2gent-hydrated'));
  assert.equal(observed, true);
});
