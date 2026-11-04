const test = require('node:test');
const assert = require('node:assert/strict');
const chatImage = require('../../src/chatAssist/chatImage.js');

test('only Google Chat image hosts are allowed', () => {
  for (const url of ['https://chat.google.com/u/0/api/get_attachment_url?x=1', 'https://lh3.googleusercontent.com/a', 'https://mail.google.com/chat/a']) {
    assert.equal(chatImage.isChatImageUrl(url), true, url);
  }
  for (const url of ['http://chat.google.com/a', 'https://evil.com/a', 'https://chat.google.com.evil.com/a', 'https://evilgoogleusercontent.com/a', 'not a url']) {
    assert.equal(chatImage.isChatImageUrl(url), false, url);
  }
});

test('only Chat pages may request images', () => {
  assert.equal(chatImage.isChatPage('https://chat.google.com'), true);
  assert.equal(chatImage.isChatPage('https://lh3.googleusercontent.com/a'), false);
  assert.equal(chatImage.isChatPage(undefined), false);
});

const withFetch = (t, response) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return response; };
  t.after(() => { globalThis.fetch = original; });
  return calls;
};

test('a disallowed URL is never requested with the user cookies', async (t) => {
  const calls = withFetch(t, {});
  await assert.rejects(chatImage.fetchChatImage('https://evil.com/a'), /not allowed/);
  assert.equal(calls.length, 0);
});

test('an oversized image is refused before its body is read', async (t) => {
  withFetch(t, { ok: true, url: 'https://chat.google.com/a', headers: new Headers({ 'content-length': String(31 * 1024 * 1024) }), blob: async () => assert.fail('body read') });
  await assert.rejects(chatImage.fetchChatImage('https://chat.google.com/a'), /too large/);
});

test('a redirect to a foreign host and a non-image reply are rejected', async (t) => {
  const blob = async () => new Blob(['x'], { type: 'text/html' });
  withFetch(t, { ok: true, url: 'https://evil.com/a', blob });
  await assert.rejects(chatImage.fetchChatImage('https://chat.google.com/a'), /redirected/);
  withFetch(t, { ok: true, url: 'https://chat.google.com/signin', blob });
  await assert.rejects(chatImage.fetchChatImage('https://chat.google.com/a'), /Not an image/);
});
