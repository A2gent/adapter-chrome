const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  } catch {
    // WHY: content scripts may be unavailable on newly loaded tabs or after extension reloads.
    // WHAT: inject the script on demand, then retry the toggle message.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/contentScript.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'A2GENT_CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  if (message.type === 'A2GENT_GET_DEFAULT_BASE_URL') {
    sendResponse({ ok: true, baseUrl: DEFAULT_BRUTE_BASE_URL });
    return false;
  }

  return false;
});
