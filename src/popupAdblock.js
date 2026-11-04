// Popup adblock row. Every change reloads the tab, so pages never need undo logic for hidden ads.
(async () => {
  const STORAGE_KEY = 'a2gent.adapterChrome.adblock';
  const enabled = document.getElementById('adblock');
  const pause = document.getElementById('adblock-pause');
  const reset = document.getElementById('adblock-reset');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = /^https?:/.test(tab?.url || '') ? new URL(tab.url).hostname : '';
  const state = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const paused = Boolean(state.paused?.[host]);
  const learned = Object.values(state.sites?.[host]?.verdicts || {}).filter((verdict) => verdict === 'ad').length;

  enabled.checked = Boolean(state.enabled);
  pause.disabled = !state.enabled || !host;
  pause.setAttribute('aria-pressed', String(paused));
  reset.disabled = !host || !Object.keys(state.sites?.[host]?.verdicts || {}).length;
  document.getElementById('adblock-count').textContent = learned || '';
  if (state.enabled && state.error) document.getElementById('error').textContent = state.error;

  const apply = async (message) => {
    const result = await chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!result?.ok) {
      document.getElementById('error').textContent = result?.error || 'Failed';
      return;
    }
    if (tab?.id && host) await chrome.tabs.reload(tab.id);
    window.close();
  };

  enabled.addEventListener('change', () => apply({ type: 'A2GENT_ADBLOCK_SET_ENABLED', enabled: enabled.checked }));
  pause.addEventListener('click', () => apply({ type: 'A2GENT_ADBLOCK_SET_PAUSED', host, paused: !paused }));
  reset.addEventListener('click', () => apply({ type: 'A2GENT_ADBLOCK_RESET_SITE', host }));
})();
