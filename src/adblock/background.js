// Adblock state owner: the service worker is the only writer, so concurrent tabs cannot
// overwrite each other's verdicts. Content scripts read the same storage key directly.
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.A2gentAdblockBackground = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const STORAGE_KEY = 'a2gent.adapterChrome.adblock';
  const CLASSIFY_PATH = '/browser-extension/adblock/classify';
  const HIDE_CONFIDENCE = 0.8;
  const NETWORK_BLOCK_CONFIDENCE = 0.9;
  const MAX_SITES = 200;
  const MAX_VERDICTS_PER_SITE = 100;
  const MAX_DOMAINS_PER_SITE = 20;
  const DAILY_REQUEST_LIMIT = 300;
  const DAILY_REQUEST_LIMIT_PER_HOST = 30;
  const ERROR_COOLDOWN_MS = 10 * 60 * 1000;

  const emptyState = () => ({ enabled: false, paused: {}, sites: {}, error: '', cooldownUntil: 0, budget: { day: '', total: 0, hosts: {} } });
  const emptySite = () => ({ verdicts: {}, domains: [], updatedAt: 0 });

  const registrableSuffix = (host) => host.split('.').slice(-2).join('.');

  // Two labels over-match on domains like foo.co.uk, which only makes blocking more cautious.
  const isThirdParty = (frameHost, pageHost) => registrableSuffix(frameHost) !== registrableSuffix(pageHost);

  const applyVerdicts = (state, host, items, verdicts, now) => {
    const site = state.sites[host] || emptySite();
    const verdictsById = new Map(verdicts.map((entry) => [entry.id, entry]));
    const result = {};
    // Unanswered items count as content: asking again on every load would only burn budget.
    for (const { id, frame_host: frameHost } of items) {
      const { verdict, confidence = 0 } = verdictsById.get(id) || {};
      const isAd = verdict === 'ad' && confidence >= HIDE_CONFIDENCE;
      result[id] = isAd ? 'ad' : 'content';
      site.verdicts[id] = result[id];
      const canBlock = isAd && confidence >= NETWORK_BLOCK_CONFIDENCE && frameHost && isThirdParty(frameHost, host);
      if (canBlock && !site.domains.includes(frameHost) && site.domains.length < MAX_DOMAINS_PER_SITE) {
        site.domains.push(frameHost);
      }
    }
    const ids = Object.keys(site.verdicts);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VERDICTS_PER_SITE))) delete site.verdicts[id];
    site.updatedAt = now;
    state.sites[host] = site;

    const hosts = Object.keys(state.sites).sort((a, b) => state.sites[b].updatedAt - state.sites[a].updatedAt);
    for (const stale of hosts.slice(MAX_SITES)) delete state.sites[stale];
    return result;
  };

  // Atomic check-and-count, so parallel tabs cannot overrun the budget or send data while off.
  const reserveRequest = (state, host, now) => {
    if (!state.enabled || state.paused[host] || now < state.cooldownUntil) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    if (state.budget.day !== day) state.budget = { day, total: 0, hosts: {} };
    const hostCount = state.budget.hosts[host] || 0;
    if (state.budget.total >= DAILY_REQUEST_LIMIT || hostCount >= DAILY_REQUEST_LIMIT_PER_HOST) return false;
    state.budget.total += 1;
    state.budget.hosts[host] = hostCount + 1;
    return true;
  };

  // WHY: rules are scoped to the site they were learned on. A global rule would let any page
  // get a domain blocked everywhere by showing it in an ad-looking iframe.
  const buildRules = (state) => {
    if (!state.enabled) return [];
    return Object.entries(state.sites)
      .filter(([host, site]) => !state.paused[host] && site.domains.length > 0)
      .map(([host, site], index) => {
        // initiatorDomains also covers subdomains, so a paused subdomain needs an explicit exclusion.
        const pausedSubdomains = Object.keys(state.paused).filter((paused) => paused.endsWith(`.${host}`));
        return {
          id: index + 1,
          priority: 1,
          action: { type: 'block' },
          condition: {
            requestDomains: site.domains,
            initiatorDomains: [host],
            resourceTypes: ['sub_frame'],
            ...(pausedSubdomains.length ? { excludedInitiatorDomains: pausedSubdomains } : {}),
          },
        };
      });
  };

  const install = ({ chrome, fetchBruteJson, errorMessage }) => {
    const readState = async () => ({ ...emptyState(), ...(await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] });

    const syncRules = async (state) => {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id),
        addRules: buildRules(state),
      });
    };

    let queue = Promise.resolve();
    const updateState = (mutate) => {
      const run = queue.then(async () => {
        const state = await readState();
        const result = mutate(state);
        await chrome.storage.local.set({ [STORAGE_KEY]: state });
        await syncRules(state);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    };

    const classify = async ({ host, items }) => {
      if (!await updateState((state) => reserveRequest(state, host, Date.now()))) return { ok: false, skipped: true };
      const { response } = await fetchBruteJson({
        path: CLASSIFY_PATH,
        options: { method: 'POST', body: JSON.stringify({ host, items }) },
      });
      if (!response.ok) throw new Error(response.body?.error || response.bodyText || `Brute HTTP ${response.status}`);
      const verdicts = await updateState((state) => {
        state.error = '';
        return applyVerdicts(state, host, items, response.body?.verdicts || [], Date.now());
      });
      return { ok: true, verdicts };
    };

    const handlers = {
      A2GENT_ADBLOCK_CLASSIFY: (message) => classify(message).catch(async (error) => {
        const detail = errorMessage(error);
        await updateState((state) => {
          state.error = detail;
          state.cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
        });
        return { ok: false, error: detail };
      }),
      A2GENT_ADBLOCK_SET_ENABLED: (message) => updateState((state) => {
        state.enabled = Boolean(message.enabled);
        state.error = '';
        state.cooldownUntil = 0;
      }).then(() => ({ ok: true })),
      A2GENT_ADBLOCK_SET_PAUSED: (message) => updateState((state) => {
        if (message.paused) state.paused[message.host] = true;
        else delete state.paused[message.host];
      }).then(() => ({ ok: true })),
      A2GENT_ADBLOCK_RESET_SITE: (message) => updateState((state) => {
        delete state.sites[message.host];
      }).then(() => ({ ok: true })),
    };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!Object.hasOwn(handlers, message?.type ?? '')) return false;
      const handler = handlers[message.type];
      void handler(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    });
  };

  return { STORAGE_KEY, applyVerdicts, buildRules, install, isThirdParty, emptyState, reserveRequest };
});
