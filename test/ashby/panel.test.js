const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const AGENTS = () => ({ agents: [{ id: 'biz-victoria', name: 'Victoria' }] });
const REPLY = { role: 'assistant', content: 'Form filled' };
const networkError = () => ({ proxied: { ok: false, error: 'Network down' } });
const httpError = (status, error) => () => ({ proxied: { ok: true, response: { ok: false, status, body: { error } } } });
const inOrder = (...steps) => () => (steps.length > 1 ? steps.shift() : steps[0])();

const mount = (t, handlers, url = 'https://www.ashbyhq.com/careers?ashby_jid=1', html = '<body></body>') => {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  window.chrome = {
    runtime: {
      getURL: (asset) => `chrome-extension://a2gent/${asset}`,
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
  return { calls, count, shadow, submit, document: window.document };
};

test('submit sends the text and page url to a Brute session and shows the reply', async (t) => {
  const { calls, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [REPLY] }),
  });

  assert.equal(shadow.querySelector('.head').firstElementChild.className, 'avatar');
  assert.equal(shadow.querySelector('.avatar').src, 'chrome-extension://a2gent/icons/victoria-40.png');
  assert.equal(shadow.querySelector('.name').textContent, 'Victoria');
  assert.equal(shadow.querySelector('.box').className, 'box');
  assert.equal(shadow.querySelector('.via').textContent, 'via Agent ²');
  assert.equal(shadow.querySelector('.head').lastElementChild.className, 'logo');
  assert.equal(shadow.querySelector('.logo').previousElementSibling.className, 'via');
  assert.equal(shadow.querySelector('.logo').src, 'chrome-extension://a2gent/icons/a2gent-32.png');
  assert.equal(shadow.querySelector('textarea').value, 'Autofill');
  await submit();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.match(created.task, /^Context: you are working through the A2gent Chrome extension/);
  assert.match(created.task, /Tab URL: https:\/\/www\.ashbyhq\.com\/careers\?ashby_jid=1/);
  assert.match(created.task, /Act inline on this page/);
  assert.match(created.task, /\n\nRequest: Autofill$/);
  assert.equal(created.unified_agent_id, 'biz-victoria');
  assert.equal(created.project_id, 'system-kb');
  assert.equal(created.metadata.source, 'ashby');
  assert.equal(created.metadata.skip_telegram_sync, true);
  assert.equal(shadow.querySelector('.box').className, 'box side');
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});

test('a Remix job page keeps the card out of the document until React has adopted the page', async (t) => {
  const html = '<!DOCTYPE html><html><body><script>window.__remixContext={}</script><main>Job</main></body></html>';
  const { document } = mount(t, {}, 'https://job-boards.greenhouse.io/acme/jobs/1', html);

  assert.equal(document.querySelector('[data-a2gent-ashby]'), null);
  document.dispatchEvent(new document.defaultView.Event('a2gent-hydrated'));
  assert.ok(document.querySelector('[data-a2gent-ashby]'));
});

test('a page that only mentions Remix in prose still shows the card immediately', async (t) => {
  const html = '<!DOCTYPE html><html><body><script>const note = "see __remixContext in the docs";</script></body></html>';
  const { document } = mount(t, {}, 'https://example.com/article', html);

  assert.ok(document.querySelector('[data-a2gent-ashby]'));
});

test('a Remix page that has already adopted its HTML shows the card immediately', async (t) => {
  const html = '<!DOCTYPE html><html data-a2gent-hydrated=""><body><script>window.__remixContext={}</script></body></html>';
  const { document } = mount(t, {}, 'https://job-boards.greenhouse.io/acme/jobs/1', html);

  assert.ok(document.querySelector('[data-a2gent-ashby]'));
});

test('a Greenhouse application tags the session as greenhouse', async (t) => {
  const { calls, shadow, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [REPLY] }),
  }, 'https://job-boards.greenhouse.io/canonical_managed_posts/jobs/8371032?gh_src=l3evnqyy1us');

  assert.equal(shadow.querySelector('.name').textContent, 'Victoria');
  await submit();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.equal(created.metadata.source, 'greenhouse');
  assert.match(created.task, /Tab URL: https:\/\/job-boards\.greenhouse\.io\/canonical_managed_posts\/jobs\/8371032\?gh_src=l3evnqyy1us/);
});

test('a page outside the job boards tags the session as extension', async (t) => {
  const { calls, submit } = mount(t, {
    'GET /unified-agents/': AGENTS,
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [REPLY] }),
  }, 'https://example.com/jobs/1');

  await submit();

  assert.equal(calls.find((call) => call.key === 'POST /sessions').body.metadata.source, 'extension');
});

test('no session is created when the Victoria agent is missing', async (t) => {
  const { count, shadow, submit } = mount(t, {
    'GET /unified-agents/': () => ({ agents: [{ id: 'other', name: 'Victoria' }] }),
  });

  await submit();

  assert.equal(count('POST /sessions'), 0);
  assert.equal(shadow.querySelector('.out.err').textContent, 'HR agent Victoria not found');
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
  assert.match(calls.find((call) => call.key === 'POST /sessions/s1/queue').body.message, /\n\nRequest: Autofill$/);
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
