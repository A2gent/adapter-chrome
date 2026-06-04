const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
const DEFAULT_CAESAR_BASE_URL = 'http://localhost:5173';

const buildSessionDetailUrl = (sessionId) => `${DEFAULT_CAESAR_BASE_URL}/chat/${encodeURIComponent(sessionId)}`;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  } catch {
    // WHY: content scripts may be unavailable on newly loaded tabs or after extension reloads.
    // WHAT: inject both the MAIN-world page hook and isolated overlay script before retrying the toggle message.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/pageHook.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/drawingAnnotation.js', 'src/contentDrawing.js', 'src/contentUi.js', 'src/contentScript.js'] });
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

  if (message.type === 'A2GENT_OPEN_SESSION_DETAIL') {
    const sessionId = String(message.sessionId || '').trim();
    if (!sessionId) {
      sendResponse({ ok: false, error: 'sessionId is required' });
      return false;
    }

    // WHY: the content script owns overlay UI, but the service worker owns browser-level tab actions.
    // WHAT: open Caesar's local session detail route in a normal browser tab.
    chrome.tabs.create({ url: buildSessionDetailUrl(sessionId) }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
