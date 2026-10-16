import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseURL, synthesize, listSpeechModels, speechModelsFromResponse, normalizeSpeechModel } from '../../src/hearhear/speech.js';
import { Player } from '../../src/hearhear/player.js';
test('only local HTTP(S) origins, no credentials, paths or redirects', () => {
  assert.equal(validateBaseURL('http://localhost:5445/'), 'http://localhost:5445');
  assert.equal(validateBaseURL('http://[::1]:5445'), 'http://[::1]:5445');
  for (const url of ['https://evil.test', 'http://localhost.evil.test', 'file:///tmp/a', 'http://user:pass@localhost', 'http://localhost/api', 'http://localhost/?x=1']) assert.throws(() => validateBaseURL(url));
});
test('posts Russian text and accepts audio only, omitting cookies', async () => {
  const blob = await synthesize({text:'Привет', language:'ru', baseURL:'http://localhost:5445'}, async (url, init) => {
    assert.equal(url, 'http://localhost:5445/speech/completion');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), {text:'Привет', language:'ru', model:'auto'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
  assert.equal(blob.type, 'audio/mpeg');
  await assert.rejects(synthesize({text:'hello'}, async () => new Response('{}', {headers:{'Content-Type':'application/json'}})), /audio/);
  await assert.rejects(synthesize({text:'hello'}, async () => new Response('broken', {status:502})), /502/);
  await assert.rejects(synthesize({text:' '.repeat(5)}), /text/);
});
test('sends explicit auto so Brute uses its local fallback chain', async () => {
  await synthesize({text:'Hello', language:'en', model:'auto', baseURL:'http://localhost:5445'}, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {text:'Hello', language:'en', model:'auto'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
  await synthesize({text:'Hello', language:'en', model:'piper_tts:en_US-ryan-high', baseURL:'http://localhost:5445'}, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {text:'Hello', language:'en', model:'piper_tts:en_US-ryan-high'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
});
test('loads available speech models from Brute and keeps Auto when catalog is missing', async () => {
  assert.equal(normalizeSpeechModel(''), 'auto');
  const models = speechModelsFromResponse({
    models:[
      {id:'auto', label:'Auto', available:true},
      {id:'piper_tts:ru_RU-ruslan-medium', label:'Piper Ruslan', available:true},
      {id:'macos_say_tts:Milena', label:'macOS Milena', available:false},
    ],
  });
  assert.deepEqual(models.map(model => model.id), ['auto', 'piper_tts:ru_RU-ruslan-medium']);
  const fetched = await listSpeechModels('http://localhost:5445', async url => {
    assert.equal(url, 'http://localhost:5445/speech/models');
    return new Response(JSON.stringify({models:[{id:'edge_tts:en-US-EmmaMultilingualNeural', label:'Edge Emma', available:true}]}), {headers:{'Content-Type':'application/json'}});
  });
  assert.deepEqual(fetched.map(model => model.id), ['auto', 'edge_tts:en-US-EmmaMultilingualNeural']);
  const fallback = await listSpeechModels('http://localhost:5445', async () => new Response('nope', {status:404}));
  assert.deepEqual(fallback.map(model => model.id), ['auto']);
});
class FakeAudio extends EventTarget {
  paused = true; currentTime = 0; duration = 120; src = ''; playbackRate = 1;
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute() { this.src = ''; }
}
const setup = (synth) => {
  const audio = new FakeAudio(); const revoked = [];
  const player = new Player(audio, synth, { createObjectURL: () => 'blob:test', revokeObjectURL: u => revoked.push(u) });
  return { player, audio, revoked };
};
test('loading -> playing -> pause/resume -> seek/end and cached replay', async () => {
  let calls = 0;
  const {player, audio, revoked} = setup(async () => { calls++; return new Blob(['audio']); });
  const pending = player.start(1, {text:'hello'});
  assert.equal(player.status(1).phase, 'loading');
  await pending;
  assert.equal(player.status(1).phase, 'playing');
  await player.command(1, 'pause');
  assert.equal(player.status(1).phase, 'paused');
  await player.command(1, 'play');
  await player.command(1, 'seek', 35);
  assert.equal(audio.currentTime, 35);
  await player.command(2, 'seek', 50);
  assert.equal(audio.currentTime, 35);
  audio.dispatchEvent(new Event('ended'));
  assert.equal(player.status(1).phase, 'ended');
  await player.command(1, 'play');
  assert.equal(audio.currentTime, 0);
  assert.equal(calls, 1);
  player.stop(1);
  assert.deepEqual(revoked, ['blob:test']);
});
test('cancel and replacement ignore stale synthesis, release resources', async () => {
  const pending = [];
  const {player} = setup(() => new Promise(resolve => pending.push(resolve)));
  const first = player.start(1, {text:'one'});
  player.stop(1);
  pending[0](new Blob(['old'])); await first;
  assert.equal(player.status(1).phase, 'idle');
  const second = player.start(1, {text:'two'});
  const third = player.start(2, {text:'three'});
  pending[1](new Blob(['old'])); pending[2](new Blob(['new']));
  await Promise.all([second, third]);
  assert.equal(player.status(1).phase, 'idle');
  assert.equal(player.status(2).phase, 'playing');
});
test('autoplay rejection offers manual play, synthesis failure offers retry', async () => {
  const {player, audio} = setup(async () => new Blob(['audio']));
  audio.play = async () => { throw new Error('autoplay denied'); };
  await player.start(1, {text:'one'});
  assert.equal(player.status(1).phase, 'paused');
  const {player: broken} = setup(async () => { throw new Error('server unavailable'); });
  await broken.start(1, {text:'one'});
  assert.equal(broken.status(1).phase, 'error');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
test('starts with a paragraph, prefetches only one ahead, and advances on ended', async () => {
  const calls = [];
  const {player, audio, revoked} = setup(async req => {calls.push(req); return new Blob([req.text]);});
  await player.start(1, {text:'One paragraph.\n\nTwo paragraphs.\n\nThird paragraph.', language:'en', model:'voice'});
  await tick();
  assert.deepEqual(calls.map(c => c.text), ['One paragraph.', 'Two paragraphs.']);
  assert.ok(calls.every(c => c.model === 'voice'));
  assert.equal(player.status(1).chunkCount, 3);
  assert.equal(player.status(1).wordStart, 0);
  audio.dispatchEvent(new Event('ended'));
  await tick();
  assert.equal(player.status(1).chunkIndex, 1);
  assert.equal(player.status(1).wordStart, 16);
  assert.deepEqual(calls.map(c => c.text), ['One paragraph.', 'Two paragraphs.', 'Third paragraph.']);
  assert.equal(revoked.length, 1);
  player.stop(1);
});
test('waiting for next chunk is cancellable and never plays stale results', {timeout:2000}, async () => {
  let finish; let signal;
  const {player, audio} = setup(async req => {
    if (req.text === 'First.') return new Blob(['first']);
    signal = req.signal;
    return new Promise(resolve => {finish = resolve;});
  });
  await player.start(1, {text:'First.\n\nSecond.\n\nThird.'});
  audio.dispatchEvent(new Event('ended'));
  assert.equal(player.status(1).phase, 'loading');
  player.stop(1);
  assert.equal(signal.aborted, true);
  finish(new Blob(['late'])); await tick();
  assert.equal(player.status(1).phase, 'idle');
  assert.equal(audio.src, '');
});
test('prefetch errors do not interrupt current audio and surface only on advance', async () => {
  const {player, audio} = setup(async req => {
    if (req.text === 'Second.') throw new Error('next failed');
    return new Blob(['audio']);
  });
  await player.start(1, {text:'First.\n\nSecond.'}); await tick();
  assert.equal(player.status(1).phase, 'playing');
  audio.dispatchEvent(new Event('ended')); await tick();
  assert.equal(player.status(1).phase, 'error');
  assert.match(player.status(1).error, /next failed/);
  player.stop(1);
});

test('autoplay block delays prefetch and pausing never queues the rest of the article', async () => {
  const calls = [];
  const {player, audio} = setup(async req => {calls.push(req.text); return new Blob(['audio']);});
  audio.play = async () => {throw new Error('blocked');};
  await player.start(1, {text:'First.\n\nSecond.\n\nThird.'});
  assert.deepEqual(calls, ['First.']);
  audio.play = FakeAudio.prototype.play;
  await player.command(1, 'play'); await tick();
  assert.deepEqual(calls, ['First.', 'Second.']);
  await player.command(1, 'pause'); await tick();
  assert.equal(player.status(1).phase, 'paused');
  assert.equal(calls.length, 2);
  player.stop(1);
});
test('multi-chunk replay restarts the article and releases completed audio cache', async () => {
  const calls = [];
  const {player, audio} = setup(async req => {calls.push(req.text); return new Blob(['audio']);});
  await player.start(1, {text:'First.\n\nSecond.'}); await tick();
  audio.dispatchEvent(new Event('ended')); await tick();
  assert.equal(player.cache.size, 1);
  audio.dispatchEvent(new Event('ended'));
  assert.equal(player.status(1).phase, 'ended');
  await player.command(1, 'play'); await tick();
  assert.equal(player.status(1).chunkIndex, 0);
  assert.deepEqual(calls, ['First.', 'Second.', 'First.', 'Second.']);
  player.stop(1);
});
test('replacement cancels speculative audio without corrupting the new owner', async () => {
  let finish; let signal;
  const {player} = setup(async req => {
    if (req.text === 'Second.') {
      signal = req.signal;
      return new Promise(resolve => {finish = resolve;});
    }
    return new Blob([req.text]);
  });
  await player.start(1, {text:'First.\n\nSecond.'});
  await player.start(2, {text:'Replacement.'});
  assert.equal(signal.aborted, true);
  finish(new Blob(['stale'])); await tick();
  assert.equal(player.status(1).phase, 'idle');
  assert.equal(player.status(2).phase, 'playing');
  assert.equal(player.status(2).chunkCount, 1);
  player.stop(2);
});

test('pause after start stays paused when the play event arrives late', async () => {
  const {player, audio} = setup(async () => new Blob(['audio']));
  let finishPlay;
  audio.play = function() {
    this.paused = false;
    return new Promise((resolve, reject) => {
      finishPlay = {resolve, reject};
      setTimeout(() => this.dispatchEvent(new Event('play')), 0);
    });
  };
  const started = player.start(1, {text:'hello'});
  await tick();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(player.status(1).phase, 'playing');
  await player.command(1, 'pause');
  assert.equal(audio.paused, true);
  assert.equal(player.status(1).phase, 'paused');
  audio.dispatchEvent(new Event('play'));
  finishPlay.resolve();
  await started;
  assert.equal(player.status(1).phase, 'paused');
  assert.equal(audio.paused, true);
  player.stop(1);
});

test('pause during next-chunk loading does not auto-play the next paragraph', async () => {
  let finishSecond;
  const {player, audio} = setup(async req => {
    if (req.text === 'Second.') return new Promise(resolve => { finishSecond = resolve; });
    return new Blob(['audio']);
  });
  await player.start(1, {text:'First.\n\nSecond.'});
  audio.dispatchEvent(new Event('ended'));
  await tick();
  assert.equal(player.status(1).phase, 'loading');
  await player.command(1, 'pause');
  assert.equal(player.status(1).phase, 'paused');
  finishSecond(new Blob(['second']));
  await tick();
  await tick();
  assert.equal(player.status(1).phase, 'paused');
  assert.equal(audio.paused, true);
  await player.command(1, 'play');
  assert.equal(player.status(1).phase, 'playing');
  assert.equal(player.status(1).chunkIndex, 1);
  player.stop(1);
});

test('pause reports the new phase before the pause event and a pause-interrupted play is not a policy error', async () => {
  const {player, audio} = setup(async () => new Blob(['audio']));
  // Real media elements dispatch the pause event asynchronously after pause().
  audio.pause = function() { this.paused = true; setTimeout(() => this.dispatchEvent(new Event('pause')), 0); };
  await player.start(1, {text:'hello'});
  assert.equal(player.status(1).phase, 'playing');
  await player.command(1, 'pause');
  assert.equal(player.status(1).phase, 'paused');
  await new Promise(resolve => setTimeout(resolve, 5));
  // Chrome rejects a pending play() with AbortError when pause() arrives first.
  audio.play = async () => { const error = new Error('interrupted'); error.name = 'AbortError'; throw error; };
  await player.command(1, 'play');
  assert.equal(player.status(1).phase, 'paused');
  assert.equal(player.status(1).error, '');
  player.stop(1);
});
test('restart rewinds the current chunk and rate applies to every chunk and later articles', async () => {
  const {player, audio} = setup(async () => new Blob(['audio']));
  await player.command(1, 'rate', 1.5);
  assert.equal(audio.playbackRate, 1.5);
  await player.start(1, {text:'First.\n\nSecond.'}); await tick();
  assert.equal(player.status(1).rate, 1.5);
  audio.currentTime = 7;
  await player.command(1, 'pause');
  await player.command(1, 'restart');
  assert.equal(audio.currentTime, 0);
  assert.equal(player.status(1).phase, 'playing');
  await player.command(1, 'rate', 9);
  assert.equal(player.status(1).rate, 1.5);
  audio.playbackRate = 1;
  audio.dispatchEvent(new Event('ended')); await tick();
  assert.equal(audio.playbackRate, 1.5);
  player.stop(1);
  await player.start(2, {text:'Other.', rate:0.7}); await tick();
  assert.equal(player.status(2).rate, 0.7);
  player.stop(2);
});
