// Bundles the HearHear ES modules into classic scripts the (build-free) adapter can load.
const { build } = require('esbuild');

const common = { bundle: true, target: 'chrome116', logLevel: 'info' };

(async () => {
  await build({ ...common, entryPoints: { 'hearhear-content': 'src/hearhear/content.js' }, outdir: 'dist', format: 'iife' });
  // iife: the service worker loads this via importScripts().
  await build({ ...common, entryPoints: { 'hearhear-background': 'src/hearhear/background.js' }, outdir: 'dist', format: 'iife' });
  await build({ ...common, entryPoints: { 'hearhear-offscreen': 'src/hearhear/offscreen.js' }, outdir: 'dist', format: 'esm' });
  // options.js uses top-level await, so it must stay an ES module.
  await build({ ...common, entryPoints: { 'hearhear-options': 'src/hearhear/options.js' }, outdir: 'dist', format: 'esm' });
})();
