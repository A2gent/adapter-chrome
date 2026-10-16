const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');

test('sync mode panel creates a card for an unknown profile and syncs it', async (t) => {
  const dom = new JSDOM('<main><h1>Anna K</h1><div class="text-body-medium">CTO at Acme</div></main>', {
    url: 'https://www.linkedin.com/in/anna-k/', runScripts: 'outside-only',
  });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  const responses = {
    'GET /projects': [{ id: 'p1', name: 'CRM', folder: '/tmp/crm' }],
    'GET /projects/p1/people': { people: [] },
    'POST /projects/p1/people': { path: 'People/Anna K.md', name: 'Anna K' },
    'PUT /projects/p1/people/linkedin-sync': { path: 'People/Anna K.md' },
  };
  window.chrome = {
    runtime: {
      getURL: (resource) => `chrome-extension://test/${resource}`,
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message, reply) {
        const key = `${message.options?.method || 'GET'} ${message.path}`;
        calls.push({ key, body: message.options?.body && JSON.parse(message.options.body) });
        reply({ ok: true, response: { ok: true, status: 200, body: responses[key] } });
      },
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get: (keys, callback) => {
          const values = { 'a2gent.adapterChrome.mode': 'sync' };
          if (callback) callback(values);
          return Promise.resolve(values);
        },
        set: (_values, callback) => callback?.(),
      },
    },
  };
  // The panel and inline widgets use closed shadow roots; capture them to inspect the rendered UI.
  const shadows = [];
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { const root = attach.call(this, { ...init, mode: 'open' }); shadows.push(root); return root; };
  const find = (selector) => shadows.map((root) => root.querySelector(selector)).find(Boolean);
  window.eval(source('contentScript/shared.js'));
  window.eval(source('peopleSync/linkedin.js'));
  window.eval(source('peopleSync/panel.js'));

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  const button = find('.row button');
  assert.equal(button.textContent, '+');
  button.click();
  await settle();

  assert.deepEqual(calls.map((call) => call.key).slice(-3), ['POST /projects/p1/people', 'PUT /projects/p1/people/linkedin-sync', 'GET /projects/p1/people']);
  const created = calls.find((call) => call.key === 'POST /projects/p1/people').body;
  assert.equal(created.name, 'Anna K');
  const synced = calls.find((call) => call.key.startsWith('PUT')).body;
  assert.equal(synced.path, 'People/Anna K.md');
  assert.equal(synced.profile.url, 'https://www.linkedin.com/in/anna-k/');
  assert.equal(synced.profile.company, 'Acme');
  assert.equal(find('.head select').title, '/tmp/crm');
  assert.match(find('.note').textContent, /Created in CRM: \/tmp\/crm\/People\/Anna K\.md/);
  window.close();
});

