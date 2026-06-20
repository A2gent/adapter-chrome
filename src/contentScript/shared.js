((root, factory) => {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_SHARED__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
  const DEFAULT_CAESAR_BASE_URL = 'http://localhost:5173';
  const STORAGE_BASE_URL_KEY = 'a2gent.adapterChrome.baseUrl';
  const SOURCE = 'adapter-chrome';
  const EXTENSION_VERSION = '0.1.0';
  const OVERLAY_SUBMIT_EVENT = 'a2gent-overlay-submit';
  const DRAWING_CHANGE_EVENT = 'A2GENT_DRAWING_CHANGED';
  const DRAWING_ROOT_ID = 'a2gent-browser-adapter-drawing-root';
  const MAX_SELECTED_TEXT_LIGHT = 4000;
  const MAX_SELECTED_TEXT_FULL = 12000;
  const MAX_DOM_HTML = 180000;
  const MAX_DOM_TEXT = 60000;
  const MAX_NETWORK_ENTRIES = 20;
  // WHY: the unopened-session overlay should behave like Caesar's compact composer
  // instead of covering a large part of the current browser page.
  // WHAT: use a short default/minimum height and expand only for settings/history views.
  const COMPACT_OVERLAY_HEIGHT = 176;
  const COMPACT_OVERLAY_MIN_HEIGHT = 144;
  const EXPANDED_OVERLAY_MIN_HEIGHT = 240;

  const clip = (value, max) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  };

  const nowIso = () => new Date().toISOString();

  // WHY: sessions are persisted in Brute, but users inspect them in Caesar's browser UI.
  // WHAT: build the local Caesar chat/session-detail URL opened by the Open Session button.
  const buildSessionDetailUrl = (sessionId) => `${DEFAULT_CAESAR_BASE_URL}/chat/${encodeURIComponent(sessionId)}`;

  const storageGet = (key) => new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });

  const storageSet = (key, value) => new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });

  const validateLoopbackBaseUrl = (raw) => {
    try {
      const parsed = new URL(String(raw || '').trim() || DEFAULT_BRUTE_BASE_URL);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Use http:// or https:// loopback URLs only.');
      }
      const hostName = parsed.hostname.toLowerCase();
      const isLoopback = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]' || hostName === '::1';
      if (!isLoopback) {
        throw new Error('Brute base URL must be localhost, 127.0.0.1, or ::1.');
      }
      parsed.hash = '';
      parsed.search = '';
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('Invalid Brute base URL.');
    }
  };

  const serializeApiOptions = (options = {}) => {
    const serialized = { method: options.method || 'GET' };
    if (options.headers) serialized.headers = options.headers;
    if (Object.prototype.hasOwnProperty.call(options, 'body')) serialized.body = options.body;
    return serialized;
  };

  const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });

  const upsertAnnotationReferenceText = (currentText, reference) => {
    const number = Math.max(1, Math.round(Number(reference?.number) || 0));
    const text = String(reference?.text || '').trim();
    if (!number || !text) return String(currentText || '');

    const referenceLine = `${number}: ${text}`;
    const lines = String(currentText || '').split('\n');
    const linePattern = new RegExp(`^\\s*${number}\\s*:`);
    const existingIndex = lines.findIndex((line) => linePattern.test(line));
    if (existingIndex >= 0) {
      lines[existingIndex] = referenceLine;
      return lines.join('\n');
    }

    const prefix = String(currentText || '').trimEnd();
    if (!prefix) return referenceLine;
    return `${prefix}\n${referenceLine}`;
  };

  // WHY: message history can be absent during the first annotated-session submit
  // or malformed from a stream event; spreading non-arrays breaks submission.
  // WHAT: normalize to the small role/content/timestamp shape used by the overlay.
  const normalizeMessages = (messages) => (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      content: message.content || '',
      timestamp: message.timestamp || nowIso(),
    }));

  return {
    DEFAULT_BRUTE_BASE_URL,
    DEFAULT_CAESAR_BASE_URL,
    STORAGE_BASE_URL_KEY,
    SOURCE,
    EXTENSION_VERSION,
    OVERLAY_SUBMIT_EVENT,
    DRAWING_CHANGE_EVENT,
    DRAWING_ROOT_ID,
    MAX_SELECTED_TEXT_LIGHT,
    MAX_SELECTED_TEXT_FULL,
    MAX_DOM_HTML,
    MAX_DOM_TEXT,
    MAX_NETWORK_ENTRIES,
    COMPACT_OVERLAY_HEIGHT,
    COMPACT_OVERLAY_MIN_HEIGHT,
    EXPANDED_OVERLAY_MIN_HEIGHT,
    clip,
    nowIso,
    buildSessionDetailUrl,
    storageGet,
    storageSet,
    validateLoopbackBaseUrl,
    serializeApiOptions,
    sendRuntimeMessage,
    upsertAnnotationReferenceText,
    normalizeMessages,
  };
});
