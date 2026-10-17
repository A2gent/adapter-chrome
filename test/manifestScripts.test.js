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
  const scoped = (item) => item.js.includes('dist/hearhear-content.js') || item.js.includes('src/peopleSync/panel.js');
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
    'src/peopleSync/linkedin.js',
    'src/peopleSync/panel.js',
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
  ]);
  assert.equal(exists('cursor.png'), true, 'cursor.png must be bundled with the extension');
  assert.equal(exists('icons/a2gent-16.png'), true, 'the A2gent icon must be bundled with the extension');
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
