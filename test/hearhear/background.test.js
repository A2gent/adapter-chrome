import test from 'node:test';
import assert from 'node:assert/strict';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('background authenticates messages and cancels start during offscreen creation', async () => {
  let listener; let finishCreation; let exists = false; const forwarded = [];
  const event = () => ({addListener() {}});
  globalThis.chrome = {
    runtime:{id:'extension', getURL:path => `chrome-extension://extension/${path}`, onMessage:{addListener(fn) {listener = fn;}}, sendMessage:async msg => {forwarded.push(msg); return {phase:'loading'};}},
    offscreen:{hasDocument:async () => exists, createDocument:() => new Promise(resolve => {finishCreation = () => {exists = true; resolve();};})},
    storage:{local:{get:async () => ({})}},
    tabs:{onRemoved:event(), onUpdated:event()},
  };
  try {
    await import('../../src/hearhear/background.js');
    const sender = {id:'extension', frameId:0, tab:{id:4}};
    const send = (message, source = sender) => new Promise(resolve => {
      if (listener({target:'background', ...message}, source, resolve) !== true) resolve(undefined);
    });
    assert.equal(await send({action:'start', text:'hello', language:'en'}, {...sender, frameId:1}), undefined);
    assert.equal(await send({action:'start', text:'hello', language:'en'}, {...sender, id:'other'}), undefined);
    const pending = send({action:'start', text:'hello', language:'en'});
    await tick();
    assert.ok(finishCreation);
    await send({action:'stop'});
    finishCreation();
    assert.equal((await pending).phase, 'idle');
    assert.equal(forwarded.filter(m => m.action === 'start').length, 0);
  } finally { delete globalThis.chrome; }
});
test('background forwards the saved Brute speech model to offscreen synthesis', async () => {
  let listener; const forwarded = [];
  const event = () => ({addListener() {}});
  globalThis.chrome = {
    runtime:{id:'extension', getURL:path => `chrome-extension://extension/${path}`, onMessage:{addListener(fn) {listener = fn;}}, sendMessage:async msg => {forwarded.push(msg); return {phase:'loading'};}},
    offscreen:{hasDocument:async () => true, createDocument:async () => {}},
    storage:{local:{get:async () => ({baseURL:'http://127.0.0.1:5445', speechModel:'piper_tts:ru_RU-ruslan-medium'})}},
    tabs:{onRemoved:event(), onUpdated:event()},
  };
  try {
    await import('../../src/hearhear/background.js?model');
    const reply = await new Promise(resolve => {
      const kept = listener({target:'background', action:'start', text:'hello', language:'en'}, {id:'extension', frameId:0, tab:{id:8}}, resolve);
      assert.equal(kept, true);
    });
    assert.equal(reply.phase, 'loading');
    assert.equal(forwarded[0].model, 'piper_tts:ru_RU-ruslan-medium');
    assert.equal(forwarded[0].baseURL, 'http://127.0.0.1:5445');
  } finally { delete globalThis.chrome; }
});
