const test = require('node:test');
const assert = require('node:assert/strict');

const { applyVerdicts, buildRules, emptyState, install, isThirdParty, reserveRequest, STORAGE_KEY } = require('../../src/adblock/background.js');

const item = (id, frameHost = '') => ({ id, frame_host: frameHost });

test('verdicts below the hide threshold are remembered as content', () => {
  const state = emptyState();
  const result = applyVerdicts(state, 'news.ee', [item('#a'), item('#b')], [
    { id: '#a', verdict: 'ad', confidence: 0.95 },
    { id: '#b', verdict: 'ad', confidence: 0.5 },
  ], 1);
  assert.deepEqual(result, { '#a': 'ad', '#b': 'content' });
  assert.deepEqual(state.sites['news.ee'].verdicts, { '#a': 'ad', '#b': 'content' });
});

test('only confident third-party ad frames become network rules', () => {
  const state = emptyState();
  applyVerdicts(state, 'www.news.ee', [item('#a', 'ads.net'), item('#b', 'cdn.news.ee'), item('#c', 'maybe.net')], [
    { id: '#a', verdict: 'ad', confidence: 0.95 },
    { id: '#b', verdict: 'ad', confidence: 0.95 },
    { id: '#c', verdict: 'ad', confidence: 0.85 },
  ], 1);
  assert.deepEqual(state.sites['www.news.ee'].domains, ['ads.net']);
});

test('unanswered items are remembered as content and foreign ids are ignored', () => {
  const state = emptyState();
  assert.deepEqual(applyVerdicts(state, 'news.ee', [item('#a')], [{ id: '#z', verdict: 'ad', confidence: 1 }], 1), { '#a': 'content' });
});

test('budget stops requests per host and per day and resets on the next day', () => {
  const state = { ...emptyState(), enabled: true };
  const day = Date.UTC(2026, 10, 4);
  for (let i = 0; i < 30; i += 1) assert.equal(reserveRequest(state, 'news.ee', day), true);
  assert.equal(reserveRequest(state, 'news.ee', day), false);
  assert.equal(reserveRequest(state, 'other.ee', day), true);
  assert.equal(reserveRequest(state, 'news.ee', day + 24 * 3600 * 1000), true);
});

test('nothing is sent while disabled, paused or cooling down after an error', () => {
  const now = 1000;
  assert.equal(reserveRequest(emptyState(), 'news.ee', now), false);
  assert.equal(reserveRequest({ ...emptyState(), enabled: true, paused: { 'news.ee': true } }, 'news.ee', now), false);
  assert.equal(reserveRequest({ ...emptyState(), enabled: true, cooldownUntil: now + 1 }, 'news.ee', now), false);
});

test('network rules stay scoped to the learned site and respect pause and disable', () => {
  const state = { ...emptyState(), enabled: true };
  state.sites = {
    'news.ee': { verdicts: {}, domains: ['ads.net'], updatedAt: 1 },
    'paused.ee': { verdicts: {}, domains: ['ads.net'], updatedAt: 1 },
  };
  state.paused = { 'paused.ee': true };
  const rules = buildRules(state);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.initiatorDomains, ['news.ee']);
  assert.deepEqual(buildRules({ ...state, enabled: false }), []);
  assert.equal('excludedInitiatorDomains' in rules[0].condition, false);
});

test('a paused subdomain is excluded from the parent site rule', () => {
  const state = { ...emptyState(), enabled: true, paused: { 'www.news.ee': true } };
  state.sites = { 'news.ee': { verdicts: {}, domains: ['ads.net'], updatedAt: 1 } };
  assert.deepEqual(buildRules(state)[0].condition.excludedInitiatorDomains, ['www.news.ee']);
});

test('isThirdParty treats subdomains of the page as first party', () => {
  assert.equal(isThirdParty('static.news.ee', 'www.news.ee'), false);
  assert.equal(isThirdParty('tpc.googlesyndication.com', 'www.news.ee'), true);
});

const harness = (fetchBruteJson) => {
  const store = {};
  const dynamicRules = [];
  let listener;
  const chrome = {
    storage: { local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (values) => Object.assign(store, values),
    } },
    declarativeNetRequest: {
      getDynamicRules: async () => [...dynamicRules],
      updateDynamicRules: async ({ addRules }) => { dynamicRules.splice(0, dynamicRules.length, ...addRules); },
    },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
  };
  install({ chrome, fetchBruteJson, errorMessage: (error) => error.message });
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  return { send, store, dynamicRules };
};

test('classify stores verdicts and installs the learned network rule', async () => {
  const { send, store, dynamicRules } = harness(async () => ({
    ok: true,
    response: { ok: true, status: 200, body: { verdicts: [{ id: '#a', verdict: 'ad', confidence: 0.99 }] } },
  }));
  await send({ type: 'A2GENT_ADBLOCK_SET_ENABLED', enabled: true });
  const result = await send({ type: 'A2GENT_ADBLOCK_CLASSIFY', host: 'news.ee', items: [item('#a', 'ads.net')] });
  assert.deepEqual(result, { ok: true, verdicts: { '#a': 'ad' } });
  assert.equal(store[STORAGE_KEY].sites['news.ee'].verdicts['#a'], 'ad');
  assert.equal(dynamicRules.length, 1);

  await send({ type: 'A2GENT_ADBLOCK_RESET_SITE', host: 'news.ee' });
  assert.equal(store[STORAGE_KEY].sites['news.ee'], undefined);
  assert.equal(dynamicRules.length, 0);
});

test('a Brute failure is reported and kept for the popup', async () => {
  let calls = 0;
  const { send, store } = harness(async () => {
    calls += 1;
    return { ok: true, response: { ok: false, status: 503, body: { error: 'System One is not configured' } } };
  });
  await send({ type: 'A2GENT_ADBLOCK_SET_ENABLED', enabled: true });
  const result = await send({ type: 'A2GENT_ADBLOCK_CLASSIFY', host: 'news.ee', items: [item('#a')] });
  assert.deepEqual(result, { ok: false, error: 'System One is not configured' });
  assert.equal(store[STORAGE_KEY].error, 'System One is not configured');

  assert.deepEqual(await send({ type: 'A2GENT_ADBLOCK_CLASSIFY', host: 'other.ee', items: [item('#b')] }), { ok: false, skipped: true });
  assert.equal(calls, 1);
});