test('sync mode panel links an unknown profile to an existing person chosen in the select', async (t) => {
  const dom = new JSDOM('<main><h1>Anna K</h1><div class="text-body-medium">CTO at Acme</div></main>', {
    url: 'https://www.linkedin.com/in/anna-k/', runScripts: 'outside-only',
  });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  const responses = {
    'GET /projects': [{ id: 'p1', name: 'CRM', folder: '/tmp/crm' }],
    'GET /projects/p1/people': { people: [{ path: 'People/Boss.md', name: 'Boss', groups: ['Mentors'], socials: {} }] },
    'POST /projects/p1/people': { path: 'People/Anna K.md', name: 'Anna K' },
    'PUT /projects/p1/people/linkedin-sync': { path: 'People/Boss.md' },
  };
  window.chrome = {
    runtime: {
      getURL: (resource) => `chrome-extension://test/${resource}`,
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message, reply) {
        const key = `${message.options?.method || 'GET'} ${message.path}`;
        calls.push({ key, body: message.options?.body && JSON.parse(message.options.body) });
        reply({ ok: true, response: { ok: true, status: 200, body: responses[key] } });
      },
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get: (keys, callback) => {
          const values = { 'a2gent.adapterChrome.mode': 'sync' };
          if (callback) callback(values);
          return Promise.resolve(values);
        },
        set: (_values, callback) => callback?.(),
      },
    },
  };
  // The panel and inline widgets use closed shadow roots; capture them to inspect the rendered UI.
  const shadows = [];
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { const root = attach.call(this, { ...init, mode: 'open' }); shadows.push(root); return root; };
  const find = (selector) => shadows.map((root) => root.querySelector(selector)).find(Boolean);
  window.eval(source('contentScript/shared.js'));
  window.eval(source('peopleSync/linkedin.js'));
  window.eval(source('peopleSync/panel.js'));

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  const input = find('.row input');
  input.dispatchEvent(new window.Event('focus'));
  // People are grouped under their group header and filterable by typing.
  assert.equal(find('.grp').textContent, 'Mentors');
  input.value = 'bos';
  input.dispatchEvent(new window.Event('input'));
  const option = [...shadows.flatMap((root) => [...root.querySelectorAll('.opt')])].find((node) => node.textContent === 'Boss');
  option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(input.value, 'Boss');
  const button = find('.row button');
  assert.equal(button.textContent, '🔗');
  button.click();
  await settle();

  assert.ok(!calls.some((call) => call.key === 'POST /projects/p1/people'));
  assert.equal(calls.find((call) => call.key.startsWith('PUT')).body.path, 'People/Boss.md');
  assert.match(find('.note').textContent, /Linked in CRM: \/tmp\/crm\/People\/Boss\.md/);
  window.close();
});

test('sync mode injects one inline widget per list row and keeps the panel free of rows', async (t) => {
  const dom = new JSDOM(`<main><ul>
    <li id="r1"><div><a href="/in/anna-k/"><span aria-hidden="true">Anna K</span></a><p>CTO at Acme</p></div><div class="actions"><button>Message</button></div></li>
    <li id="r2"><div><a href="/in/bob-b/"><span aria-hidden="true">Bob B</span></a><p>Dev at Beta</p></div><div class="actions"><button>Message</button></div></li>
  </ul></main>`, { url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const responses = {
    'GET /projects': [{ id: 'p1', name: 'CRM', folder: '/tmp/crm' }],
    'GET /projects/p1/people': { people: [{ path: 'People/Anna K.md', name: 'Anna K', socials: { linkedin: 'https://www.linkedin.com/in/anna-k/' } }] },
  };
  window.chrome = {
    runtime: {
      getURL: (resource) => `chrome-extension://test/${resource}`,
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message, reply) {
        reply({ ok: true, response: { ok: true, status: 200, body: responses[`${message.options?.method || 'GET'} ${message.path}`] } });
      },
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get: (keys, callback) => {
          const values = { 'a2gent.adapterChrome.mode': 'sync' };
          if (callback) callback(values);
          return Promise.resolve(values);
        },
        set: (_values, callback) => callback?.(),
      },
    },
  };
  const roots = new Map();
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { const root = attach.call(this, { ...init, mode: 'open' }); roots.set(this, root); return root; };
  window.eval(source('contentScript/shared.js'));
  window.eval(source('peopleSync/linkedin.js'));
  window.eval(source('peopleSync/panel.js'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const widget = (rowId) => window.document.querySelector(`#${rowId} .actions > [data-a2gent-people-sync]`);
  assert.ok(widget('r1') && widget('r2'));
  assert.equal(window.document.querySelector('#r1 .actions > button').nextElementSibling, widget('r1'));
  assert.match(roots.get(widget('r2')).querySelector('style').textContent, /width:136px;flex:0 0 136px/);
  assert.equal(roots.get(widget('r2')).querySelector('img.brand-icon').getAttribute('src'), 'chrome-extension://test/icons/a2gent-16.png');
  assert.match(roots.get(widget('r1')).querySelector('.ok').textContent, /Anna K/);
  assert.equal(roots.get(widget('r2')).querySelector('button').textContent, '+');
  const panel = [...roots.entries()].find(([element]) => !element.hasAttribute('data-a2gent-people-sync'))[1];
  assert.equal(panel.querySelectorAll('.row').length, 0);
  assert.match(panel.querySelector('.sum').textContent, /1\/2 linked/);
  window.close();
});
