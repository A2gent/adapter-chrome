const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

test('submit sends the text and page url to a Brute session and shows the reply', async (t) => {
  const dom = new JSDOM('<body></body>', { url: 'https://www.ashbyhq.com/careers?ashby_jid=1', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  const handlers = {
    'GET /unified-agents/': () => ({ agents: [{ id: 'biz-veronika', name: 'Veronika (HR)' }] }),
    'POST /sessions': () => ({ id: 's1' }),
    'POST /sessions/s1/start': () => ({}),
    'GET /sessions/s1': () => ({ status: 'completed', messages: [{ role: 'assistant', content: 'Form filled' }] }),
  };
  window.chrome = {
    runtime: {
      sendMessage: async ({ path: url, options }) => {
        const key = `${options?.method || 'GET'} ${url}`;
        calls.push({ key, body: options?.body && JSON.parse(options.body) });
        return { ok: true, response: { ok: true, status: 200, body: handlers[key]?.() } };
      },
    },
  };
  let shadow;
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) { shadow = attach.call(this, { ...init, mode: 'open' }); return shadow; };
  window.eval(source('chatAssist/markdown.js'));
  window.eval(source('ashby/panel.js'));

  assert.equal(shadow.querySelector('.avatar').textContent, 'V');
  assert.equal(shadow.querySelector('textarea').value, 'Autofill');
  shadow.querySelector('button').click();
  await settle();

  const created = calls.find((call) => call.key === 'POST /sessions').body;
  assert.equal(created.task, 'Autofill\n\nPage: https://www.ashbyhq.com/careers?ashby_jid=1');
  assert.equal(created.unified_agent_id, 'biz-veronika');
  assert.equal(created.metadata.skip_telegram_sync, true);
  assert.match(shadow.querySelector('.out').textContent, /Form filled/);
});
