const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');

const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('Brute loopback HTTP calls are proxied through the background service worker', () => {
  const background = readFile('src/background.js');
  const contentScript = readFile('src/contentScript.js');
  const browserControlBridge = readFile('src/browserControlBridge.js');

  assert.doesNotMatch(contentScript, /\bfetch\s*\(/, 'overlay content script must not fetch loopback Brute directly from HTTPS page origins');
  assert.doesNotMatch(browserControlBridge, /\bfetch\s*\(/, 'browser-control content bridge must not fetch loopback Brute directly from HTTPS page origins');

  assert.match(background, /A2GENT_BRUTE_API_FETCH/, 'background must expose a JSON Brute API proxy');
  assert.match(background, /chrome\.runtime\.onConnect\.addListener/, 'background must handle stream proxy ports');
  assert.match(background, /A2GENT_BRUTE_STREAM/, 'background/content scripts must use a named stream proxy port');
  assert.match(background, /credentials:\s*['"]omit['"]/, 'proxied local Brute requests must not forward browser credentials');
  assert.match(background, /normalizeApiPath/, 'background must restrict proxied Brute requests to root-relative API paths');
});

test('manifest grants the background worker loopback host access for proxied Brute calls', () => {
  assert.ok(manifest.host_permissions.includes('http://localhost/*'));
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
  assert.ok(manifest.host_permissions.includes('http://[::1]/*'));
});
