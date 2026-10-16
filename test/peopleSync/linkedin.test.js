const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const linkedin = require('../../src/peopleSync/linkedin.js');

const doc = (html, url = 'https://www.linkedin.com/') => new JSDOM(html, { url }).window.document;

test('profile slugs and canonical URLs match Brute canonicalLinkedInURL', () => {
  assert.equal(linkedin.profileSlug('https://ee.linkedin.com/in/Anna-K/details/?x=1'), 'anna-k');
  assert.equal(linkedin.profileSlug('/in/anna-k?miniProfileUrn=1'), 'anna-k');
  assert.equal(linkedin.profileSlug('https://www.linkedin.com/company/acme/'), '');
  assert.equal(linkedin.canonicalUrl('anna-k'), 'https://www.linkedin.com/in/anna-k/');
  assert.equal(linkedin.pageKind('/in/anna-k/'), 'profile');
  assert.equal(linkedin.pageKind('/search/results/people/'), 'list');
  assert.equal(linkedin.pageKind('/feed/'), '');
});

test('parseProfile reads top card, about, experience and education', () => {
  const page = doc(`<main>
    <h1>Anna K</h1><div class="text-body-medium">CTO at Acme</div>
    <span class="text-body-small inline t-black--light">Tallinn, Estonia</span>
    <section><div id="about"></div><h2><span aria-hidden="true">About</span><span class="visually-hidden">About</span></h2>
      <div><span aria-hidden="true">Builds things.</span></div></section>
    <section><div id="experience"></div><ul>
      <li><span>Head of Engineering</span><span>Acme · Full-time</span><span>2020 - Present</span><button>Show all</button></li>
      <li><span>Developer</span><span>Initech</span></li></ul></section>
    <section><div id="education"></div><ul><li><span>TalTech</span><span>BSc</span></li></ul></section>
  </main>`, 'https://www.linkedin.com/in/anna-k/');

  const profile = linkedin.parseProfile(page, 'https://www.linkedin.com/in/anna-k/');
  assert.equal(profile.name, 'Anna K');
  assert.equal(profile.headline, 'CTO at Acme');
  assert.equal(profile.location, 'Tallinn, Estonia');
  assert.equal(profile.about, 'Builds things.');
  // The current experience entry wins over the headline.
  assert.equal(profile.role, 'Head of Engineering');
  assert.equal(profile.company, 'Acme');
  assert.deepEqual(profile.experience, ['Head of Engineering - Acme · Full-time - 2020 - Present', 'Developer - Initech']);
  assert.deepEqual(profile.education, ['TalTech - BSc']);
});

test('parseProfile handles grouped company experience', () => {
  const page = doc(`<main><h1>Bo</h1><section><div id="experience"></div><ul>
    <li><span>Acme</span><span>5 yrs 2 mos</span><ul><li><span>CTO</span></li></ul></li></ul></section></main>`);
  const profile = linkedin.parseProfile(page, 'https://www.linkedin.com/in/bo/');
  assert.equal(profile.company, 'Acme');
  assert.equal(profile.role, 'CTO');
});

test('parseList collects unique profiles with headline and location', () => {
  const page = doc(`<main><ul>
    <li><a href="/in/anna-k?mini=1"><span aria-hidden="true">Anna K</span><span class="visually-hidden">View Anna K's profile</span></a>
      <span>• 2nd</span><div>CTO at Acme</div><div>Tallinn</div><a href="/in/anna-k/">photo</a><button>Connect</button></li>
    <li><a href="https://www.linkedin.com/in/bo/"><span aria-hidden="true">Bo</span></a><div>Designer</div></li>
  </ul></main>`);
  const profiles = linkedin.parseList(page);
  assert.deepEqual(profiles.map((p) => [p.slug, p.name, p.headline, p.location, p.company]), [
    ['anna-k', 'Anna K', 'CTO at Acme', 'Tallinn', 'Acme'],
    ['bo', 'Bo', 'Designer', '', ''],
  ]);
});

test('linkedPeople and suggestPerson match cards by socials.linkedin and name/aliases', () => {
  const people = [
    { name: 'Anna Karenina', aliases: ['Anna K'], path: 'People/Anna.md', socials: { linkedin: 'https://linkedin.com/in/Anna-K' } },
    { name: 'Bo', path: 'People/Bo.md' },
  ];
  assert.equal(linkedin.linkedPeople(people).get('anna-k').path, 'People/Anna.md');
  assert.equal(linkedin.suggestPerson(people, ' anna k ').path, 'People/Anna.md');
  assert.equal(linkedin.suggestPerson(people, 'Nobody'), null);
});
