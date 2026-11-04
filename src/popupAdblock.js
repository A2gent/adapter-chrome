// Popup adblock row. Every change reloads the tab, so pages never need undo logic for hidden ads.
(async () => {
  const STORAGE_KEY = 'a2gent.adapterChrome.adblock';
  const enabled = document.getElementById('adblock');
  const site = document.getElementById('adblock-site');
  const reset = document.getElementById('adblock-reset');
  const error = document.getElementById('error');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = /^https?:/.test(tab?.url || '') ? new URL(tab.url).hostname : '';
  const state = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const learned = Object.values(state.sites?.[host]?.verdicts || {}).filter((verdict) => verdict === 'ad').length;

  enabled.checked = Boolean(state.enabled);
  site.checked = !state.paused?.[host];
  site.parentElement.hidden = !state.enabled || !host;
  document.getElementById('adblock-host').textContent = host.replace(/^www\./, '');
  reset.hidden = !host || !Object.keys(state.sites?.[host]?.verdicts || {}).length;
  document.getElementById('adblock-count').textContent = learned || '';
  if (state.classifier?.backend) enabled.parentElement.title = [state.classifier.backend, state.classifier.model].filter(Boolean).join(' / ');

  const apply = async (message) => {
    const result = await chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!result?.ok) {
      error.textContent = result?.error || 'Failed';
      return;
    }
    if (tab?.id && host) await chrome.tabs.reload(tab.id);
    window.close();
  };

  enabled.addEventListener('change', () => apply({ type: 'A2GENT_ADBLOCK_SET_ENABLED', enabled: enabled.checked }));
  site.addEventListener('change', () => apply({ type: 'A2GENT_ADBLOCK_SET_PAUSED', host, paused: !site.checked }));
  reset.addEventListener('click', () => apply({ type: 'A2GENT_ADBLOCK_RESET_SITE', host }));

  if (state.enabled) {
    const status = await chrome.runtime.sendMessage({ type: 'A2GENT_ADBLOCK_CHECK' }).catch(() => null);
    error.textContent = status?.error || '';
  }
})();
