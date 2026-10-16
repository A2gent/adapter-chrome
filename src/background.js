const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
const DEFAULT_CAESAR_BASE_URL = 'https://my.a2gent.net';
const STORAGE_BASE_URL_KEY = 'a2gent.adapterChrome.baseUrl';

const buildSessionDetailUrl = (sessionId) => `${DEFAULT_CAESAR_BASE_URL}/chat/${encodeURIComponent(sessionId)}`;

const validateLoopbackBaseUrl = (raw) => {
  const parsed = new URL(String(raw || '').trim() || DEFAULT_BRUTE_BASE_URL);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Brute base URL must use http:// or https://.');
  }
  const hostName = parsed.hostname.toLowerCase();
  const isLoopback = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]' || hostName === '::1';
  if (!isLoopback) {
    throw new Error('Brute base URL must be loopback-only.');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
};

const normalizeApiPath = (path) => {
  const value = String(path || '');
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new Error('Brute API path must be a root-relative path.');
  }
  return value;
};

const storageGet = (key) => new Promise((resolve) => {
  chrome.storage.local.get([key], (result) => resolve(result[key]));
});

const getBruteBaseUrl = async (overrideBaseUrl) => validateLoopbackBaseUrl(
  overrideBaseUrl || await storageGet(STORAGE_BASE_URL_KEY) || DEFAULT_BRUTE_BASE_URL,
);

const normalizeHeaders = (headers) => {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
};

const buildBruteRequest = async ({ baseUrl, path, options = {} }) => {
  const requestOptions = options && typeof options === 'object' ? options : {};
  const headers = normalizeHeaders(requestOptions.headers);
  const body = requestOptions.body;

  return {
    url: `${await getBruteBaseUrl(baseUrl)}${normalizeApiPath(path)}`,
    init: {
      method: requestOptions.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body,
      // WHY: Brute uses a local no-auth trust model; the extension must never forward
      // localhost cookies that a normal browser request might otherwise attach.
      // WHAT: perform all proxied Brute requests without browser credentials.
      credentials: 'omit',
    },
  };
};

const parseResponseBody = async (response) => {
  const bodyText = await response.text();
  if (!bodyText) return { body: null, bodyText: '' };
  try {
    return { body: JSON.parse(bodyText), bodyText };
  } catch {
    return { body: null, bodyText };
  }
};

const fetchBruteJson = async (request) => {
  const { url, init } = await buildBruteRequest(request);
  const response = await fetch(url, init);
  const { body, bodyText } = await parseResponseBody(response);
  return {
    ok: true,
    response: {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      bodyText,
    },
  };
};

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const errorDetailFromApiResponse = (response) => {
  const body = response?.body;
  return body?.error || body?.message || response?.bodyText || `${response?.status || ''} ${response?.statusText || ''}`.trim() || 'Brute request failed.';
};

const postPortMessage = (port, payload) => {
  try {
    port.postMessage(payload);
    return true;
  } catch {
    return false;
  }
};

const streamBruteResponseToPort = async (port, message) => {
  const requestId = String(message.requestId || '');
  const abortController = new AbortController();
  let disconnected = false;
  const onDisconnect = () => {
    disconnected = true;
    abortController.abort();
  };

  port.onDisconnect.addListener(onDisconnect);
  try {
    const { url, init } = await buildBruteRequest({
      baseUrl: message.baseUrl,
      path: message.path,
      options: message.options,
    });
    const response = await fetch(url, { ...init, signal: abortController.signal });

    if (!response.ok || !response.body) {
      const parsed = await parseResponseBody(response);
      postPortMessage(port, {
        type: 'A2GENT_BRUTE_STREAM_ERROR',
        requestId,
        error: errorDetailFromApiResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          ...parsed,
        }),
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk && !disconnected && !postPortMessage(port, { type: 'A2GENT_BRUTE_STREAM_CHUNK', requestId, chunk })) {
        return;
      }
    }
    const tail = decoder.decode();
    if (tail && !disconnected) {
      postPortMessage(port, { type: 'A2GENT_BRUTE_STREAM_CHUNK', requestId, chunk: tail });
    }
    if (!disconnected) {
      postPortMessage(port, { type: 'A2GENT_BRUTE_STREAM_DONE', requestId });
    }
  } catch (error) {
    if (!disconnected) {
      postPortMessage(port, { type: 'A2GENT_BRUTE_STREAM_ERROR', requestId, error: errorMessage(error) });
    }
  } finally {
    try {
      port.onDisconnect.removeListener(onDisconnect);
    } catch {
      // Ignore listener cleanup errors after disconnect.
    }
  }
};

