const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src/chatAssist', file), 'utf8');
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const setup = (t, handlers) => {
  const dom = new JSDOM(`<div id="pane"><c-wiz><div role="group" id="msg"></div></c-wiz>
    <div id="composer"><div id="box" role="textbox" contenteditable="true"></div></div></div>`, { url: 'https://chat.google.com/u/0/', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const { document } = window;
  document.getElementById('msg').innerText = 'Ann\n,\n9:00 AM\n,\nCan we ship?';
  window.Element.prototype.getClientRects = () => [{}];
  const calls = [];
  window.chrome = {
    runtime: {
      sendMessage: async ({ path: url, options }) => {
        const key = `${options?.method || 'GET'} ${url}`;
        const body = options?.body && JSON.parse(options.body);
        calls.push({ key, body });
        return { ok: true, response: { ok: true, status: 200, body: handlers[key]?.(body) } };
      },
    },
    storage: { local: { get: async () => ({}), set: () => {} } },
  };
  const shadows = [];
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { const root = attach.call(this, { ...init, mode: 'open' }); shadows.push(root); return root; };
  window.eval(source('googleChat.js'));
  window.eval(source('panel.js'));
  const find = (selector) => shadows[0].querySelector(selector);
  const buttons = () => [...shadows[0].querySelectorAll('button')];
  return { document, window, calls, find, buttons };
};

const completed = (...contents) => () => ({
  status: 'completed',
  messages: contents.flatMap((content) => [{ role: 'user', content: 'q' }, { role: 'assistant', content }]),
});

test('analyze starts an agent session that stays out of Telegram and shows the reply', async (t) => {
  const { calls, find, buttons, document } = setup(t, {
    'GET /unified-agents/': () => ({ agents: [{ id: 'dev-coder', name: 'Coder' }, { id: 'biz-aristotle', name: 'Аристотель' }] }),
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': completed('Суть спора: релиз'),
  });
  await settle();

  assert.equal(document.getElementById('composer').previousElementSibling.hasAttribute('data-a2gent-chat-assist'), true);
  assert.equal(find('select').value, 'biz-aristotle');
  buttons()[0].click();
  await settle();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.equal(created.unified_agent_id, 'biz-aristotle');
  assert.equal(created.metadata.skip_telegram_sync, true);
  assert.match(created.task, /Ann \(9:00 AM\):\nCan we ship\?/);
  assert.ok(calls.some((call) => call.key === 'POST /sessions/s1/start'));
  assert.equal(find('.out').textContent, 'Суть спора: релиз');
  assert.equal(document.getElementById('box').textContent, '');
});

test('draft review continues the session through the queue without resending the thread', async (t) => {
  let replies = ['analysis'];
  const { calls, find, buttons, document } = setup(t, {
    'POST /sessions': () => ({ id: 's1' }),
    'GET /sessions/s1': () => completed(...replies)(),
    'POST /sessions/s1/queue': () => { replies = ['analysis', 'draft review']; return {}; },
  });
  await settle();
  buttons()[0].click();
  await settle();

  document.getElementById('box').innerText = 'Yes, on Friday';
  buttons()[1].click();
  await settle();

  const { body } = calls.find((call) => call.key === 'POST /sessions/s1/queue');
  assert.match(body.message, /Черновик:\nDATA-\S+\nYes, on Friday\nDATA-/);
  assert.doesNotMatch(body.message, /Переписка:/);
  assert.equal(calls.filter((call) => call.key === 'POST /sessions').length, 1);
  assert.equal(find('.out').textContent, 'draft review');
});

test('draft review without a draft sends nothing', async (t) => {
  const { calls, find, buttons } = setup(t, {});
  await settle();
  buttons()[1].click();
  await settle();

  assert.equal(calls.some((call) => call.key.startsWith('POST')), false);
  assert.match(find('.out.err').textContent, /Type a draft/);
});

test('a failed agent run surfaces as an error', async (t) => {
  const { find, buttons } = setup(t, {
    'POST /sessions': () => ({ id: 's1' }),
    'GET /sessions/s1': () => ({ status: 'failed', messages: [] }),
  });
  await settle();
  buttons()[0].click();
  await settle();

  assert.match(find('.out.err').textContent, /run failed/);
});

test('a retry after a failed run opens a fresh session with the whole conversation', async (t) => {
  let id = 0;
  const { calls, find, buttons } = setup(t, {
    'POST /sessions': () => ({ id: `s${id += 1}` }),
    'GET /sessions/s1': () => ({ status: 'failed', messages: [] }),
    'GET /sessions/s2': completed('second try'),
  });
  await settle();
  buttons()[0].click();
  await settle();
  buttons()[0].click();
  await settle();

  assert.equal(calls.some((call) => call.key.endsWith('/queue')), false);
  assert.match(calls.filter((call) => call.key === 'POST /sessions')[1].body.task, /Can we ship\?/);
  assert.equal(find('.out').textContent, 'second try');
});

test('a follow-up waits for its own reply instead of showing the previous one', async (t) => {
  let replies = ['first'];
  let polls = 0;
  const { find, buttons } = setup(t, {
    'POST /sessions': () => ({ id: 's1' }),
    'GET /sessions/s1': () => { polls += 1; return completed(...replies)(); },
    'POST /sessions/s1/queue': () => { setTimeout(() => { replies = ['first', 'second']; }, 0); return {}; },
  });
  await settle();
  buttons()[0].click();
  await settle();
  buttons()[0].click();
  await settle();

  assert.equal(find('.out').textContent, '');
  assert.ok(polls >= 3);
});

test('hiding the composer keeps the widget and its reply', async (t) => {
  const { document, find, buttons, window } = setup(t, {
    'POST /sessions': () => ({ id: 's1' }),
    'GET /sessions/s1': completed('kept'),
  });
  await settle();
  buttons()[0].click();
  await settle();

  window.Element.prototype.getClientRects = () => [];
  document.getElementById('pane').append(document.createElement('i'));
  await new Promise((resolve) => { setTimeout(resolve, 900); });

  const host = document.querySelector('[data-a2gent-chat-assist]');
  assert.equal(host.hidden, true);
  assert.equal(find('.out').textContent, 'kept');
});
