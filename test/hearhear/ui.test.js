import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountPlayer, RATES, formatRate } from '../../src/hearhear/ui.js';

function mount(language = 'en', send = async () => ({phase:'idle'})) {
  const dom = new JSDOM('<article><h1>Title</h1><p>Hello</p></article>');
  const {document, Element} = dom.window;
  const shadows = new WeakMap();
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = attach.call(this, init);
    shadows.set(this, root);
    return root;
  };
  // Closed shadow roots hide listeners; capture click handlers by button label order.
  const clicks = new Map();
  const listen = Element.prototype.addEventListener;
  Element.prototype.addEventListener = function(type, listener, options) {
    if (this.tagName === 'BUTTON' && type === 'click') clicks.set(this, listener);
    return listen.call(this, type, listener, options);
  };
  const player = mountPlayer({root:document.querySelector('article'), language, text:'Hello'}, send);
  const root = shadows.get(player.host);
  const [restart, play, speed] = root.querySelectorAll('button');
  return {root, player, dom, restart, play, speed, click:button => clicks.get(button)({isTrusted:true})};
}

test('idle player is restart, big circular play and speed on a white card without seek or clock', () => {
  const {root, player, restart, play, speed} = mount();
  try {
    assert.equal(root.querySelectorAll('button').length, 3);
    assert.equal(restart.getAttribute('aria-label'), 'Restart chunk');
    assert.equal(restart.disabled, true);
    assert.equal(play.getAttribute('aria-label'), 'Play');
    assert.equal(play.textContent.trim(), '');
    assert.match(play.querySelector('svg path').getAttribute('d'), /M8 5v14l11-7/);
    assert.equal(speed.textContent, '1x');
    assert.equal(root.querySelector('input'), null);
    assert.equal(root.querySelector('.clock'), null);
    assert.equal(root.querySelector('.status').textContent, '');
    const css = root.querySelector('style').textContent;
    assert.match(css, /\.player\{[^}]*background:#fff/);
    assert.match(css, /\.player\{[^}]*box-shadow/);
    assert.match(css, /\.icon\{[^}]*border-radius:50%/);
    assert.match(css, /\.play\{[^}]*width:56px;height:56px/);
    assert.match(css, /:host\{[^}]*position:fixed!important/);
    assert.match(css, /bottom:16px!important/);
    assert.match(css, /z-index:2147483647!important/);
  } finally { player.destroy(); }
});

test('Russian player keeps accessible labels', () => {
  const {player, restart, play} = mount('ru');
  try {
    assert.equal(play.getAttribute('aria-label'), 'Слушать');
    assert.equal(restart.getAttribute('aria-label'), 'Сначала фрагмент');
    assert.ok(play.querySelector('svg'));
  } finally { player.destroy(); }
});

test('player visibility toggles without removing the player or stopping playback', () => {
  const {player} = mount();
  try {
    assert.equal(player.isVisible(), true);
    assert.equal(player.host.hidden, false);
    assert.equal(player.toggleVisibility(), false);
    assert.equal(player.isVisible(), false);
    assert.equal(player.host.hidden, true);
    assert.equal(player.host.getAttribute('aria-hidden'), 'true');
    assert.equal(player.toggleVisibility(), true);
    assert.equal(player.host.hidden, false);
    assert.equal(player.host.getAttribute('aria-hidden'), 'false');
  } finally { player.destroy(); }
});

test('speed cycles 0.7x -> 2x in a loop and is sent as a rate command', async () => {
  const calls = [];
  const {player, speed, click} = mount('en', async message => { calls.push(message); return {phase:'idle'}; });
  try {
    assert.deepEqual(RATES, [0.7, 1, 1.2, 1.5, 2]);
    const seen = [];
    for (let i = 0; i < RATES.length + 1; i++) { await click(speed); seen.push(speed.textContent); }
    assert.deepEqual(seen, ['1.2x', '1.5x', '2x', '0.7x', '1x', '1.2x']);
    assert.deepEqual(calls.filter(call => call.action === 'rate').map(call => call.value), [1.2, 1.5, 2, 0.7, 1, 1.2]);
    assert.equal(formatRate(1), '1x');
  } finally { player.destroy(); }
});

test('play sends explicit play/pause and restart rewinds the chunk', async () => {
  const calls = [];
  let phase = 'playing';
  const {player, restart, play, click} = mount('en', async message => {
    calls.push(message.action);
    if (message.action === 'pause') phase = 'paused';
    if (message.action === 'play') phase = 'playing';
    return {phase, duration:10, currentTime:1, rate:1.5};
  });
  try {
    await click(play);
    assert.deepEqual(calls, ['start']);
    assert.equal(play.getAttribute('aria-label'), 'Pause');
    assert.equal(restart.disabled, false);
    await click(play);
    assert.equal(calls.at(-1), 'pause');
    assert.equal(play.getAttribute('aria-label'), 'Play');
    await click(play);
    assert.equal(calls.at(-1), 'play');
    assert.equal(play.getAttribute('aria-label'), 'Pause');
    await click(restart);
    assert.equal(calls.at(-1), 'restart');
    assert.equal(player.host.isConnected, true);
  } finally { player.destroy(); }
});

test('a loading player sends pause instead of a second play', async () => {
  const calls = [];
  const {player, play, click} = mount('en', async message => {
    calls.push(message.action);
    if (message.action === 'start') return {phase:'loading'};
    if (message.action === 'pause') return {phase:'paused'};
    return {phase:'loading'};
  });
  try {
    await click(play);
    assert.equal(play.disabled, false);
    assert.equal(play.getAttribute('aria-label'), 'Pause');
    await click(play);
    assert.equal(calls.at(-1), 'pause');
    assert.equal(play.getAttribute('aria-label'), 'Play');
  } finally { player.destroy(); }
});

test('latest command response wins over an older status poll', async () => {
  let resolveStatus;
  const statusPending = new Promise(resolve => { resolveStatus = resolve; });
  const calls = [];
  const {player, play, click, dom} = mount('en', async message => {
    calls.push(message.action);
    if (message.action === 'start') return {phase:'playing', duration:10, currentTime:1};
    if (message.action === 'status') return statusPending;
    if (message.action === 'pause') return {phase:'paused', duration:10, currentTime:2};
    return {phase:'idle'};
  });
  try {
    await click(play);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.ok(calls.includes('status'));
    await click(play);
    assert.equal(play.getAttribute('aria-label'), 'Play');
    resolveStatus({phase:'playing', duration:10, currentTime:3});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(play.getAttribute('aria-label'), 'Play');
  } finally {
    resolveStatus?.({phase:'paused'});
    player.destroy();
    dom.window.close();
  }
});
