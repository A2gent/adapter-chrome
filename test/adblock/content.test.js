const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { adContainer, applyLearned, createScanner, findCandidates, hideCertainAds, isPrivateHost, isSafeToHide, stableSelector, start } = require('../../src/adblock/content.js');

const page = (body, url = 'https://news.ee/') => {
  const { window } = new JSDOM(`<!doctype html><body>${body}</body>`, { url, pretendToBeVisual: true });
  Object.defineProperty(window, 'innerWidth', { value: 1000 });
  Object.defineProperty(window, 'innerHeight', { value: 800 });
  window.Element.prototype.getBoundingClientRect = function rect() {
    if (this.closest('[style*="display: none"]')) return { width: 0, height: 0, top: 0, bottom: 0 };
    const top = Number(this.dataset.top ?? 0);
    const height = Number(this.dataset.h ?? 100);
    return { width: Number(this.dataset.w ?? 300), height, top, bottom: top + height };
  };
  Object.defineProperty(window.document, 'readyState', { value: 'complete', configurable: true });
  return { doc: window.document, win: window };
};

test('climbs to the wrapper of an ad frame but not into the article around it', () => {
  const { doc, win } = page(`
    <article id="story"><p>${'text '.repeat(100)}</p>
      <div id="slot-wrap" data-h="110"><iframe id="frame" src="https://ads.net/x" data-h="100"></iframe></div>
    </article>`);
  assert.equal(adContainer(doc.getElementById('frame'), win).id, 'slot-wrap');
});

test('prefers the pinned wrapper so a sticky bar disappears with its close button', () => {
  const { doc, win } = page(`
    <div id="bar" style="position:fixed" data-h="60"><div id="inner" data-h="500"><iframe id="frame" src="https://ads.net/x" data-h="50"></iframe></div><button>x</button></div>`);
  assert.equal(adContainer(doc.getElementById('frame'), win).id, 'bar');
});

test('page structure, forms and huge in-flow blocks are never hidden', () => {
  const { doc, win } = page(`
    <div id="login" class="banner"><input></div>
    <div id="huge" data-w="1000" data-h="800"></div>
    <div id="a2gent-browser-adapter-root"><div id="own" class="banner"></div></div>
    <div id="ok"></div>`);
  assert.equal(isSafeToHide(doc.getElementById('login'), win), false);
  assert.equal(isSafeToHide(doc.getElementById('huge'), win), false);
  assert.equal(isSafeToHide(doc.getElementById('own'), win), false);
  assert.equal(isSafeToHide(doc.body, win), false);
  assert.equal(isSafeToHide(doc.getElementById('ok'), win), true);
});

test('a pinned app shell or long sticky sidebar is not taken for an ad wrapper', () => {
  const { doc, win } = page(`
    <div id="shell" style="position:fixed" data-w="1000" data-h="800"><iframe id="a" src="https://ads.net/x"></iframe></div>
    <aside id="toc" style="position:sticky">${'chapter '.repeat(100)}<iframe id="b" src="https://ads.net/y"></iframe></aside>`);
  assert.equal(adContainer(doc.getElementById('a'), win).id, 'a');
  assert.equal(adContainer(doc.getElementById('b'), win).id, 'b');
});

test('a payment iframe inside a form is never a candidate', () => {
  const { doc, win } = page('<form><div class="banner"><iframe src="https://js.stripe.com/x"></iframe></div></form>');
  assert.deepEqual(findCandidates(doc, win), []);
});

