const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const loadBackground = () => {
  const listeners = {};
  const sent = [];
  const created = [];
  const chrome = {
    runtime: { onInstalled: { addListener: (fn) => { listeners.installed = fn; } } },
    contextMenus: { create: (item) => created.push(item), onClicked: { addListener: (fn) => { listeners.clicked = fn; } } },
    tabs: { sendMessage: async (tabId, message) => { sent.push({ tabId, message }); } },
  };
  vm.runInNewContext(source('summarize/background.js'), { chrome, Promise });
  return { listeners, sent, created };
};

test('the selection context menu is created on install', () => {
  const { listeners, created } = loadBackground();
  listeners.installed();
  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'Summarize with A2gent');
  assert.deepEqual([...created[0].contexts], ['selection']);
});

test('clicking the menu sends the selection to the page', () => {
  const { listeners, sent } = loadBackground();
  listeners.clicked({ menuItemId: 'a2gent-summarize-selection', selectionText: 'Hello world' }, { id: 7 });
  listeners.clicked({ menuItemId: 'other', selectionText: 'x' }, { id: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ tabId: 7, message: { type: 'A2GENT_SUMMARIZE_SELECTION', text: 'Hello world' } }]);
});

const setupPanel = (t, handlers) => {
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  let listener;
  window.chrome = {
    runtime: {
      getURL: (asset) => `chrome-extension://a2gent/${asset}`,
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: async ({ path: url, options }) => {
        const key = `${options?.method || 'GET'} ${url}`;
        const body = options?.body && JSON.parse(options.body);
        calls.push({ key, body });
        return handlers[key] ? { ok: true, response: { ok: true, status: 200, body: handlers[key](body) } } : { ok: false, error: `no handler ${key}` };
      },
    },
    storage: { local: { get: async () => ({}) } },
  };
  const shadows = [];
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { const root = attach.call(this, { ...init, mode: 'open' }); shadows.push(root); return root; };
  window.eval(source('chatAssist/markdown.js'));
  window.eval(source('summarize/panel.js'));
  const summarize = (text) => listener({ type: 'A2GENT_SUMMARIZE_SELECTION', text });
  const shadow = () => shadows[shadows.length - 1];
  return { window, document: window.document, calls, summarize, shadow };
};

const happy = (reply) => ({
  'GET /unified-agents/': () => ({ agents: [{ id: 'biz-aristotle', name: 'Аристотель' }] }),
  'POST /sessions': () => ({ id: 's1' }),
  'POST /sessions/s1/start': () => ({}),
  'GET /sessions/s1': () => ({ status: 'completed', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: reply }] }),
});

test('the panel opens with a loading state, then renders the summary and the session stays local', async (t) => {
  const { calls, summarize, shadow, document } = setupPanel(t, happy('**Short** summary'));
  summarize('A long article text');
  assert.equal(document.querySelectorAll('[data-a2gent-summarize]').length, 1);
  assert.equal(shadow().querySelector('.out').textContent, 'Summarizing…');
  await settle();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.equal(created.unified_agent_id, 'biz-aristotle');
  assert.equal(created.metadata.skip_telegram_sync, true);
  assert.match(created.task, /same language as the text/);
  assert.match(created.task, /A long article text$/);
  assert.equal(shadow().querySelector('.out strong').textContent, 'Short');
  assert.match(shadow().querySelector('.out').textContent, /Short summary/);
});

test('the close button and Escape remove the panel', async (t) => {
  const { window, document, summarize, shadow } = setupPanel(t, happy('ok'));
  summarize('text');
  await settle();
  shadow().querySelector('.close').click();
  assert.equal(document.querySelectorAll('[data-a2gent-summarize]').length, 0);

  summarize('text');
  assert.equal(document.querySelectorAll('[data-a2gent-summarize]').length, 1);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelectorAll('[data-a2gent-summarize]').length, 0);
});

test('an empty selection shows an error without calling Brute', async (t) => {
  const { calls, summarize, shadow } = setupPanel(t, happy('ok'));
  summarize('   ');
  await settle();
  assert.equal(shadow().querySelector('.out.err').textContent, 'No text selected.');
  assert.equal(calls.length, 0);
});

test('a failed request shows the error in the panel', async (t) => {
  const { summarize, shadow } = setupPanel(t, { 'GET /unified-agents/': () => ({ agents: [] }) });
  summarize('text');
  await settle();
  assert.match(shadow().querySelector('.out.err').textContent, /no handler POST \/sessions/);
});

test('a reopened panel ignores the reply of the closed one', async (t) => {
  const { summarize, shadow, document } = setupPanel(t, happy('late'));
  summarize('first');
  shadow().querySelector('.close').click();
  await settle();
  assert.equal(document.querySelectorAll('[data-a2gent-summarize]').length, 0);
});
