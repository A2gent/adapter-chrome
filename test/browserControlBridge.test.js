const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const readFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('browser control bridge exposes required agent command actions', () => {
  const bridge = readFile('src/browserControlBridge.js');

  for (const action of [
    'eval',
    'get_text',
    'read_content',
    'get_interactive_elements',
    'type',
    'press_key',
    'click',
    'click_at',
    'move_mouse',
    'scroll',
    'get_console_logs',
    'get_network_logs',
    'get_diagnostics',
  ]) {
    assert.match(bridge, new RegExp(`case ['"]${action}['"]`), `${action} must be handled by the content bridge`);
  }

  assert.match(bridge, /a2gent-browser-adapter-ai-cursor/, 'bridge should render a visible virtual AI cursor');
  assert.match(bridge, /CURSOR_IMAGE_PATH = 'cursor\.png'/, 'virtual cursor should use the bundled cursor asset');
  assert.match(bridge, /CURSOR_WIDTH_PX = 24/, 'virtual cursor should render near normal pointer size');
  assert.doesNotMatch(bridge, /border-radius:999px/, 'virtual cursor should not fall back to the old circular marker');
});

test('page hook can return full logs on demand without changing compact defaults', () => {
  const pageHook = readFile('src/pageHook.js');

  assert.match(pageHook, /A2GENT_GET_PAGE_DIAGNOSTICS/);
  assert.match(pageHook, /detailLevel\s*=\s*event\.data\.detailLevel/);
  assert.match(pageHook, /network_activity:\s*includeFull \? fullNetwork\(\) : latestNetwork\(\)/);
  assert.match(pageHook, /console_logs:\s*includeFull \? logs\.slice\(\) : latestLogs\(\)/);
});