test('selectors skip generated names and reject rules that match too much', () => {
  const { doc } = page(`
    <div id="div-gpt-ad-1712345678-0" class="ad-slot"></div>
    <iframe id="google_ads_iframe_12345" src="https://ads.net/x"></iframe>
    ${'<p class="common"></p>'.repeat(10)}`);
  assert.equal(stableSelector(doc.querySelector('.ad-slot'), doc), 'div.ad-slot');
  const random = page('<div id="dfp-vo4k67ukc7"></div>').doc;
  assert.equal(stableSelector(random.querySelector('div'), random), '');
  const sized = page('<div id="ad-300x250"></div>').doc;
  assert.equal(stableSelector(sized.querySelector('div'), sized), '#ad-300x250');
  assert.equal(stableSelector(doc.querySelector('iframe'), doc), 'iframe[src*="//ads.net"]');
  assert.equal(stableSelector(doc.querySelector('.common'), doc), '');
});

test('a learned selector re-checks safety on every page of the site', () => {
  const { doc, win } = page(`
    <div id="slot" class="promo"></div>
    <div class="promo"><input></div>`);
  applyLearned(doc, win, { 'div.promo': 'ad' });
  assert.equal(doc.getElementById('slot').style.display, 'none');
  assert.equal(doc.querySelector('input').parentElement.style.display, '');

  const crowded = page('<div class="promo"></div>'.repeat(10));
  applyLearned(crowded.doc, crowded.win, { 'div.promo': 'ad' });
  assert.equal(crowded.doc.querySelector('.promo').style.display, '');
});

test('one class shared by an ad and an embed stays two separate verdicts', async () => {
  const { doc, win } = page(`
    <div id="ad" class="slot" data-w="300"><iframe src="https://ads.net/x"></iframe></div>
    <div id="video" class="slot" data-w="301"><iframe src="https://player.tv.ee/embed/1"></iframe></div>`);
  doc.getElementById('ad').removeAttribute('id');
  doc.getElementById('video').removeAttribute('id');
  const asked = [];
  const scan = createScanner({
    doc,
    win,
    verdicts: {},
    classify: async (items) => {
      asked.push(...items.map((item) => item.id));
      return { ok: true, verdicts: { 'div.slot@ads.net': 'ad', 'div.slot@player.tv.ee': 'content' } };
    },
  });
  await scan();
  assert.deepEqual(asked.sort(), ['div.slot@ads.net', 'div.slot@player.tv.ee']);
  const [adBlock, videoBlock] = doc.querySelectorAll('.slot');
  assert.equal(adBlock.style.display, 'none');
  assert.equal(videoBlock.style.display, '');

  applyLearned(doc, win, { 'div.slot@ads.net': 'ad' });
  assert.equal(videoBlock.style.display, '');
});

test('page-controlled names cannot inject CSS through a learned selector', () => {
  const { doc } = page('<div id="x}body{display:none" class="y{}"></div>');
  assert.equal(stableSelector(doc.querySelector('div'), doc), '');
});

test('candidates describe hosts without URL paths or query strings', () => {
  const { doc, win } = page('<div class="banner"><a href="https://shop.ee/p?user=42"><iframe src="https://ads.net/creative?id=7"></iframe></a></div>');
  const [{ item }] = findCandidates(doc, win);
  assert.equal(item.frame_host, 'ads.net');
  assert.equal(item.link_host, 'shop.ee');
  assert.doesNotMatch(JSON.stringify(item), /user=42|creative/);
});

test('ad-network iframes without src keep their wrapper as the target and report no host', () => {
  const { doc, win } = page(`
    <div id="mm" data-h="9000"><main>${'news '.repeat(100)}</main>
      <div class="dfp-ad dfp-ad--super-sitehat dfp-ad--rendered" data-w="900" data-h="400">
        <div id="dfp-super-sitehat" class="dfp-ad__ad" data-w="900" data-h="400">
          <div id="google_ads_iframe_/82349501/13/213_0__container__" data-w="900" data-h="400">
            <iframe id="google_ads_iframe_/82349501/13/213_0" data-w="900" data-h="400"></iframe>
          </div>
        </div>
      </div>
    </div>`);
  const [{ element, item }] = findCandidates(doc, win);
  assert.equal(element.className, 'dfp-ad dfp-ad--super-sitehat dfp-ad--rendered');
  assert.equal(item.id, 'div.dfp-ad.dfp-ad--super-sitehat.dfp-ad--rendered');
  assert.equal(item.frame_host, '');
  assert.match(item.attrs, /google_ads_iframe/);
});

