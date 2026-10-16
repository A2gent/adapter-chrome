// Sync mode: best-effort LinkedIn page parsing. LinkedIn markup is obfuscated and changes
// often, so parsing relies on stable anchors (/in/ links, h1, section ids) and visible text lines.
((root, factory) => {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.__A2GENT_PEOPLE_SYNC_LINKEDIN__ = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const LIST_PATHS = [/^\/search\/results\/(people|all)/, /^\/mynetwork\//, /^\/(company|school)\/[^/]+\/people/];
  const DURATION = /^\d+\s*(yrs?|mos?|years?|months?|лет|год|года|мес)\b/i;

  const profileSlug = (href) => {
    try {
      const match = new URL(href, 'https://www.linkedin.com').pathname.match(/^\/in\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]).toLowerCase() : '';
    } catch {
      return '';
    }
  };

  // Must match brute canonicalLinkedInURL so linked cards are recognized.
  const canonicalUrl = (slug) => `https://www.linkedin.com/in/${encodeURIComponent(slug).toLowerCase()}/`;

  const pageKind = (pathname) => {
    if (/^\/in\/[^/]+\/?$/.test(pathname)) return 'profile';
    return LIST_PATHS.some((pattern) => pattern.test(pathname)) ? 'list' : '';
  };

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  // Visible text lines; LinkedIn duplicates every label in .visually-hidden spans for screen readers.
  const textLines = (element) => {
    if (!element) return [];
    const lines = [];
    const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.visually-hidden, script, style, button, svg')) continue;
      const text = clean(node.textContent);
      if (text && text !== '·' && lines[lines.length - 1] !== text) lines.push(text);
    }
    return lines;
  };

  const splitHeadline = (headline) => {
    const match = clean(headline).match(/^(.+?)\s+(?:at|@|в)\s+(.+)$/i);
    return match ? { role: match[1], company: match[2].split(/\s+[|·]\s+/)[0] } : { role: '', company: '' };
  };

  const sectionItems = (doc, id) => {
    const section = doc.getElementById(id)?.closest('section');
    if (!section) return [];
    const items = [...section.querySelectorAll('li')].filter((li) => !li.parentElement?.closest('li'));
    return items.map((li) => textLines(li).filter((line) => !/^(show|see|показать)\b/i.test(line)).slice(0, 4)).filter((lines) => lines.length);
  };

  const parseProfile = (doc, href) => {
    const slug = profileSlug(href);
    const main = doc.querySelector('main') || doc.body;
    const name = clean(main?.querySelector('h1')?.textContent) || clean(doc.title.split('|')[0]);
    const headline = clean(main?.querySelector('.text-body-medium')?.textContent);
    const location = clean(main?.querySelector('.text-body-small.inline.t-black--light, .text-body-small.t-black--light')?.textContent);
    const aboutSection = doc.getElementById('about')?.closest('section');
    const about = aboutSection ? textLines(aboutSection).slice(1).filter((line) => !/^(…?see more|…?ещё)$/i.test(line)).join('\n') : '';
    const experience = sectionItems(doc, 'experience');
    const education = sectionItems(doc, 'education');

    let { role, company } = splitHeadline(headline);
    const first = experience[0];
    if (first) {
      // Grouped company entries list the company then the total duration, then the roles.
      const grouped = DURATION.test(first[1] || '');
      role = (grouped ? first[2] : first[0]) || role;
      company = clean((grouped ? first[0] : first[1] || '').split('·')[0]) || company;
    }
    return {
      url: canonicalUrl(slug), slug, name, headline, location, about, role, company,
      experience: experience.map((lines) => lines.join(' - ')),
      education: education.map((lines) => lines.join(' - ')),
    };
  };

  const parseList = (doc) => {
    const profiles = new Map();
    for (const anchor of (doc.querySelector('main') || doc.body).querySelectorAll('a[href*="/in/"]')) {
      const slug = profileSlug(anchor.getAttribute('href'));
      if (!slug || profiles.has(slug)) continue;
      const name = clean(anchor.querySelector('span[aria-hidden="true"]')?.textContent) || textLines(anchor)[0] || '';
      if (!name || /^view\b/i.test(name)) continue;
      const lines = textLines(anchor.closest('li') || anchor.parentElement)
        .filter((line) => line !== name && !/^(•\s*)?(1st|2nd|3rd\+?|[123]-?й)$/i.test(line) && !/^(view|connect|follow|message)\b/i.test(line));
      profiles.set(slug, { url: canonicalUrl(slug), slug, name, headline: lines[0] || '', location: lines[1] || '', ...splitHeadline(lines[0]) });
    }
    return [...profiles.values()];
  };

  // The visual row of a list profile, found without relying on obfuscated class names: climb from
  // the profile link while the ancestor still links to no other profile.
  const rowElement = (doc, slug) => {
    const scope = doc.querySelector('main') || doc.body;
    const anchor = [...scope.querySelectorAll('a[href*="/in/"]')].find((candidate) => profileSlug(candidate.getAttribute('href')) === slug);
    if (!anchor) return null;
    let row = anchor;
    for (let parent = row.parentElement; parent && parent !== scope; parent = parent.parentElement) {
      const others = [...parent.querySelectorAll('a[href*="/in/"]')].some((other) => profileSlug(other.getAttribute('href')) !== slug);
      if (others) break;
      row = parent;
    }
    return row === anchor ? anchor.parentElement : row;
  };

  // Place the people control in the same action group as LinkedIn's Message button.
  const messageActionArea = (doc, slug) => {
    const row = rowElement(doc, slug);
    if (!row) return null;
    const message = [...row.querySelectorAll('button,[role="button"],a[role="button"]')].find((button) => {
      const labels = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].map(clean).join(' ').toLowerCase();
      return /\bmessage\b/.test(labels);
    });
    return message?.parentElement || row;
  };

  // Profile top card: the section holding the name heading.
  const profileHeader = (doc) => {
    const h1 = (doc.querySelector('main') || doc.body)?.querySelector('h1');
    return h1?.closest('section') || h1?.parentElement || null;
  };

  // Map of linkedin slug -> person card, built from the cards' socials.linkedin.
  const linkedPeople = (people) => {
    const map = new Map();
    for (const person of people || []) {
      const slug = profileSlug(person?.socials?.linkedin || '');
      if (slug) map.set(slug, person);
    }
    return map;
  };

  const suggestPerson = (people, name) => {
    const target = clean(name).toLowerCase();
    if (!target) return null;
    return (people || []).find((person) => [person.name, ...(person.aliases || [])].some((value) => clean(value).toLowerCase() === target)) || null;
  };

  return { profileSlug, canonicalUrl, pageKind, textLines, splitHeadline, parseProfile, parseList, rowElement, messageActionArea, profileHeader, linkedPeople, suggestPerson };
});