// WHY: per-tab HTTP long-polling hit Brute every few seconds for every open tab.
// WHAT: the service worker keeps one WebSocket to Brute for all tabs. Tabs connect
// via a runtime port, register their page_id, and receive pushed commands. The
// socket is opened only while at least one tab is connected.
const BROWSER_CONTROL_PORT = 'A2GENT_BROWSER_CONTROL';
const CONTROL_WS_PATH = '/browser-extension/ws';
// Chrome 116+ keeps an MV3 service worker alive while WebSocket traffic flows
// at least every 30s; the ping also refreshes page liveness in Brute.
const CONTROL_WS_KEEPALIVE_MS = 20000;
const CONTROL_WS_RECONNECT_MS = 2000;

const controlPages = new Map(); // page_id -> { port, register }
let controlSocket = null;
let controlKeepaliveTimer = null;
let controlReconnectTimer = null;

const sendControl = (message) => {
  if (controlSocket?.readyState !== WebSocket.OPEN) return false;
  try {
    controlSocket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

const scheduleControlReconnect = () => {
  if (controlReconnectTimer || controlPages.size === 0) return;
  controlReconnectTimer = setTimeout(() => {
    controlReconnectTimer = null;
    void ensureControlSocket();
  }, CONTROL_WS_RECONNECT_MS);
};

const ensureControlSocket = async () => {
  if (controlSocket || controlPages.size === 0) return;
  let url;
  try {
    url = `${(await getBruteBaseUrl()).replace(/^http/, 'ws')}${CONTROL_WS_PATH}`;
  } catch {
    scheduleControlReconnect();
    return;
  }
  // Another call may have opened the socket while the base URL was loading.
  if (controlSocket || controlPages.size === 0) return;

  const socket = new WebSocket(url);
  controlSocket = socket;
  socket.onopen = () => {
    for (const entry of controlPages.values()) sendControl(entry.register);
    controlKeepaliveTimer = setInterval(() => sendControl({ type: 'ping' }), CONTROL_WS_KEEPALIVE_MS);
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message?.type !== 'command') return;
    const entry = controlPages.get(message.page_id);
    if (!entry) return;
    if (['open_tab', 'navigate', 'close_tab'].includes(message.command?.action)) {
      void handleTabCommand(message, entry).catch((error) => console.warn('Tab command result failed:', errorMessage(error)));
    } else {
      postPortMessage(entry.port, message);
    }
  };
  socket.onclose = () => {
    if (controlSocket !== socket) return;
    controlSocket = null;
    clearInterval(controlKeepaliveTimer);
    controlKeepaliveTimer = null;
    scheduleControlReconnect();
  };
};

const closeControlSocketIfIdle = () => {
  if (controlPages.size > 0 || !controlSocket) return;
  const socket = controlSocket;
  controlSocket = null;
  clearInterval(controlKeepaliveTimer);
  controlKeepaliveTimer = null;
  socket.close();
};

const unregisterControlPage = (pageId, entry) => {
  if (controlPages.get(pageId) !== entry) return;
  controlPages.delete(pageId);
  sendControl({ type: 'unregister', page_id: pageId });
  closeControlSocketIfIdle();
};

const handleTabCommand = async (message, entry) => {
  const { command, page_id: pageId } = message;
  entry.pendingTabCommands = (entry.pendingTabCommands || 0) + 1;
  const payload = { page_id: pageId, ok: false };
  try {
    const tabId = entry.port.sender?.tab?.id;
    if (!Number.isInteger(tabId)) throw new Error('Browser control requires a sender tab.');
    if (command.action === 'close_tab') {
      await chrome.tabs.remove(tabId);
      payload.ok = true;
      payload.result = { tab_id: tabId, closed: true };
    } else {
      const url = new URL(String(command.params?.url || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Tab URL must use http:// or https://.');
      }
      const tab = command.action === 'open_tab'
        ? await chrome.tabs.create({ url: url.href, active: true })
        : await chrome.tabs.update(tabId, { url: url.href });
      payload.ok = true;
      payload.result = { tab_id: tab.id, window_id: tab.windowId, url: url.href };
    }
  } catch (error) {
    payload.error = errorMessage(error);
  }
  try {
    // Navigation or closing can destroy the source port before the tab API resolves. Keep
    // its server registration until the result is acknowledged, or Brute fails
    // the pending command as disconnected instead of returning its result.
    await fetchBruteJson({
      path: `/browser-extension/commands/${encodeURIComponent(command.id)}/result`,
      options: { method: 'POST', body: JSON.stringify(payload) },
    });
  } finally {
    entry.pendingTabCommands -= 1;
    if (entry.disconnected && !entry.pendingTabCommands) unregisterControlPage(pageId, entry);
  }
};

const handleBrowserControlPort = (port) => {
  let pageId = '';
  port.onMessage.addListener((message) => {
    if (message?.type !== 'register' || !message.page_id) return;
    pageId = String(message.page_id);
    const register = { ...message, type: 'register', page_id: pageId };
    const existing = controlPages.get(pageId);
    if (existing?.port === port) existing.register = register;
    else controlPages.set(pageId, { port, register });
    if (!sendControl(register)) void ensureControlSocket();
  });
  port.onDisconnect.addListener(() => {
    if (!pageId || controlPages.get(pageId)?.port !== port) return;
    const entry = controlPages.get(pageId);
    entry.disconnected = true;
    if (!entry.pendingTabCommands) unregisterControlPage(pageId, entry);
  });
};

chrome.storage.onChanged?.addListener((changes, areaName) => {
  // Reconnect to the new Brute URL; onclose schedules the reconnect.
  if (areaName === 'local' && changes[STORAGE_BASE_URL_KEY]) controlSocket?.close();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^(?:https?|file):\/\//i.test(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  } catch {
    // WHY: content scripts may be unavailable on newly loaded tabs or after extension reloads.
    // WHAT: inject both the MAIN-world page hook and isolated overlay script before retrying the toggle message.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/pageHook.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/drawingAnnotation.js', 'src/contentDrawing.js', 'src/contentUi.js', 'src/contentScript/shared.js', 'src/contentScript/sessionLaunch.js', 'src/contentScript/projectMatching.js', 'src/contentScript/diagnosticsHelpers.js', 'src/contentScript/overlayFocus.js', 'src/contentScript/drawingBridge.js', 'src/contentScript/sessionEvents.js', 'src/contentScript/caesarApi.js', 'src/contentScript/pageDiagnostics.js', 'src/contentScript/projectSettings.js', 'src/contentScript/renderWiring.js', 'src/contentScript.js', 'src/browserControlBridge.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === BROWSER_CONTROL_PORT) {
    handleBrowserControlPort(port);
    return;
  }
  if (port.name !== 'A2GENT_BRUTE_STREAM') return;

  let started = false;
  port.onMessage.addListener((message) => {
    if (started) return;
    started = true;
    if (!message || message.type !== 'A2GENT_BRUTE_STREAM_START') {
      postPortMessage(port, { type: 'A2GENT_BRUTE_STREAM_ERROR', requestId: message?.requestId || '', error: 'Invalid Brute stream request.' });
      return;
    }
    // WHY: content scripts on HTTPS pages cannot fetch http://localhost because
    // Chrome treats it as a public-page-to-loopback Private Network Access request.
    // WHAT: proxy the stream from the extension service worker, where manifest
    // host_permissions authorize loopback access without involving the page origin.
    void streamBruteResponseToPort(port, message);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'A2GENT_BRUTE_API_FETCH') {
    // WHY: direct fetch() from a content script inherits the HTTPS page origin and
    // Chrome blocks public origins from accessing the loopback address space.
    // WHAT: proxy JSON Brute API calls through the extension service worker.
    void fetchBruteJson(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
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