test('text stays local unless the block leads to another site', () => {
  const { doc, win } = page(`
    <div class="banner"><a href="https://news.ee/account">Balance 1200 EUR</a></div>
    <div class="banner"><a href="https://shop.ee/deal">Sale today</a></div>`);
  const texts = findCandidates(doc, win).map(({ item }) => item.text);
  assert.deepEqual(texts, ['', 'Sale today']);
});

test('scanner uses stored verdicts without asking and asks once about unknown blocks', async () => {
  const { doc, win } = page(`
    <div id="known" class="banner"><a href="/a">Known ad</a></div>
    <div id="kept" class="banner"><a href="/b">Own promo</a></div>
    <div id="fresh" class="banner"><a href="/c">New ad</a></div>`);
  const calls = [];
  const scan = createScanner({
    doc,
    win,
    verdicts: { '#known': 'ad', '#kept': 'content' },
    classify: async (items) => {
      calls.push(items.map((item) => item.id));
      return { ok: true, verdicts: { '#fresh': 'ad' } };
    },
  });
  await scan();
  await scan();
  assert.deepEqual(calls, [['#fresh']]);
  assert.equal(doc.getElementById('known').style.display, 'none');
  assert.equal(doc.getElementById('fresh').style.display, 'none');
  assert.equal(doc.getElementById('kept').style.display, '');
});

test('scanner stops calling Brute after a failure', async () => {
  const { doc, win } = page('<div id="one" class="banner"><a href="/a">A</a></div>');
  let calls = 0;
  const scan = createScanner({ doc, win, verdicts: {}, classify: async () => { calls += 1; return { ok: false }; } });
  await scan();
  doc.body.insertAdjacentHTML('beforeend', '<div id="two" class="banner"><a href="/b">B</a></div>');
  await scan();
  assert.equal(calls, 1);
  assert.equal(doc.getElementById('one').style.display, '');
});

test('an ad-network slot hides with its wrapper without asking the model, even before the creative has a size', async () => {
  const { doc, win } = page(`
    <div id="mm" data-h="9000">${'news '.repeat(200)}
      <div id="slot" class="dfp-ad dfp-ad--horizontal" data-h="464">
        <div id="dfp-vo4k67ukc7" data-h="400"><iframe id="google_ads_iframe_/82349501/13/662_0" data-h="0"></iframe></div>
      </div>
    </div>`);
  let calls = 0;
  const scan = createScanner({ doc, win, verdicts: {}, classify: async () => { calls += 1; return { ok: true, verdicts: {} }; } });
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('slot').style.display, 'none');
  await scan();
  assert.equal(calls, 0);
});

test('an ad wrapper goes together with its close button and backup image', () => {
  const { doc, win } = page(`
    <div id="mm" data-h="9000">${'news '.repeat(200)}
      <div id="outer" class="dfp-ad dfp-ad--super-sitehat" data-h="400">
        <div id="dfp-super-sitehat" class="dfp-ad__ad" data-h="400">
          <style>${'#fixed { height: 100px; } '.repeat(60)}</style>
          <span class="dfp-ad__close">close</span>
          <a href="https://shop.ee"><img src="/x.png"></a>
          <div data-h="345"><iframe id="google_ads_iframe_/1/2_0" data-h="345"></iframe></div>
        </div>
      </div>
      <div id="add-to-cart" data-h="400"><iframe src="https://pay.ee/x"></iframe><img src="/y.png"></div>
    </div>`);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('outer').style.display, 'none');
  assert.equal(adContainer(doc.querySelector('#add-to-cart iframe'), win).tagName, 'IFRAME');
});

