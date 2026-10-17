// Toolbar popup: picking a mode stores it and shows/hides that mode's UI on the active tab.
const MODE_KEY = 'a2gent.adapterChrome.mode';

chrome.storage.local.get([MODE_KEY], (saved) => {
  const current = saved[MODE_KEY] || 'audio';
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === current));
  }
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({
      type: 'A2GENT_ACTIVATE_MODE',
      mode: button.dataset.mode,
      tab: tab ? { id: tab.id, url: tab.url } : null,
    });
    window.close();
  });
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
