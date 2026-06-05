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
    /files: \['src\/drawingAnnotation\.js', 'src\/contentDrawing\.js', 'src\/contentUi\.js', 'src\/contentScript\.js', 'src\/browserControlBridge\.js'\]/,
  );
});
