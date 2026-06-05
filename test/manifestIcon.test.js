const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');

const readPngDimensions = (filePath) => {
  const buffer = fs.readFileSync(filePath);

  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${filePath} must be a PNG file`);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

test('manifest uses bundled A2gent icon assets for extension and toolbar icons', () => {
  const expectedIcons = {
    16: 'icons/a2gent-16.png',
    32: 'icons/a2gent-32.png',
    48: 'icons/a2gent-48.png',
    128: 'icons/a2gent-128.png',
  };

  assert.deepEqual(manifest.icons, expectedIcons);
  assert.deepEqual(manifest.action.default_icon, expectedIcons);

  for (const [size, relativePath] of Object.entries(expectedIcons)) {
    const iconPath = path.join(repoRoot, relativePath);
    assert.equal(fs.existsSync(iconPath), true, `${relativePath} should be bundled with the extension`);
    assert.deepEqual(readPngDimensions(iconPath), {
      width: Number(size),
      height: Number(size),
    });
  }
});


test('bundled virtual cursor asset is compact enough for pointer-like rendering', () => {
  const cursorPath = path.join(repoRoot, 'cursor.png');

  assert.equal(fs.existsSync(cursorPath), true, 'cursor.png should be bundled with the extension');
  assert.deepEqual(readPngDimensions(cursorPath), {
    width: 48,
    height: 70,
  });
});
