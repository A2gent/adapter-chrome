const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const popupJs = fs.readFileSync(path.join(__dirname, '../src/popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '../src/popup.html'), 'utf8');

const mount = (t, { sendMessage, tab }) => {
  const html = `<!doctype html>
    <button class="item" data-mode="audio"></button>
    <button id="victoria"></button>
    <button id="settings"></button>
    <div id="error"></div>`;
  const dom = new JSDOM(html, { url: 'chrome-extension://a2gent/src/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  const messages = [];
  let closed = false;
  window.close = () => { closed = true; };
  window.chrome = {
    storage: { local: { get(_keys, callback) { callback({}); } } },
    tabs: { query: async () => [tab] },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        return sendMessage ? sendMessage(message) : { ok: true };
      },
      openOptionsPage() {},
    },
  };
  window.eval(popupJs);
  return {
    messages,
    closed: () => closed,
    click: () => window.document.getElementById('victoria').click(),
    error: () => window.document.getElementById('error').textContent,
  };
};

test('the toolbar popup offers Victoria', () => {
  assert.match(popupHtml, /id="victoria"/);
  assert.match(popupHtml, /icons\/victoria-40\.png/);
});

test('Victoria menu opens the panel on the active tab', async (t) => {
  const ui = mount(t, { tab: { id: 7, url: 'https://job-boards.greenhouse.io/jobs/1' } });
  ui.click();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(JSON.parse(JSON.stringify(ui.messages)), [{
    type: 'A2GENT_SHOW_HR_PANEL',
    tab: { id: 7, url: 'https://job-boards.greenhouse.io/jobs/1' },
  }]);
  assert.equal(ui.closed(), true);
});

test('Victoria menu stays open when the page cannot host the panel', async (t) => {
  const ui = mount(t, {
    tab: { id: 7, url: 'chrome://extensions' },
    sendMessage: async () => ({ ok: false, error: 'Victoria can only open on a normal web page.' }),
  });
  ui.click();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(ui.closed(), false);
  assert.match(ui.error(), /normal web page/);
});
