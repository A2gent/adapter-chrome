const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');

test('sync mode panel creates a card for an unknown profile and syncs it', async () => {
  const dom = new JSDOM('<main><h1>Anna K</h1><div class="text-body-medium">CTO at Acme</div></main>', {
    url: 'https://www.linkedin.com/in/anna-k/', runScripts: 'outside-only',
  });
  const { window } = dom;
  const calls = [];
  const responses = {
    'GET /projects': [{ id: 'p1', name: 'CRM', folder: '/tmp/crm' }],
    'GET /projects/p1/people': { people: [] },
    'POST /projects/p1/people': { path: 'People/Anna K.md', name: 'Anna K' },
    'PUT /projects/p1/people/linkedin-sync': { path: 'People/Anna K.md' },
  };
  window.chrome = {
    runtime: {
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
  // The panel uses a closed shadow root; capture it to inspect the rendered UI.
  let shadow;
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { shadow = attach.call(this, { ...init, mode: 'open' }); return shadow; };
  window.eval(source('contentScript/shared.js'));
  window.eval(source('peopleSync/linkedin.js'));
  window.eval(source('peopleSync/panel.js'));

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  const button = shadow.querySelector('.row button');
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
  window.close();
});
