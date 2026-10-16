import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractArticle, cleanText, detectLanguage } from '../../src/hearhear/article.js';
const prose = 'Это подробная статья о фотографии, технологиях и современных форматах изображений. '.repeat(5);
const doc = (body) => new JSDOM(`<html lang="ru"><body>${body}</body></html>`).window.document;
test('detects Russian article and excludes navigation/related/hidden content', () => {
  const d = doc(`<nav>Меню</nav><article><h1>HDR фото</h1><p>${prose}</p><aside>Реклама</aside><section class="related-articles"><p>Другие статьи</p></section><p hidden>Секрет</p></article>`);
  const a = extractArticle(d);
  assert.equal(a.language, 'ru');
  assert.equal(a.title, 'HDR фото');
  assert.ok(a.text.includes(prose.trim()));
  assert.doesNotMatch(a.text, /Меню|Реклама|Другие|Секрет/);
  assert.ok(a.segments.every(s => s.element.ownerDocument === d));
});
test('rejects navigation and article preview listings', () => {
  assert.equal(extractArticle(doc('<main><h1>Каталог</h1><nav>Ссылки</nav></main>')), null);
  assert.equal(extractArticle(doc(`<main><h1>Блог</h1>${'<article><h2>Новость</h2><p>Краткое описание.</p></article>'.repeat(10)}</main>`)), null);
  assert.equal(extractArticle(doc(`<h1>Артём Курапов</h1><div class="blog-showcase-grid">${`<article class="blog-showcase-card"><h3>Карточка</h3><p>${prose}</p></article>`.repeat(4)}</div>`)), null);
});
function withWidths(document) {
  document.defaultView.HTMLElement.prototype.getBoundingClientRect = function() {
    const width = Number(this.getAttribute('data-width') || 0);
    return { width, height: 200, top: 0, left: 0, right: width, bottom: 200, x: 0, y: 0, toJSON() {} };
  };
  return document;
}
test('picks the widest article and ignores nested or narrow extra blocks', () => {
  const d = withWidths(doc(`<main data-width="900"><h1>Блог</h1><article data-width="880"><h1>HDR фото</h1><p>${prose}</p><div class="cards">${`<article data-width="400"><h2>Карточка</h2><p>${prose}</p></article>`.repeat(3)}</div></article><article data-width="280"><h2>Сайдбар</h2><p>${prose.repeat(3)}</p></article></main>`));
  const a = extractArticle(d);
  assert.equal(a.title, 'HDR фото');
  assert.equal(a.root, d.querySelector('article[data-width="880"]'));
  assert.equal(d.querySelectorAll('article').length, 5);
});
test('summarizes non-prose without reading their contents', () => {
  const longCode = 'function hiddenPayload() { const token = SECRET_SNIPPET; return token; }\n'.repeat(4);
  const a = extractArticle(doc(`<article><h1>Фото</h1><p>${prose}</p><table><tr><th>Формат</th><th>Размер</th></tr><tr><td>SECRET_CELL</td></tr></table><img aria-label="Закат"><img src="skip.jpg"><svg><text>SECRET_SVG</text></svg><pre><code>${longCode}</code></pre><div class="mermaid">SECRET_DIAGRAM</div><p>Читайте <a href="https://example.com/secret">источник</a>.</p></article>`));
  assert.match(a.text, /Таблица.*Формат.*Размер/);
  assert.match(a.text, /Изображение.*Закат/);
  assert.match(a.text, /Диаграмма/);
  assert.match(a.text, /Длинный код/);
  assert.match(a.text, /источник/);
  assert.doesNotMatch(a.text, /SECRET|https:|skip.jpg|hiddenPayload/);
});
test('reads short pronounceable code and skips punctuation and long snippets', () => {
  const longCode = 'function hiddenPayload() { const token = SECRET_SNIPPET; return token; }\n'.repeat(4);
  const a = extractArticle(doc(`<article><h1>Фото</h1><p>${prose}</p><p>macOS <code>say</code> and <code>foo(); bar:</code> plus <code>&lt;&gt;;;::</code>.</p><pre><code>${longCode}</code></pre></article>`));
  assert.match(a.text, /say/);
  assert.match(a.text, /foo bar/);
  assert.doesNotMatch(a.text, /foo\(\)|bar:|[<>]/);
  assert.match(a.text, /Код/);
  assert.match(a.text, /Длинный код/);
  assert.doesNotMatch(a.text, /SECRET_SNIPPET|hiddenPayload/);
  const en = extractArticle(new JSDOM(`<html lang="en"><body><article><h1>Photos</h1><p>${'This is a detailed article about photography, technology and modern image formats. '.repeat(5)}</p><pre><code>${longCode}</code></pre></article></body></html>`).window.document);
  assert.match(en.text, /Long code/);
  assert.doesNotMatch(en.text, /hiddenPayload/);
});
test('numbers only outer ordered items and never duplicates nested text', () => {
  const a = extractArticle(doc(`<article><h1>Фото</h1><p>${prose}</p><ol start="3"><li>Первый<ol><li>Вложенный</li></ol></li><li value="8">Второй<ul><li>Глубокий</li></ul></li></ol></article>`));
  assert.match(a.text, /Пункт 3.*Первый/);
  assert.match(a.text, /Пункт 8.*Второй/);
  assert.equal(a.text.match(/Вложенный/g).length, 1);
  assert.equal(a.text.match(/Пункт/g).length, 2);
});
test('cleans noise while retaining Cyrillic, technical numbers and punctuation', () => {
  assert.equal(cleanText('«Привет» HDR 17, 3.14! abcdef0123456789abcdef0123456789 123456789012345 https://site.test/x'), 'Привет HDR 17, 3.14!');
});
test('infers Russian without a lang attribute and detects prose main fallback', () => {
  const d = doc(`<main><h1>Технологии</h1><p>${prose}</p></main>`);
  d.documentElement.removeAttribute('lang');
  assert.equal(extractArticle(d).language, 'ru');
});
test('detectLanguage prefers html lang, then closer tags, then text script', () => {
  const ruHtml = new JSDOM(`<html lang="ru"><body><article><h1>HDR фото</h1><p>${prose}</p></article></body></html>`).window.document;
  assert.equal(detectLanguage(ruHtml, ruHtml.querySelector('article')), 'ru');
  assert.equal(extractArticle(ruHtml).language, 'ru');

  const regional = new JSDOM(`<html lang="ru-RU"><body><article><p>${prose}</p></article></body></html>`).window.document;
  assert.equal(detectLanguage(regional, regional.querySelector('article')), 'ru');

  const enHtml = new JSDOM(`<html lang="en"><body><article><p>This is a detailed article about photography, technology and modern image formats. ${'More English prose about cameras and sensors. '.repeat(4)}</p></article></body></html>`).window.document;
  assert.equal(detectLanguage(enHtml, enHtml.querySelector('article')), 'en');

  const articleRu = new JSDOM(`<html lang="en"><body><article lang="ru"><p>${prose}</p></article></body></html>`).window.document;
  assert.equal(detectLanguage(articleRu, articleRu.querySelector('article')), 'ru');

  const xmlLang = new JSDOM(`<html xmlns="http://www.w3.org/1999/xhtml"><body><article><p>${prose}</p></article></body></html>`).window.document;
  xmlLang.documentElement.setAttribute('xml:lang', 'ru');
  assert.equal(detectLanguage(xmlLang, xmlLang.querySelector('article')), 'ru');

  const untitled = new JSDOM(`<html><body><article><p>${prose}</p></article></body></html>`).window.document;
  untitled.documentElement.removeAttribute('lang');
  assert.equal(detectLanguage(untitled, untitled.querySelector('article')), 'ru');

  const english = new JSDOM(`<html><body><article><p>${'This is a detailed article about photography and image formats. '.repeat(5)}</p></article></body></html>`).window.document;
  english.documentElement.removeAttribute('lang');
  assert.equal(detectLanguage(english, english.querySelector('article')), 'en');
});
test('fails explicitly for oversized articles', () => {
  assert.throws(() => extractArticle(doc(`<article><h1>Длинная</h1><p>${prose.repeat(200)}</p></article>`)), /60000/);
});

test('large unbroken input is cleaned without argument-spread stack overflow', () => {
  assert.equal(cleanText('я'.repeat(200000)).length, 200000);
});
