// Finds ad-looking blocks, asks System One about the unknown ones through the service worker,
// and hides confirmed ads. Known verdicts apply from storage without any network call.
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else exported.start(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const STORAGE_KEY = 'a2gent.adapterChrome.adblock';
  const BATCH_SIZE = 10;
  const MAX_REQUESTS_PER_PAGE = 3;
  const SCAN_DELAY_MS = 500;
  const MAX_SCAN_DELAY_MS = 5000;
  const MIN_WIDTH = 60;
  const MIN_HEIGHT = 30;
  const MAX_TEXT = 300;
  const MAX_CLIMB = 6;
  const MAX_SELECTOR_MATCHES = 6;
  const MAX_VIEWPORT_SHARE = 0.7;
  const MAX_BLOCK_TEXT = 600;
  const WRAPPER_TEXT_LIMIT = 200;
  const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.corp', '.home', '.home.arpa', '.intranet', '.test', '.ts.net'];

  const HINT_SELECTOR = [
    'iframe', 'ins.adsbygoogle', '[data-ad-slot]', '[data-google-query-id]', '[id^="google_ads" i]',
    '[id*="banner" i]', '[class*="banner" i]', '[id*="advert" i]', '[class*="advert" i]',
    '[id*="sponsor" i]', '[class*="sponsor" i]', '[class~="ad" i]', '[class~="ads" i]', '[class*="-ad-" i]',
  ].join(',');
  // Page structure and anything the user types into must never disappear with an ad.
  const PROTECTED_SELECTOR = 'main, article, nav, header, footer, h1, form, input, textarea, select, video, [contenteditable], [role=main], [role=navigation], [role=dialog]';
  const PROTECTED_ANCESTORS = 'form, nav, [role=navigation], [role=dialog], [id^="a2gent"]';
  const PROTECTED_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER']);
  const PROBE_POINTS = [[0.5, 0.08], [0.5, 0.5], [0.5, 0.92]];

  const hostOf = (url, base) => {
    // WHY: new URL('', base) returns base, which would report ad-network iframes without src
    // (Google Publisher Tag renders into those) as hosted by the page itself.
    if (!url) return '';
    try {
      const { protocol, hostname } = new URL(url, base);
      return protocol === 'http:' || protocol === 'https:' ? hostname : '';
    } catch {
      return '';
    }
  };

  const isPrivateHost = (rawHost) => {
    const host = rawHost.replace(/\.$/, '');
    return !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
  };

  const siteOf = (host) => host.split('.').slice(-2).join('.');

  const isPinned = (element, win) => ['fixed', 'sticky'].includes(win.getComputedStyle(element).position);

  const isSafeToHide = (element, win) => {
    if (PROTECTED_TAGS.has(element.tagName) || element.querySelector(PROTECTED_SELECTOR)) return false;
    if (element.closest(PROTECTED_ANCESTORS) || element.textContent.length > MAX_BLOCK_TEXT) return false;
    const { width, height } = element.getBoundingClientRect();
    return width * height < win.innerWidth * win.innerHeight * MAX_VIEWPORT_SHARE;
  };

  // Hiding only the iframe leaves an empty slot, so hide the wrapper that exists just for the ad.
  const adContainer = (element, win) => {
    let container = element;
    let node = element.parentElement;
    for (let depth = 0; node && depth < MAX_CLIMB; depth += 1, node = node.parentElement) {
      if (!isSafeToHide(node, win)) break;
      if (isPinned(node, win)) return node;
      const isTight = node.getBoundingClientRect().height <= container.getBoundingClientRect().height * 1.3 + 40;
      if (isTight && node.textContent.trim().length <= WRAPPER_TEXT_LIMIT) container = node;
    }
    return container;
  };

  const isStableToken = (token) => /^[a-zA-Z][\w-]{0,59}$/.test(token) && !/\d{4,}/.test(token);

  const ownSelector = (element) => {
    if (element.id && isStableToken(element.id)) return `#${element.id}`;
    const classes = [...element.classList].filter(isStableToken).slice(0, 3);
    return classes.length ? `${element.tagName.toLowerCase()}.${classes.join('.')}` : '';
  };

  // Only strict tokens reach the selector, so page-controlled names cannot break out of the CSS rule.
  const stableSelector = (element, doc) => {
    const frameHost = element.tagName === 'IFRAME' ? hostOf(element.src, doc.baseURI) : '';
    const selector = ownSelector(element) || (/^[a-z0-9.-]+$/.test(frameHost) ? `iframe[src*="//${frameHost}"]` : '');
    if (!selector) return '';
    const matches = doc.querySelectorAll(selector).length;
    return matches >= 1 && matches <= MAX_SELECTOR_MATCHES ? selector : '';
  };

  const frameOf = (element) => (element.tagName === 'IFRAME' ? element : element.querySelector('iframe'));

  const describe = (element, doc, win) => {
    const rect = element.getBoundingClientRect();
    const frame = frameOf(element);
    const link = element.closest('a[href]') || element.querySelector('a[href]');
    const attrs = [
      element.id && `#${element.id}`,
      ...[...element.classList].map((name) => `.${name}`),
      frame && frame !== element && frame.id && `>#${frame.id}`,
    ].filter(Boolean).join('');
    const frameHost = frame ? hostOf(frame.src, doc.baseURI) : '';
    const linkHost = link ? hostOf(link.href, doc.baseURI) : '';
    const pageSite = siteOf(hostOf(doc.baseURI, doc.baseURI));
    // WHY: blocks that only point back at the site can be private account UI, so their text stays local.
    const leadsElsewhere = [frameHost, linkHost].some((host) => host && siteOf(host) !== pageSite);
    const item = {
      tag: element.tagName.toLowerCase(),
      attrs: attrs.slice(0, 120),
      frame_host: frameHost,
      link_host: linkHost,
      position: win.getComputedStyle(element).position,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: leadsElsewhere ? element.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '',
    };
    const selector = stableSelector(element, doc);
    if (!selector) return { ...item, id: `sig:${item.tag}|${item.attrs}|${frameHost}|${item.width}x${item.height}` };
    // The frame host is part of the id so one class shared by an ad slot and a YouTube embed stays two verdicts.
    return { ...item, id: frameHost ? `${selector}@${frameHost}` : selector };
  };

  const hasSignal = (item, element) => Boolean(item.frame_host || item.link_host || element.querySelector('img, iframe'));

  const isVisible = (element) => {
    const { width, height } = element.getBoundingClientRect();
    return width >= MIN_WIDTH && height >= MIN_HEIGHT;
  };

  const findCandidates = (doc, win) => {
    const seeds = new Set(doc.querySelectorAll(HINT_SELECTOR));
    for (const [x, y] of PROBE_POINTS) {
      for (let node = doc.elementFromPoint?.(win.innerWidth * x, win.innerHeight * y); node; node = node.parentElement) {
        if (isPinned(node, win)) seeds.add(node);
      }
    }
    const containers = new Set();
    for (const seed of seeds) {
      if (isVisible(seed) && isSafeToHide(seed, win)) containers.add(adContainer(seed, win));
    }
    return [...containers].flatMap((element) => {
      const item = describe(element, doc, win);
      return hasSignal(item, element) ? [{ element, item }] : [];
    });
  };

  const hide = (element) => element.style.setProperty('display', 'none', 'important');

  // WHY: a verdict came from one page, but the selector may match different blocks on another
  // page of the site, so the safety checks run again here instead of living in a blanket CSS rule.
  const applyLearned = (doc, win, verdicts) => {
    for (const [id, verdict] of Object.entries(verdicts)) {
      if (verdict !== 'ad' || id.startsWith('sig:')) continue;
      const [selector, frameHost = ''] = id.split('@');
      const matches = [...doc.querySelectorAll(selector)];
      if (matches.length > MAX_SELECTOR_MATCHES) continue;
      for (const element of matches) {
        const frame = frameOf(element);
        const matchesFrame = !frameHost || (frame && hostOf(frame.src, doc.baseURI) === frameHost);
        if (matchesFrame && isSafeToHide(element, win)) hide(element);
      }
    }
  };

  const createScanner = ({ doc, win, verdicts, classify }) => {
    const asked = new Set();
    let requestsLeft = MAX_REQUESTS_PER_PAGE;

    return async () => {
      applyLearned(doc, win, verdicts);
      const unknown = new Map();
      for (const { element, item } of findCandidates(doc, win)) {
        if (verdicts[item.id] === 'ad') hide(element);
        else if (!verdicts[item.id] && !asked.has(item.id)) {
          if (!unknown.has(item.id)) unknown.set(item.id, { item, elements: [] });
          unknown.get(item.id).elements.push(element);
        }
      }
      if (!unknown.size || requestsLeft <= 0) return false;
      requestsLeft -= 1;
      const batch = [...unknown.values()].slice(0, BATCH_SIZE);
      batch.forEach(({ item }) => asked.add(item.id));
      const response = await classify(batch.map(({ item }) => item));
      // WHY: a down Brute, missing Jev key or spent budget will not recover mid-page; stop retrying.
      if (!response?.ok) {
        requestsLeft = 0;
        return false;
      }
      Object.assign(verdicts, response.verdicts);
      batch.filter(({ item }) => response.verdicts[item.id] === 'ad').forEach(({ elements }) => elements.forEach(hide));
      return unknown.size > batch.length;
    };
  };

  const start = (root) => {
    const { chrome, document: doc, location } = root;
    if (root.top !== root || isPrivateHost(location.hostname)) return;
    const host = location.hostname;

    chrome.storage.local.get(STORAGE_KEY, (saved) => {
      const state = saved[STORAGE_KEY];
      if (!state?.enabled || state.paused?.[host]) return;
      const verdicts = { ...state.sites?.[host]?.verdicts };

      const scan = createScanner({
        doc,
        win: root,
        verdicts,
        classify: (items) => chrome.runtime.sendMessage({ type: 'A2GENT_ADBLOCK_CLASSIFY', host, items }).catch(() => null),
      });

      let timer = 0;
      let delay = SCAN_DELAY_MS;
      const schedule = () => {
        if (timer || doc.visibilityState !== 'visible') return;
        timer = root.setTimeout(async () => {
          timer = 0;
          // Busy pages mutate constantly, so back off to keep layout reads cheap.
          delay = Math.min(delay * 1.5, MAX_SCAN_DELAY_MS);
          if (await scan()) schedule();
        }, delay);
      };
      new root.MutationObserver(schedule).observe(doc.documentElement, { childList: true, subtree: true });
      doc.addEventListener('visibilitychange', schedule);
      schedule();
    });
  };

  return { adContainer, applyLearned, createScanner, describe, findCandidates, isPrivateHost, isSafeToHide, stableSelector, start };
});
