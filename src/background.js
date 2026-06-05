const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
const DEFAULT_CAESAR_BASE_URL = 'http://localhost:5173';
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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/drawingAnnotation.js', 'src/contentDrawing.js', 'src/contentUi.js', 'src/contentScript.js', 'src/browserControlBridge.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'A2GENT_TOGGLE_OVERLAY' });
  }
});

chrome.runtime.onConnect.addListener((port) => {
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
