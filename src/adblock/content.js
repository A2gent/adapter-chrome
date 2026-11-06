// Watches what the page actually shows, during load and scrolling. Ad-network slots hide at once;
// other ad-looking blocks go to System One through the service worker, and its verdicts are remembered.
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else exported.start(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const STORAGE_KEY = 'a2gent.adapterChrome.adblock';
  const BATCH_SIZE = 10;
  const MAX_REQUESTS_PER_PAGE = 10;
  const SCAN_DELAY_MS = 250;
  const SCROLL_SCAN_DELAY_MS = 750;
  const MAX_SCAN_DELAY_MS = 5000;
  const MIN_WIDTH = 60;
  const MIN_HEIGHT = 30;
  const MAX_TEXT = 300;
  const MAX_CLIMB = 6;
  const MAX_SELECTOR_MATCHES = 6;
  const MAX_VIEWPORT_SHARE = 0.7;
  const MAX_BLOCK_TEXT = 600;
  const MAX_SCANNED_TEXT = 20000;
  const WRAPPER_TEXT_LIMIT = 200;
  const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.corp', '.home', '.home.arpa', '.intranet', '.test', '.ts.net'];

  // These only ever hold ads, so they need no model call and nothing about them leaves the browser.
  const AD_SLOT_SELECTOR = 'iframe[id^="google_ads_iframe"], ins.adsbygoogle';
  const CERTAIN_AD_SELECTOR = `${AD_SLOT_SELECTOR}, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], a[href*="doubleclick.net"], a[href*="googleadservices.com"]`;
  const AD_NETWORK_HOST = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com)$/;
  const X_HOST = /(?:^|\.)(?:x|twitter)\.com$/;
  const FEED_POST = 'article[data-testid="tweet"]';
  const FEED_CELL = '[data-testid="cellInnerDiv"]';
  const AD_CARRIER_SELECTOR = `${CERTAIN_AD_SELECTOR}, ${FEED_POST}`;
  const HINT_SELECTOR = [
    'iframe', 'ins.adsbygoogle', '[data-ad-slot]', '[data-google-query-id]', '[id^="google_ads" i]',
    '[id*="banner" i]', '[class*="banner" i]', '[id*="advert" i]', '[class*="advert" i]',
    '[id*="sponsor" i]', '[class*="sponsor" i]', '[class~="ad" i]', '[class~="ads" i]', '[class*="-ad-" i]',
  ].join(',');
  // Page structure and anything the user types into must never disappear with an ad.
  const PROTECTED_SELECTOR = 'main, article, nav, header, footer, h1, form, input, textarea, select, video, [contenteditable], [role=main], [role=navigation], [role=dialog]';
  const PROTECTED_ANCESTORS = `form, nav, [role=navigation], [role=dialog], [id^="a2gent"], ${FEED_POST}`;
  const PROTECTED_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER']);
  const TOOL_FRAME_HOST = /(?:^|\.)(?:google\.com|gstatic\.com|recaptcha\.net|hcaptcha\.com|cloudflare\.com|youtube\.com|youtube-nocookie\.com|vimeo\.com|stripe\.com|paypal\.com)$/;
  const AD_NAME = /(?:^|[\s_-])(?:ads?|dfp)(?:[\s_-]|$)/i;
  const AD_FREE_NAME = /(?:no|non|with|without|has)[-_]ads?\b|\bads?[-_]free/i;
  const PROBE_STOPS = [0.08, 0.3, 0.5, 0.7, 0.92];
  const WATCHED_ATTRIBUTES = ['style', 'class', 'src', 'hidden', 'width', 'height'];

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

  // WHY: textContent includes inline <style> and <script>, which made ad slots look like long articles.
  const visibleText = (element) => {
    let text = element.textContent;
    if (text.length > MAX_SCANNED_TEXT) return text;
    for (const code of element.querySelectorAll('style, script')) text = text.replace(code.textContent, '');
    return text.replace(/\s+/g, ' ').trim();
  };

  const isSafeToHide = (element, win) => {
    if (PROTECTED_TAGS.has(element.tagName) || element.querySelector(PROTECTED_SELECTOR)) return false;
    if (element.closest(PROTECTED_ANCESTORS) || visibleText(element).length > MAX_BLOCK_TEXT) return false;
    const { width, height } = element.getBoundingClientRect();
    return width * height < win.innerWidth * win.innerHeight * MAX_VIEWPORT_SHARE;
  };

  // WHY: slots reserve their height before the creative loads, so a still-empty frame looks far smaller than its wrapper.
  const isEmptyShell = (node) => !visibleText(node) && node.querySelectorAll('iframe, img, video, canvas, svg').length <= 1;

  // An ad wrapper often also holds its close button and a backup image, which the checks above reject.
  const isAdNamed = (node) => {
    const name = `${node.id} ${node.getAttribute('class') || ''}`;
    return AD_NAME.test(name) && !AD_FREE_NAME.test(name);
  };

  // Hiding only the iframe leaves an empty slot, so hide the wrapper that exists just for the ad.
  const adContainer = (element, win, certain = false) => {
    let container = element;
    let node = element.parentElement;
    for (let depth = 0; node && depth < MAX_CLIMB; depth += 1, node = node.parentElement) {
      if (!isSafeToHide(node, win)) break;
      if (isPinned(node, win)) return node;
      const isTight = node.getBoundingClientRect().height <= container.getBoundingClientRect().height * 1.3 + 40;
      if (isTight && visibleText(node).length <= WRAPPER_TEXT_LIMIT) container = node;
      else if (certain && (isEmptyShell(node) || isAdNamed(node))) container = node;
      else if (certain) break;
    }
    return container;
  };

  // Random per-load names like dfp-vo4k67ukc7 would make every visit look like a new block.
  const isStableToken = (token) => /^[a-zA-Z][\w-]{0,59}$/.test(token) && !/\d{4,}|\d[a-z]{1,2}\d/i.test(token.replace(/\d+x\d+/g, ''));

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
      // WHY: only the link's own words, because the block around it can be private, like a webmail thread.
      text: leadsElsewhere ? visibleText(link || element).slice(0, MAX_TEXT) : '',
    };
    const selector = stableSelector(element, doc);
    if (!selector) return { ...item, id: `sig:${item.tag}|${item.attrs}|${frameHost}|${item.width}x${item.height}` };
    // The frame host is part of the id so one class shared by an ad slot and a YouTube embed stays two verdicts.
    return { ...item, id: frameHost ? `${selector}@${frameHost}` : selector };
  };

  const hasSignal = (item, element) => Boolean(item.frame_host || item.link_host || element.querySelector('img, iframe'));

  // WHY: small local models call these ads with high confidence, and a block rule would then break
  // captcha, video or checkout. A site's own subdomain frames are its offers and infographics.
  const isTrustedFrame = (item, doc) => {
    const pageSite = siteOf(hostOf(doc.baseURI, doc.baseURI));
    if (TOOL_FRAME_HOST.test(item.frame_host)) return true;
    return Boolean(item.frame_host) && [item.frame_host, item.link_host].every((host) => !host || siteOf(host) === pageSite);
  };

  const isVisible = (element) => {
    const { width, height } = element.getBoundingClientRect();
    return width >= MIN_WIDTH && height >= MIN_HEIGHT;
  };

  const isOnScreen = (element, win) => {
    const { top, bottom } = element.getBoundingClientRect();
    return bottom > 0 && top < win.innerHeight;
  };

  const leadsOffSite = (link, doc) => {
    const host = hostOf(link.href, doc.baseURI);
    return Boolean(host) && siteOf(host) !== siteOf(hostOf(doc.baseURI, doc.baseURI));
  };

  // Class names lie, so also look at what is painted on screen: pinned bars and image links to other sites.
  const findOnScreen = (doc, win) => {
    const found = new Set();
    const seen = new Set();
    for (const y of PROBE_STOPS) {
      for (const x of PROBE_STOPS) {
        const top = doc.elementFromPoint?.(win.innerWidth * x, win.innerHeight * y);
        const link = top?.closest('a[href]');
        if (link?.querySelector('img') && leadsOffSite(link, doc)) found.add(link);
        for (let node = top; node && !seen.has(node); node = node.parentElement) {
          seen.add(node);
          if (isPinned(node, win)) found.add(node);
        }
      }
    }
    return found;
  };

  const findCandidates = (doc, win) => {
    const seeds = new Set([...doc.querySelectorAll(HINT_SELECTOR), ...findOnScreen(doc, win)]);
    const containers = new Set();
    for (const seed of seeds) {
      if (isVisible(seed) && isSafeToHide(seed, win)) containers.add(adContainer(seed, win));
    }
    return [...containers]
      .flatMap((element) => {
        const item = describe(element, doc, win);
        return hasSignal(item, element) && !isTrustedFrame(item, doc) ? [{ element, item }] : [];
      })
      .sort((a, b) => isOnScreen(b.element, win) - isOnScreen(a.element, win));
  };

  const hide = (element) => element.style.setProperty('display', 'none', 'important');

  // WHY: X's ad label is a plain translated span, but a promoted post is the only one without a
  // timestamp. Counting per author keeps a timestamp inside a quoted post from masking the ad,
  // and an opened post, whose time sits below its header, still has one of each.
  const isPromotedPost = (post) => post.querySelectorAll('time').length < post.querySelectorAll('[data-testid="User-Name"]').length;

  const promotedCells = new WeakSet();

  // The whole cell goes, because the feed closes the gap only when the cell itself loses its height.
  // The feed may reuse a cell for another post, so a hidden one is released once it stops being an ad.
  const hidePromotedPosts = (doc) => {
    if (!X_HOST.test(doc.location.hostname)) return;
    for (const cell of doc.querySelectorAll(FEED_CELL)) {
      const post = cell.querySelector(FEED_POST);
      if (post && isPromotedPost(post)) {
        hide(cell);
        promotedCells.add(cell);
      } else if (promotedCells.delete(cell)) cell.style.removeProperty('display');
    }
  };

  // WHY: Facebook's ad label is translated and its classes are obfuscated, but every ad links to
  // its ad-info page, and the sidebar ad block sits right under a "Реклама"/"Sponsored" heading.
  const FACEBOOK_HOST = /(?:^|\.)facebook\.com$/;
  const FACEBOOK_AD_LINK = 'a[href*="/ads/about"]';
  const FACEBOOK_FEED_UNIT = '[data-pagelet^="FeedUnit_"]';
  const FACEBOOK_SIDEBAR_LABEL = /^(?:Реклама|Sponsored)$/;
  const FACEBOOK_REDIRECT_LINK = 'a[href*="l.facebook.com/l.php"]';
  const SIDEBAR_CLIMB = 12;

  const hideFacebookAds = (doc) => {
    if (!FACEBOOK_HOST.test(doc.location.hostname)) return;
    for (const link of doc.querySelectorAll(FACEBOOK_AD_LINK)) {
      const unit = link.closest(FACEBOOK_FEED_UNIT) || link.closest('[role="article"]');
      if (unit && !unit.querySelector('[role="feed"]')) hide(unit);
    }
    for (const heading of doc.querySelectorAll('h3')) {
      if (!FACEBOOK_SIDEBAR_LABEL.test(heading.textContent.trim())) continue;
      let block = heading;
      for (let depth = 0; block && depth < SIDEBAR_CLIMB && !block.querySelector(FACEBOOK_REDIRECT_LINK); depth += 1) block = block.parentElement;
      if (block?.querySelector(FACEBOOK_REDIRECT_LINK) && !block.querySelector('[role="feed"], form, input')) hide(block);
    }
  };

  // WHY: YouTube recycles feed cells for other videos, and a CSS rule lets go of them by itself.
  const YOUTUBE_HOST = /(?:^|\.)youtube\.com$/;
  const YOUTUBE_AD_CSS = `${[
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-engagement-panel-section-list-renderer:has(ytd-ads-engagement-panel-content-renderer)',
    'ytm-promoted-sparkles-web-renderer',
    'ytm-companion-ad-renderer',
    'ad-slot-renderer',
    '#masthead-ad',
    '#player-ads',
    '.ytp-ad-overlay-container',
    '.ytp-ad-image-overlay',
  ].join(',')}{display:none!important}`;
  // The ad-created class also sits on players showing the film, so only ad-showing means an ad is on.
  const YOUTUBE_AD_PLAYER = '.html5-video-player.ad-showing';
  const YOUTUBE_AD_RATE = 16;
  const YOUTUBE_AD_POLL_MS = 250;

  // WHY: a video ad plays in the film's own <video>, so it cannot be hidden. It is sped up rather
  // than seeked to its end: an ad stitched into the stream shares the film's timeline, and a seek
  // there would jump past the film. The Skip button is left alone: it ignored scripted clicks when
  // tried on live ads. The poll covers the next ad in a row, which resets the rate.
  const createYoutubeAdSkipper = (doc, win) => {
    let saved = null;
    let timer = 0;

    const release = () => {
      win.clearInterval(timer);
      timer = 0;
      if (!saved) return;
      saved.video.muted = saved.muted;
      saved.video.playbackRate = saved.rate;
      saved = null;
    };

    const skip = () => {
      const player = doc.querySelector(YOUTUBE_AD_PLAYER);
      const video = player?.querySelector('video');
      if (!video) {
        release();
        return;
      }
      saved ||= { video, muted: video.muted, rate: video.playbackRate };
      timer ||= win.setInterval(skip, YOUTUBE_AD_POLL_MS);
      video.muted = true;
      video.playbackRate = YOUTUBE_AD_RATE;
    };

    return skip;
  };

  const blockYoutubeAds = (doc, win) => {
    const style = doc.createElement('style');
    style.textContent = YOUTUBE_AD_CSS;
    (doc.head || doc.documentElement).append(style);
    return createYoutubeAdSkipper(doc, win);
  };

  const certainHides = new Map();

  const isCertainAd = (element, win) => {
    if (element.matches(AD_SLOT_SELECTOR)) return true;
    if (!AD_NETWORK_HOST.test(hostOf(element.href || element.src, element.baseURI))) return false;
    if (element.tagName === 'A') return Boolean(element.querySelector('img'));
    // Zero-size frames are invisible trackers: nothing to hide, and their parent is real content.
    const { width, height } = element.getBoundingClientRect();
    return width > 1 && height > 1;
  };

  // WHY: while the page is still parsing, every parent looks empty, so climbing could hide the whole
  // site. The same goes for feeds filled later, so wrappers are rechecked and released when they fill up.
  // Size limits stay off for the slot itself: a full-screen interstitial is exactly what must go.
  const hideCertainAds = (doc, win) => {
    hidePromotedPosts(doc);
    hideFacebookAds(doc);
    const parsing = doc.readyState === 'loading';
    for (const element of doc.querySelectorAll(CERTAIN_AD_SELECTOR)) {
      if (certainHides.has(element) || element.closest(PROTECTED_ANCESTORS) || !isCertainAd(element, win)) continue;
      if (!parsing) certainHides.set(element, element.tagName === 'A' ? element : adContainer(element, win, true));
      hide(element);
    }
    for (const [element, wrapper] of certainHides) {
      if (!element.isConnected) certainHides.delete(element);
      else if (wrapper === element || isSafeToHide(wrapper, win)) hide(wrapper);
      else {
        wrapper.style.removeProperty('display');
        certainHides.set(element, element);
      }
    }
  };

  const addsCertainAd = ({ addedNodes }) => [...addedNodes].some((node) => node.nodeType === 1 && (node.matches(AD_CARRIER_SELECTOR) || node.querySelector(AD_CARRIER_SELECTOR)));

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
    let waiting = false;

    return async () => {
      hideCertainAds(doc, win);
      if (doc.readyState === 'loading') return false;
      applyLearned(doc, win, verdicts);
      const unknown = new Map();
      for (const { element, item } of findCandidates(doc, win)) {
        if (verdicts[item.id] === 'ad') hide(element);
        else if (!verdicts[item.id] && !asked.has(item.id)) {
          if (!unknown.has(item.id)) unknown.set(item.id, { item, elements: [] });
          unknown.get(item.id).elements.push(element);
        }
      }
      // WHY: a local model answers one request at a time, so parallel scans would only queue up behind it.
      if (!unknown.size || requestsLeft <= 0 || waiting) return false;
      requestsLeft -= 1;
      waiting = true;
      const batch = [...unknown.values()].slice(0, BATCH_SIZE);
      batch.forEach(({ item }) => asked.add(item.id));
      const response = await classify(batch.map(({ item }) => item)).catch(() => null).finally(() => { waiting = false; });
      // WHY: a down Brute, missing Jev key or spent budget will not recover mid-page; stop retrying.
      if (!response?.ok) {
        requestsLeft = 0;
        return false;
      }
      Object.assign(verdicts, response.verdicts);
      batch.filter(({ item }) => response.verdicts[item.id] === 'ad').forEach(({ elements }) => elements.forEach(hide));
      return true;
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
      const skipYoutubeAd = YOUTUBE_HOST.test(host) ? blockYoutubeAds(doc, root) : null;

      const scan = createScanner({
        doc,
        win: root,
        verdicts,
        classify: async (items) => chrome.runtime.sendMessage({ type: 'A2GENT_ADBLOCK_CLASSIFY', host, items }),
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
      // The user is looking at new content now, so a backed-off timer must not delay the scan.
      const scheduleSoon = () => {
        if (delay > SCROLL_SCAN_DELAY_MS) {
          root.clearTimeout(timer);
          timer = 0;
          delay = SCROLL_SCAN_DELAY_MS;
        }
        schedule();
      };
      new root.MutationObserver((mutations) => {
        skipYoutubeAd?.();
        if (mutations.some(addsCertainAd)) hideCertainAds(doc, root);
        schedule();
      }).observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
      root.addEventListener('scroll', scheduleSoon, { passive: true, capture: true });
      root.addEventListener('resize', scheduleSoon, { passive: true });
      doc.addEventListener('DOMContentLoaded', scheduleSoon);
      root.addEventListener('load', scheduleSoon);
      doc.addEventListener('visibilitychange', scheduleSoon);
      hideCertainAds(doc, root);
      schedule();
    });
  };

  return { adContainer, applyLearned, createScanner, createYoutubeAdSkipper, describe, findCandidates, hideCertainAds, isPrivateHost, isSafeToHide, stableSelector, start };
});
