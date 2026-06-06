const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');

const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

test('manifest content scripts reference bundled files in load order', () => {
  const scriptFiles = manifest.content_scripts.flatMap((entry) => entry.js || []);

  assert.deepEqual(scriptFiles, [
    'src/pageHook.js',
    'src/drawingAnnotation.js',
    'src/contentDrawing.js',
    'src/contentUi.js',
    'src/contentScript/shared.js',
    'src/contentScript/projectMatching.js',
    'src/contentScript/diagnosticsHelpers.js',
    'src/contentScript/overlayFocus.js',
    'src/contentScript/drawingBridge.js',
    'src/contentScript/caesarApi.js',
    'src/contentScript/pageDiagnostics.js',
    'src/contentScript/projectSettings.js',
    'src/contentScript/renderWiring.js',
    'src/contentScript.js',
    'src/browserControlBridge.js',
  ]);

  for (const relativePath of scriptFiles) {
    assert.equal(exists(relativePath), true, `${relativePath} must exist so Chrome can load the extension`);
  }
});

test('background fallback injection includes all isolated content helpers before the main script', () => {
  const background = fs.readFileSync(path.join(repoRoot, 'src/background.js'), 'utf8');

  assert.match(
    background,
    /files: \['src\/drawingAnnotation\.js', 'src\/contentDrawing\.js', 'src\/contentUi\.js', 'src\/contentScript\/shared\.js', 'src\/contentScript\/projectMatching\.js', 'src\/contentScript\/diagnosticsHelpers\.js', 'src\/contentScript\/overlayFocus\.js', 'src\/contentScript\/drawingBridge\.js', 'src\/contentScript\/caesarApi\.js', 'src\/contentScript\/pageDiagnostics\.js', 'src\/contentScript\/projectSettings\.js', 'src\/contentScript\/renderWiring\.js', 'src\/contentScript\.js', 'src\/browserControlBridge\.js'\]/,
  );
});


test('manifest exposes the virtual cursor image to content-injected page DOM', () => {
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ['cursor.png'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ]);
  assert.equal(exists('cursor.png'), true, 'cursor.png must be bundled with the extension');
});
