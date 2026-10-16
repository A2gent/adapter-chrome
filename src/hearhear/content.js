import { extractArticle } from './article.js';
import { mountPlayer } from './ui.js';
const send = message => chrome.runtime.sendMessage({target:'background', ...message});
// Audio mode (default) shows the player; design mode hides it so the session overlay owns the page.
const MODE_KEY = 'a2gent.adapterChrome.mode';
let audioMode = true;
let mounted; let href = location.href; let scheduled; let lastScan = 0;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'content' || sender.id !== chrome.runtime.id || !['toggleVisibility','getVisibility'].includes(message.action)) return;
  if (!mounted) { reply({ok:false, visible:false}); return; }
  reply({ok:true, visible:message.action === 'getVisibility' ? mounted.isVisible() : mounted.toggleVisibility()});
});
function scan() {
  scheduled = null;
  if (!audioMode) return;
  if (location.href !== href || (mounted && !mounted.host.isConnected)) {
    mounted?.destroy(); mounted = null; href = location.href;
  }
  if (mounted) return;
  lastScan = Date.now();
  try {
    const article = extractArticle(document);
    if (article) mounted = mountPlayer(article, send);
  } catch (error) { console.info('HearHear:', error.message); }
}
const observer = new MutationObserver(() => {
  if (audioMode && !scheduled && (!mounted || !mounted.host.isConnected || href !== location.href)) {
    scheduled = setTimeout(scan, Math.max(300, 2000 - (Date.now() - lastScan)));
  }
});
observer.observe(document.documentElement, {childList:true, subtree:true});
function applyMode(mode) {
  audioMode = mode !== 'design';
  if (audioMode) { scan(); return; }
  clearTimeout(scheduled); scheduled = null;
  // destroy() also stops any playback owned by this tab.
  mounted?.destroy(); mounted = null;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[MODE_KEY]) applyMode(changes[MODE_KEY].newValue);
});
chrome.storage.local.get(MODE_KEY).then(saved => applyMode(saved[MODE_KEY]));
let routeTimer = setInterval(() => { if (href !== location.href) scan(); }, 1500);
addEventListener('pagehide', () => {
  observer.disconnect(); clearInterval(routeTimer); clearTimeout(scheduled); scheduled = null; mounted?.destroy(); mounted = null;
});
addEventListener('pageshow', event => {
  if (!event.persisted) return;
  observer.observe(document.documentElement, {childList:true, subtree:true});
  routeTimer = setInterval(() => { if (href !== location.href) scan(); }, 1500);
  scan();
});