test('only image links whose real host is an ad network count as certain ads', () => {
  const { doc, win } = page(`
    <a id="bar" style="position:fixed" href="https://adclick.g.doubleclick.net/pcs/click?x=1"><img src="/kala.png"></a>
    <p id="para">Read more <a id="word" href="https://ad.doubleclick.net/x">Buy it here</a></p>
    <a id="story" href="https://news.ee/out?u=https://ad.doubleclick.net/x"><img src="/s.png"></a>`);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('bar').style.display, 'none');
  for (const id of ['para', 'word', 'story']) assert.equal(doc.getElementById(id).style.display, '', id);
});

test('an ad at the top of a page still being parsed never takes the page with it', async () => {
  const { doc, win } = page('<div id="page"><div id="slot"><ins class="adsbygoogle"></ins></div></div>');
  Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true });
  const scan = createScanner({ doc, win, verdicts: {}, classify: async () => ({ ok: true, verdicts: {} }) });
  await scan();
  assert.equal(doc.querySelector('ins').style.display, 'none');
  assert.equal(doc.getElementById('page').style.display, '');

  doc.getElementById('page').insertAdjacentHTML('beforeend', `<main>${'news '.repeat(300)}</main>`);
  Object.defineProperty(doc, 'readyState', { value: 'complete', configurable: true });
  await scan();
  assert.equal(doc.getElementById('page').style.display, '');
  assert.equal(doc.getElementById('slot').style.display, 'none');
});

test('a wrapper is released when the page fills it with real content later', () => {
  const { doc, win } = page(`<div id="mm" data-h="9000">${'news '.repeat(200)}<div id="feed"><ins class="adsbygoogle"></ins></div></div>`);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('feed').style.display, 'none');
  doc.getElementById('feed').insertAdjacentHTML('beforeend', `<article>${'story '.repeat(200)}</article>`);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('feed').style.display, '');
  assert.equal(doc.querySelector('ins').style.display, 'none');
});

test('an ad the page shows again is hidden again', () => {
  const { doc, win } = page(`<div id="mm" data-h="9000">${'news '.repeat(200)}<div id="slot"><ins class="adsbygoogle"></ins></div></div>`);
  hideCertainAds(doc, win);
  doc.getElementById('slot').style.display = 'block';
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('slot').style.display, 'none');
});

test('climbing stops at the first wrapper that is not just for the ad', () => {
  const { doc, win } = page(`
    <div id="mm" data-h="9000">${'news '.repeat(200)}
      <div id="gallery" class="gallery with-ads" data-h="900"><img src="/1.png"><img src="/2.png">
        <div id="middle" data-h="900"><img src="/3.png"><img src="/4.png"><div id="own"><ins class="adsbygoogle"></ins></div></div>
      </div>
      <div id="far" class="dfp-ad" data-h="900"><img src="/5.png"><img src="/6.png"><div id="gap" data-h="900"><img src="/7.png"><img src="/8.png"><ins class="adsbygoogle" data-h="50"></ins></div></div>
    </div>`);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('own').style.display, 'none');
  for (const id of ['gallery', 'middle', 'far', 'gap']) assert.equal(doc.getElementById(id).style.display, '', id);
});

test('an invisible tracker frame leaves the bar around it alone', () => {
  const { doc, win } = page('<div id="bar" data-h="36">Free shipping<iframe src="https://td.doubleclick.net/x" data-w="0" data-h="0"></iframe></div>');
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('bar').style.display, '');
});

test('only the words of a link are sent, not the private block around it', () => {
  const { doc, win } = page('<div class="banner" data-h="100">Dear Art, your diagnosis is ready <a href="https://shop.ee/x"><img src="/l.png">Shop</a></div>');
  assert.equal(findCandidates(doc, win)[0].item.text, 'Shop');
});

test('a rejected classifier call does not stop later scans', async () => {
  const { doc, win } = page('<div id="one" class="banner"><a href="/a">A</a></div>');
  let calls = 0;
  const scan = createScanner({ doc, win, verdicts: {}, classify: async () => { calls += 1; throw new Error('context invalidated'); } });
  assert.equal(await scan(), false);
  assert.equal(calls, 1);
});

