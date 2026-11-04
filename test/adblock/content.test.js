const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { adContainer, applyLearned, createScanner, findCandidates, isPrivateHost, isSafeToHide, stableSelector } = require('../../src/adblock/content.js');

const page = (body) => {
  const { window } = new JSDOM(`<!doctype html><body>${body}</body>`, { url: 'https://news.ee/', pretendToBeVisual: true });
  Object.defineProperty(window, 'innerWidth', { value: 1000 });
  Object.defineProperty(window, 'innerHeight', { value: 800 });
  window.Element.prototype.getBoundingClientRect = function rect() {
    return { width: Number(this.dataset.w ?? 300), height: Number(this.dataset.h ?? 100) };
  };
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
    <div id="video" class="slot" data-w="301"><iframe src="https://www.youtube.com/embed/1"></iframe></div>`);
  doc.getElementById('ad').removeAttribute('id');
  doc.getElementById('video').removeAttribute('id');
  const asked = [];
  const scan = createScanner({
    doc,
    win,
    verdicts: {},
    classify: async (items) => {
      asked.push(...items.map((item) => item.id));
      return { ok: true, verdicts: { 'div.slot@ads.net': 'ad', 'div.slot@www.youtube.com': 'content' } };
    },
  });
  await scan();
  assert.deepEqual(asked.sort(), ['div.slot@ads.net', 'div.slot@www.youtube.com']);
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

test('private hosts are skipped so intranet content is never sent out', () => {
  for (const host of ['localhost', 'localhost.', '127.0.0.1', 'nas.local', 'router', 'git.internal', 'nas.lan', 'app.corp', 'box.home.arpa', 'dev.test', 'foo.localhost', 'pc.tail1.ts.net']) assert.equal(isPrivateHost(host), true, host);
  assert.equal(isPrivateHost('rus.postimees.ee'), false);
});
