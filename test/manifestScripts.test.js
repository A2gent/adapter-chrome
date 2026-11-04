const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');

const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

test('manifest content scripts support web pages and local files', () => {
  // The HearHear bundle is http(s)-only: articles are not read from local files.
  // LinkedIn sync mode scripts run only on LinkedIn.
  const scoped = (item) => ['dist/hearhear-content.js', 'src/peopleSync/panel.js', 'src/adblock/content.js', 'src/chatAssist/panel.js', 'src/summarize/panel.js', 'src/ashby/panel.js'].some((file) => item.js.includes(file));
  for (const entry of manifest.content_scripts.filter((item) => !scoped(item))) {
    assert.deepEqual(entry.matches, ['http://*/*', 'https://*/*', 'file:///*']);
  }
});

test('manifest content scripts reference bundled files in load order', () => {
  const scriptFiles = manifest.content_scripts.flatMap((entry) => entry.js || []).filter((file) => !file.startsWith('dist/'));

  assert.deepEqual(scriptFiles, [
    'src/pageHook.js',
    'src/drawingAnnotation.js',
    'src/contentDrawing.js',
    'src/contentUi.js',
    'src/contentScript/shared.js',
    'src/contentScript/sessionLaunch.js',
    'src/contentScript/projectMatching.js',
    'src/contentScript/diagnosticsHelpers.js',
    'src/contentScript/overlayFocus.js',
        'src/contentScript/drawingBridge.js',
        'src/contentScript/sessionEvents.js',
        'src/contentScript/caesarApi.js',
        'src/contentScript/pageDiagnostics.js',
    'src/contentScript/projectSettings.js',
    'src/contentScript/renderWiring.js',
    'src/contentScript.js',
    'src/browserControlBridge.js',
    'src/adblock/content.js',
    'src/chatAssist/markdown.js',
    'src/summarize/panel.js',
    'src/peopleSync/linkedin.js',
    'src/peopleSync/panel.js',
    'src/chatAssist/googleChat.js',
    'src/chatAssist/chatImage.js',
    'src/chatAssist/markdown.js',
    'src/chatAssist/panel.js',
    'src/chatAssist/markdown.js',
    'src/ashby/panel.js',
  ]);

  for (const relativePath of scriptFiles) {
    assert.equal(exists(relativePath), true, `${relativePath} must exist so Chrome can load the extension`);
  }
});

test('background fallback injection includes all isolated content helpers before the main script', () => {
  const background = fs.readFileSync(path.join(repoRoot, 'src/background.js'), 'utf8');

  assert.match(
    background,
    /files: \['src\/drawingAnnotation\.js', 'src\/contentDrawing\.js', 'src\/contentUi\.js', 'src\/contentScript\/shared\.js', 'src\/contentScript\/sessionLaunch\.js', 'src\/contentScript\/projectMatching\.js', 'src\/contentScript\/diagnosticsHelpers\.js', 'src\/contentScript\/overlayFocus\.js', 'src\/contentScript\/drawingBridge\.js', 'src\/contentScript\/sessionEvents\.js', 'src\/contentScript\/caesarApi\.js', 'src\/contentScript\/pageDiagnostics\.js', 'src\/contentScript\/projectSettings\.js', 'src\/contentScript\/renderWiring\.js', 'src\/contentScript\.js', 'src\/browserControlBridge\.js'\]/,
  );
});

test('manifest exposes content-injected images to page DOM', () => {
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ['cursor.png'],
      matches: ['http://*/*', 'https://*/*', 'file:///*'],
    },
    {
      resources: ['icons/a2gent-16.png'],
      matches: ['https://www.linkedin.com/*'],
    },
    {
      resources: ['icons/a2gent-32.png', 'icons/aristotle-40.png'],
      matches: ['https://chat.google.com/*', 'https://mail.google.com/*'],
    },
    {
      resources: ['icons/a2gent-32.png', 'icons/victoria-40.png'],
      matches: ['https://www.ashbyhq.com/*'],
    },
  ]);
  assert.equal(exists('cursor.png'), true, 'cursor.png must be bundled with the extension');
  assert.equal(exists('icons/a2gent-16.png'), true, 'the A2gent icon must be bundled with the extension');
  assert.equal(exists('icons/victoria-40.png'), true, 'the Ashby agent avatar must be bundled with the extension');
});

test('manifest wires the HearHear audio bundle, offscreen document and options page', () => {
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes('dist/hearhear-content.js')));
  for (const permission of ['offscreen']) assert.ok(manifest.permissions.includes(permission));
  assert.equal(manifest.options_page, 'hearhear/options.html');
  assert.equal(exists('hearhear/offscreen.html'), true);
});

test('manifest loads LinkedIn sync scripts only on LinkedIn, after the shared helpers', () => {
  const entry = manifest.content_scripts.find((item) => item.js.includes('src/peopleSync/panel.js'));
  assert.deepEqual(entry.matches, ['https://www.linkedin.com/*']);
  assert.deepEqual(entry.js, ['src/peopleSync/linkedin.js', 'src/peopleSync/panel.js']);
  // panel.js relies on shared.js from the document_start entry that also matches LinkedIn.
  assert.equal(entry.run_at, 'document_idle');
});

test('the extension CSP lets the service worker reach every Chat image host', () => {
  const connectSrc = manifest.content_security_policy.extension_pages.match(/connect-src ([^;]*)/)[1].split(/\s+/);
  const imageHosts = manifest.host_permissions.filter((host) => /google/.test(host)).map((host) => host.replace(/\/\*$/, ''));
  assert.equal(imageHosts.length, 4);
  for (const host of imageHosts) assert.ok(connectSrc.includes(host), host);
});

test('manifest reaches Google Chat inside the cross-origin Gmail iframes', () => {
  const entry = manifest.content_scripts.find((item) => item.js.includes('src/chatAssist/panel.js'));
  assert.deepEqual(entry.matches, ['https://chat.google.com/*', 'https://mail.google.com/chat/*']);
  assert.equal(entry.all_frames, true);
  // These frames do not get the top-frame document_start scripts, so the entry must be self-contained.
  assert.deepEqual(entry.js, ['src/chatAssist/googleChat.js', 'src/chatAssist/chatImage.js', 'src/chatAssist/markdown.js', 'src/chatAssist/panel.js']);
});

test('manifest loads the Ashby panel only on ashbyhq.com', () => {
  const entry = manifest.content_scripts.find((item) => item.js.includes('src/ashby/panel.js'));
  assert.deepEqual(entry.matches, ['https://www.ashbyhq.com/*']);
  assert.deepEqual(entry.js, ['src/chatAssist/markdown.js', 'src/ashby/panel.js']);
  assert.ok(manifest.host_permissions.includes('https://www.ashbyhq.com/*'));
});