test('an ad slot added while scrolling is caught by the next scan', async () => {
  const { doc, win } = page('<p>news</p>');
  const scan = createScanner({ doc, win, verdicts: {}, classify: async () => ({ ok: true, verdicts: {} }) });
  await scan();
  doc.body.insertAdjacentHTML('beforeend', '<div id="late"><ins class="adsbygoogle"></ins></div>');
  await scan();
  assert.equal(doc.getElementById('late').style.display, 'none');
});

test('an image link to another site is found on screen whatever its class names say', () => {
  const { doc, win } = page('<a id="promo" class="card" href="https://shop.ee/deal"><img src="/x.png"></a>');
  doc.elementFromPoint = () => doc.querySelector('img');
  assert.deepEqual(findCandidates(doc, win).map(({ item }) => item.link_host), ['shop.ee']);
});

test('blocks the user can see are asked about before those further down', () => {
  const { doc, win } = page(`
    <div class="banner" data-top="5000"><a href="https://far.ee/x">far</a></div>
    <div class="banner" data-top="100"><a href="https://near.ee/x">near</a></div>`);
  assert.deepEqual(findCandidates(doc, win).map(({ item }) => item.link_host), ['near.ee', 'far.ee']);
});

test('frames from the site itself never reach the model', () => {
  const { doc, win } = page(`
    <div class="tp-banner"><iframe src="https://vx.news.ee/offer"></iframe></div>
    <div class="tp-banner"><iframe src="https://ads.net/x"></iframe></div>`);
  assert.deepEqual(findCandidates(doc, win).map(({ item }) => item.frame_host), ['ads.net']);
});

test('captcha, video and payment frames never reach the model', () => {
  const { doc, win } = page(`
    <div class="grecaptcha-badge" style="position:fixed"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>
    <div class="banner"><iframe src="https://www.youtube.com/embed/1"></iframe></div>
    <div class="banner"><iframe src="https://js.stripe.com/v3"></iframe></div>
    <div class="banner"><iframe src="https://notgoogle.com/x"></iframe></div>`);
  assert.deepEqual(findCandidates(doc, win).map(({ item }) => item.frame_host), ['notgoogle.com']);
});

test('a scan does not send a second request while the model is still answering', async () => {
  const { doc, win } = page('<div id="one" class="banner"><a href="/a">A</a></div>');
  let calls = 0;
  let answer;
  const scan = createScanner({ doc, win, verdicts: {}, classify: () => { calls += 1; return new Promise((resolve) => { answer = resolve; }); } });
  const first = scan();
  doc.body.insertAdjacentHTML('beforeend', '<div id="two" class="banner"><a href="/b">B</a></div>');
  assert.equal(await scan(), false);
  assert.equal(calls, 1);
  answer({ ok: true, verdicts: {} });
  assert.equal(await first, true);
  void scan();
  assert.equal(calls, 2);
});

const author = (time = '') => `<div data-testid="User-Name"><a href="/someone">Someone</a>${time}</div>`;
const stamp = '<time datetime="2026-11-04"></time>';
const post = (id, inner) => `<div id="${id}" data-testid="cellInnerDiv"><article data-testid="tweet">${inner}</article></div>`;

test('X promoted posts hide in any language, real posts stay', () => {
  const { doc, win } = page(`
    ${post('ad', `${author()}<span>Реклама</span>`)}
    ${post('ad-quoting', `${author()}<span>Ad</span><div role="link">${author(stamp)}</div>`)}
    ${post('regular', author(stamp))}
    ${post('quoting', `${author(stamp)}<div role="link">${author(stamp)}</div>`)}
    ${post('opened', `${author()}<a href="/someone/status/1">${stamp}</a>`)}
    ${post('tombstone', 'This post is unavailable')}
    <div id="spacer" data-testid="cellInnerDiv"></div>`, 'https://x.com/home');
  hideCertainAds(doc, win);
  for (const id of ['ad', 'ad-quoting']) assert.equal(doc.getElementById(id).style.display, 'none', id);
  for (const id of ['regular', 'quoting', 'opened', 'tombstone', 'spacer']) assert.equal(doc.getElementById(id).style.display, '', id);
});

