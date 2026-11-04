const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Google Chat pages can load the agent avatar from the extension', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../manifest.json'), 'utf8'));
  const exposed = manifest.web_accessible_resources
    .filter((entry) => entry.matches.some((match) => match.startsWith('https://chat.google.com')))
    .flatMap((entry) => entry.resources);
  assert.ok(exposed.includes('icons/aristotle-40.png'));
});
