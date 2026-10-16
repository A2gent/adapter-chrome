const EXCLUDED = 'script,style,noscript,nav,aside,footer,form,button,input,textarea,select,[hidden],[aria-hidden="true"],[inert],[contenteditable="true"],.related-articles,.article-meta,.comments,#comments,[role="navigation"],[data-chrome-sound]';
const SPECIAL = 'table,img,svg,canvas,pre,code,.mermaid,[role="img"]';
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
const MAX_SPOKEN_CODE_WORDS = 8;
const MAX_SPOKEN_CODE_CHARS = 60;

// WHY: TTS should speak short identifiers (say, npm) but not punctuation or whole listings.
function codeSpeech(node, ru) {
  let spoken = '';
  const points = [];
  const space = () => {
    if (!spoken || spoken.endsWith(' ')) return;
    spoken += ' ';
    points.push(null);
  };
  (function walk(n) {
    if (n.nodeType === 3) {
      const value = n.textContent;
      for (let i = 0; i < value.length; i++) {
        if (/[\p{L}\p{N}]/u.test(value[i])) {
          spoken += value[i];
          points.push({node:n, start:i, end:i + 1});
        } else space();
      }
    } else if (n.nodeType === 1) for (const child of n.childNodes) walk(child);
  })(node);
  while (spoken.startsWith(' ')) { spoken = spoken.slice(1); points.shift(); }
  while (spoken.endsWith(' ')) { spoken = spoken.slice(0, -1); points.pop(); }
  if (!spoken) return {text: ru ? 'Код.' : 'Code.', points:[]};
  if (spoken.split(' ').length > MAX_SPOKEN_CODE_WORDS || spoken.length > MAX_SPOKEN_CODE_CHARS) {
    return {text: ru ? 'Длинный код.' : 'Long code.', points:[]};
  }
  return {text:spoken, points};
}
// Preserve source offsets through normalization/removal; matching cleaned words
// back by text alone would highlight repeated words or excluded content wrongly.
function cleanMapped(text, origins = []) {
  let chars = []; let points = [];
  for (const part of new Intl.Segmenter('en', {granularity:'grapheme'}).segment(text)) {
    const normalized = part.segment.normalize('NFKC');
    chars.push(normalized);
    const first = origins[part.index]; const last = origins[part.index + part.segment.length - 1];
    const point = first && last && first.node === last.node ? {...first, end:last.end} : null;
    for (let i = 0; i < normalized.length; i++) points.push(point);
  }
  text = chars.join('');
  function replace(pattern, replacement) {
    const next = []; let previous = 0;
    text = text.replace(pattern, (match, offset) => {
      for (let i = previous; i < offset; i++) next.push(points[i]);
      for (let i = 0; i < replacement.length; i++) next.push(null);
      previous = offset + match.length;
      return replacement;
    });
    for (let i = previous; i < points.length; i++) next.push(points[i]);
    points = next;
  }
  replace(/https?:\/\/\S+|www\.\S+/gi, '');
  replace(/\b[a-f\d]{24,}\b/gi, '');
  replace(/\d(?:[\d\s-]{11,}\d)/g, '');
  // Control characters are deliberately stripped before sending text to TTS.
  // eslint-disable-next-line no-control-regex
  replace(/[«»„“”"`]|[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ');
  replace(/[_=~*#|]{3,}/g, ' ');
  replace(/[—–]/g, ', ');
  replace(/\s+/g, ' ');
  const start = text.length - text.trimStart().length;
  const value = text.trim();
  return {text:value, points:points.slice(start, start + value.length)};
}
export function cleanText(text) { return cleanMapped(text).text; }

function excluded(el) {
  if (el.matches(EXCLUDED)) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === 'none' || style?.visibility === 'hidden';
}
function visualWidth(el) {
  return el.getBoundingClientRect?.().width || el.clientWidth || 0;
}
function isListingCard(el) {
  // WHY: homepage/blog grids are many sibling <article> cards. A player inside one
  // of them splits the grid. Keep only a uniquely wide sibling (article + sidebar).
  const siblings = [...(el.parentElement?.children || [])].filter(node => node.matches?.('article'));
  if (siblings.length < 2) return false;
  if (siblings.length >= 3) return true;
  const widths = siblings.map(visualWidth);
  const widest = Math.max(...widths);
  return widest <= 0 || visualWidth(el) < widest * 0.85;
}
function label(el) {
  const ids = el.getAttribute('aria-labelledby');
  return cleanText(el.getAttribute('aria-label') || (ids && ids.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ')) || el.getAttribute('alt') || '');
}
function languageTag(el) {
  if (!el?.getAttribute) return '';
  return (el.getAttribute('lang') || el.getAttribute('xml:lang') || '').trim().toLowerCase();
}
function mapSupportedLanguage(tag) {
  const primary = tag.replaceAll('_', '-').split('-')[0];
  if (primary === 'ru' || primary === 'en') return primary;
  return '';
}
function languageFromText(sample) {
  const cyrillic = sample.match(/[а-яё]/gi)?.length || 0;
  const latin = sample.match(/[a-z]/gi)?.length || 0;
  return cyrillic > latin ? 'ru' : 'en';
}
// WHY: TTS voice follows the page language. Closest lang/xml:lang wins
// (article over html); unmarked pages fall back to Cyrillic vs Latin counts.
export function detectLanguage(document, root, sample = '') {
  let el = root;
  while (el) {
    const mapped = mapSupportedLanguage(languageTag(el));
    if (mapped) return mapped;
    el = el.parentElement;
  }
  const html = mapSupportedLanguage(languageTag(document?.documentElement));
  if (html) return html;
  return languageFromText(sample || root?.textContent || '');
}
function collect(root, language) {
  const ru = language === 'ru';
  const segments = [];
  let buffer = ''; let origins = [];
  const append = (text, node = null) => {
    buffer += text;
    for (let i = 0; i < text.length; i++) origins.push(node ? {node, start:i, end:i + 1} : null);
  };
  let source = root;
  const flush = () => {
    const {text, points} = cleanMapped(buffer, origins);
    if (text) segments.push({text, element:source, points});
    buffer = ''; origins = [];
  };
  function walk(node) {
    if (node.nodeType === 3) { append(node.textContent, node); return; }
    if (node.nodeType !== 1 || excluded(node)) return;
    if (node !== root && node.matches('article')) return;
    if (node.matches(SPECIAL)) {
      if (node.matches('pre,code')) {
        const speech = codeSpeech(node, ru);
        append(' ');
        buffer += speech.text;
        for (let i = 0; i < speech.text.length; i++) origins.push(speech.points[i] || null);
        append(' ');
        return;
      }
      let text = '';
      if (node.matches('table')) {
        const headers = [...node.querySelectorAll('th')].filter(el => !excluded(el)).slice(0, 16).map(el => cleanText(el.textContent)).join(', ');
        text = `${ru ? 'Таблица' : 'Table'}${headers ? ': ' + headers : ''}.`;
      } else if (node.matches('svg,canvas,.mermaid')) text = ru ? 'Диаграмма.' : 'Diagram.';
      else if (label(node)) text = `${ru ? 'Изображение' : 'Image'}: ${label(node)}.`;
      append(` ${text} `);
      return;
    }
    const block = node.matches(BLOCK);
    if (block) { flush(); source = node; }
    if (node.matches('li') && node.parentElement?.matches('ol') && !node.parentElement.parentElement.closest('ol,ul')) {
      let ordinal = Number(node.parentElement.getAttribute('start')) || (node.parentElement.hasAttribute('reversed') ? node.parentElement.children.length : 1);
      const step = node.parentElement.hasAttribute('reversed') ? -1 : 1;
      for (const item of node.parentElement.children) {
        if (item.hasAttribute('value')) ordinal = Number(item.getAttribute('value'));
        if (item === node) break;
        ordinal += step;
      }
      append(`${ru ? 'Пункт' : 'Item'} ${ordinal}. `);
    }
    if (node.matches('br,hr')) append(' ');
    for (const child of node.childNodes) walk(child);
    if (block) { flush(); source = root; }
  }
  walk(root);
  flush();
  return segments;
}
export function extractArticle(document) {
  const candidates = [...document.querySelectorAll('[itemprop="articleBody"],article,main,[role="main"],.post-content,.entry-content')];
  const qualified = [];
  for (const root of candidates) {
    if (root.closest(EXCLUDED) || excluded(root) || isListingCard(root)) continue;
    const sample = root.textContent.slice(0, 10000);
    const language = detectLanguage(document, root, sample);
    const segments = collect(root, language);
    const text = segments.map(s => s.text).join('\n\n');
    const paragraphs = segments.filter(s => s.element.matches('p') && s.text.length >= 80);
    const heading = root.querySelector('h1,h2');
    if (!heading || text.length < 300 || paragraphs.length === 0) continue;
    const links = [...root.querySelectorAll('a')].reduce((sum, a) => sum + a.textContent.length, 0);
    if (links > text.length * 0.55) continue;
    qualified.push({ title: cleanText(heading.textContent), language, text, segments, root, width: visualWidth(root) });
  }
  if (!qualified.length) return null;
  const maxWidth = Math.max(...qualified.map(item => item.width));
  const pool = maxWidth > 0 ? qualified.filter(item => item.width >= maxWidth * 0.85) : qualified;
  pool.sort((a, b) => {
    const boost = el => el.matches('article,[itemprop="articleBody"]') ? 1.2 : 1;
    return (b.text.length * boost(b.root)) - (a.text.length * boost(a.root));
  });
  const best = pool[0];
  if (best.text.length > 60000) throw new Error('Article exceeds 60000 characters / Статья длиннее 60000 символов.');
  return best;
}
