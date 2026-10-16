import { validateBaseURL } from './speech.js';
let creating;
const revisions = new Map();
function invalidate(owner) {
  const revision = (revisions.get(owner) || 0) + 1;
  revisions.set(owner, revision);
  return revision;
}
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    // The bundle is importScripts()-ed (classic worker), so import.meta.url is unavailable.
    url:chrome.runtime.getURL('hearhear/offscreen.html'), reasons:['BLOBS'],
    // TTS may take >30s: AUDIO_PLAYBACK's silence timeout would kill synthesis.
    // This document owns the generated Blob URL and releases it on stop/unload.
    justification:'Fetch generated speech blobs, own their object URLs, and play them until the user stops.',
  }).finally(() => { creating = null; });
  await creating;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'background' || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
  const owner = sender.tab.id;
  const allowed = ['start','status','play','pause','restart','rate','seek','stop'];
  if (!allowed.includes(message.action)) return;
  (async () => {
    if (message.action === 'start') {
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 60000 || !['ru','en'].includes(message.language)) throw new Error('Invalid article.');
      const revision = invalidate(owner);
      await ensureOffscreen();
      const {baseURL, speechModel, playbackRate} = await chrome.storage.local.get(['baseURL', 'speechModel', 'playbackRate']);
      // Stop/navigation may arrive while the offscreen document is being created.
      if (revisions.get(owner) !== revision) return {phase:'idle'};
      return chrome.runtime.sendMessage({target:'offscreen', action:'start', owner, text:message.text, language:message.language, model:speechModel, baseURL:validateBaseURL(baseURL), rate:playbackRate});
    }
    if (message.action === 'stop') invalidate(owner);
    // Speed is a user preference: remember it for the next article even when nothing is playing.
    if (message.action === 'rate') {
      if (!Number.isFinite(message.value) || message.value < 0.5 || message.value > 3) throw new Error('Invalid rate.');
      await chrome.storage.local.set({playbackRate:message.value});
    }
    if (!await chrome.offscreen.hasDocument()) return {phase:'idle'};
    return chrome.runtime.sendMessage({target:'offscreen', action:message.action, owner, value:message.value});
  })().then(reply, error => reply({phase:'error', error:error.message}));
  return true;
});
async function stopTab(owner) {
  invalidate(owner);
  if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({target:'offscreen', action:'stop', owner});
}
chrome.tabs.onRemoved.addListener(id => { void stopTab(id).catch(() => {}); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'loading') void stopTab(id).catch(() => {});
});