test('a feed cell reused for a real post comes back', () => {
  const { doc, win } = page(post('cell', author()), 'https://twitter.com/home');
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('cell').style.display, 'none');
  doc.querySelector('[data-testid="User-Name"]').insertAdjacentHTML('beforeend', stamp);
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('cell').style.display, '');
});

test('a promoted post loaded while scrolling hides before the next scan timer', async () => {
  const { doc, win } = page('<div id="feed"></div>', 'https://x.com/home');
  win.chrome = { storage: { local: { get: (_key, done) => done({ 'a2gent.adapterChrome.adblock': { enabled: true } }) } } };
  start(win);
  doc.getElementById('feed').insertAdjacentHTML('beforeend', post('late', author()));
  await Promise.resolve();
  assert.equal(doc.getElementById('late').style.display, 'none');
  win.close();
});

test('the same markup on another site is left alone', () => {
  const { doc, win } = page(post('cell', author()));
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('cell').style.display, '');
});

test('link cards inside X posts never reach the model or a learned selector', () => {
  const { doc, win } = page(post('cell', `${author(stamp)}<div id="card" class="banner"><a href="https://shop.ee/x"><img src="/x.png">Read</a></div>`), 'https://x.com/home');
  assert.deepEqual(findCandidates(doc, win), []);
  applyLearned(doc, win, { '#card': 'ad' });
  assert.equal(doc.getElementById('card').style.display, '');
});

test('Facebook feed and sidebar ads hide in any language, real posts and friend requests stay', () => {
  const { doc, win } = page(`
    <div role="feed">
      <div id="ad-feed" data-pagelet="FeedUnit_1"><div role="article"><a href="/ads/about/?x=1">Реклама</a><a href="https://shop.ee/x">Buy</a></div></div>
      <div id="ad-en" data-pagelet="FeedUnit_2"><div role="article"><a href="/ads/about/">Sponsored</a></div></div>
      <div id="post" data-pagelet="FeedUnit_3"><div role="article"><a href="/someone/posts/1">Hi</a></div></div>
    </div>
    <div><div id="ad-side"><h3>Реклама</h3><a href="https://l.facebook.com/l.php?u=x">Buy 2</a></div>
      <div id="friends"><h3>Запросы на добавление в друзья</h3><a href="/people/ivan">Ivan</a></div></div>`, 'https://www.facebook.com/');
  hideCertainAds(doc, win);
  for (const id of ['ad-feed', 'ad-en', 'ad-side']) assert.equal(doc.getElementById(id).style.display, 'none', id);
  for (const id of ['post', 'friends']) assert.equal(doc.getElementById(id).style.display, '', id);
});

test('the Facebook ad rules do not run on other sites', () => {
  const { doc, win } = page('<div id="feed"><div id="ad" data-pagelet="FeedUnit_1"><div role="article"><a href="/ads/about/">Sponsored</a></div></div></div>', 'https://news.ee/');
  hideCertainAds(doc, win);
  assert.equal(doc.getElementById('ad').style.display, '');
});

test('private hosts are skipped so intranet content is never sent out', () => {
  for (const host of ['localhost', 'localhost.', '127.0.0.1', 'nas.local', 'router', 'git.internal', 'nas.lan', 'app.corp', 'box.home.arpa', 'dev.test', 'foo.localhost', 'pc.tail1.ts.net']) assert.equal(isPrivateHost(host), true, host);
  assert.equal(isPrivateHost('rus.postimees.ee'), false);
});
