const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const AGENTS = () => ({ agents: [{ id: 'biz-veronika', name: 'Veronika (HR)' }] });
const REPLY = { role: 'assistant', content: 'Form filled' };
const networkError = () => ({ proxied: { ok: false, error: 'Network down' } });
const httpError = (status, error) => () => ({ proxied: { ok: true, response: { ok: false, status, body: { error } } } });
const inOrder = (...steps) => () => (steps.length > 1 ? steps.shift() : steps[0])();

const mount = (t, handlers) => {
  const dom = new JSDOM('<body></body>', { url: 'https://www.ashbyhq.com/careers?ashby_jid=1', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  window.chrome = {
    runtime: {
      sendMessage: async ({ path: url, options }) => {
        const key = `${options?.method || 'GET'} ${url}`;
        calls.push({ key, body: options?.body && JSON.parse(options.body) });
        const result = handlers[key]?.();
        return result?.proxied || { ok: true, response: { ok: true, status: 200, body: result } };
      },
    },
  };
  let shadow;
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { shadow = attach.call(this, { ...init, mode: 'open' }); return shadow; };
  window.eval(source('chatAssist/markdown.js'));
  window.eval(source('ashby/panel.js'));
  const count = (key) => calls.filter((call) => call.key === key).length;
  const submit = async () => { shadow.querySelector('button').click(); await settle(); };
  return { calls, count, shadow, submit };
};

test('submit sends the text and page url to a Brute session and shows the reply', async (t) => {
  const { calls, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [REPLY] }),
  });

  assert.equal(shadow.querySelector('.avatar').textContent, 'V');
  assert.equal(shadow.querySelector('textarea').value, 'Autofill');
  await submit();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.equal(created.task, 'Autofill\n\nPage: https://www.ashbyhq.com/careers?ashby_jid=1');
  assert.equal(created.unified_agent_id, 'biz-veronika');
  assert.equal(created.metadata.skip_telegram_sync, true);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});

test('no session is created when no agent has the exact HR name', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': () => ({ agents: [{ id: 'other', name: 'Veronika' }] }),
  });

  await submit();

  assert.equal(count('POST /sessions'), 0);
  assert.equal(shadow.querySelector('.out.err').textContent, 'HR agent Veronika not found');
});

test('no session is created when the agent lookup fails', async (t) => {
  const { count, shadow, submit } = mount(t, { 'GET /unified-agents/': networkError });

  await submit();

  assert.equal(count('POST /sessions'), 0);
  assert.equal(shadow.querySelector('.out.err').textContent, 'Network down');
});

test('submit after a polling network error resumes the running session', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': inOrder(networkError, () => ({ status: 'running', messages: [] }), () => ({ status: 'completed', messages: [REPLY] })),
  });

  await submit();
  assert.equal(shadow.querySelector('.out.err').textContent, 'Network down');
  await submit();

  assert.equal(count('POST /sessions'), 1);
  assert.equal(count('POST /sessions/s1/queue'), 0);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});

test('submit after a polling network error shows a reply that finished meanwhile instead of sending again', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': inOrder(networkError, () => ({ status: 'completed', messages: [REPLY] })),
  });

  await submit();
  await submit();

  assert.equal(count('POST /sessions'), 1);
  assert.equal(count('POST /sessions/s1/queue'), 0);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});

test('submit on a session waiting for input does not create another one', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'input_required', messages: [] }),
  });

  await submit();
  await submit();

  assert.equal(count('POST /sessions'), 1);
  assert.match(shadow.querySelector('.out.err').textContent, /waiting for input/);
});

test('submit after a cancelled run creates a new session', async (t) => {
  const { count, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'paused', messages: [] }),
  });

  await submit();
  await submit();

  assert.equal(count('POST /sessions'), 2);
});

test('follow-up on a finished session goes to the queue', async (t) => {
  const { calls, count, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'POST /sessions/s1/queue': () => ({}),
    'GET /sessions/s1': inOrder(
      () => ({ status: 'completed', messages: [REPLY] }),
      () => ({ status: 'completed', messages: [REPLY] }),
      () => ({ status: 'completed', messages: [REPLY, { role: 'assistant', content: 'Second' }] }),
    ),
  });

  await submit();
  await submit();

  assert.equal(count('POST /sessions'), 1);
  assert.match(calls.find((call) => call.key === 'POST /sessions/s1/queue').body.message, /^Autofill/);
});

test('a start conflict from the auto queue keeps polling', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': httpError(409, 'Session is busy'),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [REPLY] }),
  });

  await submit();

  assert.equal(count('GET /sessions/s1'), 1);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});

test('a start error on a dead session is shown and stops polling', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': httpError(500, 'Failed to start session: disk full'),
    'GET /sessions/s1': () => ({ status: 'failed', messages: [] }),
  });

  await submit();

  assert.equal(count('GET /sessions/s1'), 1);
  assert.equal(shadow.querySelector('.out.err').textContent, 'Failed to start session: disk full');
  assert.match(shadow.querySelector('.head a').href, /chat\/s1$/);
});

test('a start error keeps polling when the session is already running', async (t) => {
  const { shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': httpError(400, 'Session is not in queued status'),
    'GET /sessions/s1': inOrder(() => ({ status: 'running', messages: [] }), () => ({ status: 'completed', messages: [REPLY] })),
  });

  await submit();

  assert.equal(shadow.querySelector('.out.err'), null);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});
