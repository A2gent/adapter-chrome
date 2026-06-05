(() => {
  if (window.__A2GENT_BROWSER_CONTROL_BRIDGE__) {
    return;
  }
  window.__A2GENT_BROWSER_CONTROL_BRIDGE__ = true;

  const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
  const STORAGE_BASE_URL_KEY = 'a2gent.adapterChrome.baseUrl';
  const SOURCE = 'adapter-chrome';
  const EXTENSION_VERSION = '0.1.0';
  const PAGE_ID_KEY = 'a2gent.adapterChrome.pageId';
  const CURSOR_ID = 'a2gent-browser-adapter-ai-cursor';
  const CURSOR_IMAGE_PATH = 'cursor.png';
  const CURSOR_WIDTH_PX = 24;
  const CURSOR_HEIGHT_PX = 35;
  const POLL_TIMEOUT_MS = 25000;
  const POLL_RETRY_MS = 1500;
  const MAX_TEXT = 60000;
  const MAX_HTML = 180000;
  const MAX_INTERACTIVE_TEXT = 300;
  const MAX_INTERACTIVE_ITEMS = 20;

  const clip = (value, max) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const ensurePageId = () => {
    try {
      const existing = window.sessionStorage.getItem(PAGE_ID_KEY);
      if (existing) return existing;
      const generated = `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.sessionStorage.setItem(PAGE_ID_KEY, generated);
      return generated;
    } catch {
      if (!window.__A2GENT_BROWSER_CONTROL_PAGE_ID__) {
        window.__A2GENT_BROWSER_CONTROL_PAGE_ID__ = `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      return window.__A2GENT_BROWSER_CONTROL_PAGE_ID__;
    }
  };

  const pageId = ensurePageId();
  const clientId = `${SOURCE}-${Math.random().toString(16).slice(2)}-${Date.now()}`;

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

  const storageGet = (key) => new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });

  const getBaseUrl = async () => validateLoopbackBaseUrl(await storageGet(STORAGE_BASE_URL_KEY) || DEFAULT_BRUTE_BASE_URL);

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

  const apiErrorDetail = (response) => {
    const body = response?.body;
    return body?.error || body?.message || response?.bodyText || `${response?.status || ''} ${response?.statusText || ''}`.trim() || 'Brute request failed.';
  };

  const apiFetch = async (path, options = {}) => {
    const baseUrl = await getBaseUrl();
    // WHY: when injected into HTTPS pages, direct content-script fetches to
    // http://localhost are blocked by Chrome Private Network Access/CORS checks.
    // WHAT: proxy Brute API calls through the extension service worker where
    // manifest host_permissions authorize loopback access independently of page origin.
    const proxied = await sendRuntimeMessage({
      type: 'A2GENT_BRUTE_API_FETCH',
      baseUrl,
      path,
      options: serializeApiOptions(options),
    });
    if (!proxied?.ok) {
      throw new Error(proxied?.error || 'Brute request failed.');
    }
    const response = proxied.response;
    if (!response?.ok) {
      throw new Error(apiErrorDetail(response));
    }
    if (response.status === 204) return null;
    return response.body;
  };

  const pageSnapshot = () => ({
    url: location.href,
    title: document.title,
    visibility_state: document.visibilityState,
    user_agent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
    },
  });

  const registerPage = async () => apiFetch('/browser-extension/pages/register', {
    method: 'POST',
    body: JSON.stringify({
      page_id: pageId,
      client_id: clientId,
      extension_version: EXTENSION_VERSION,
      page: pageSnapshot(),
    }),
  });

  const postCommandResult = async (commandId, payload) => apiFetch(`/browser-extension/commands/${encodeURIComponent(commandId)}/result`, {
    method: 'POST',
    body: JSON.stringify({
      page_id: pageId,
      client_id: clientId,
      ...payload,
    }),
  });

  const ensureCursor = () => {
    let cursor = document.getElementById(CURSOR_ID);
    if (cursor) return cursor;
    cursor = document.createElement('div');
    cursor.id = CURSOR_ID;
    cursor.setAttribute('aria-hidden', 'true');

    // WHY: a cursor-shaped asset makes agent-controlled movement feel like a real pointer,
    // instead of the previous oversized purple target marker.
    // WHAT: render the bundled PNG at normal cursor size and anchor its tip at the command coordinates.
    cursor.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      `width:${CURSOR_WIDTH_PX}px`,
      `height:${CURSOR_HEIGHT_PX}px`,
      'background-repeat:no-repeat',
      'background-position:left top',
      'background-size:100% 100%',
      'filter:drop-shadow(0 2px 3px rgba(0,0,0,.32))',
      'z-index:2147483646',
      'pointer-events:none',
      'transform:translate(0,0)',
      'transform-origin:0 0',
      'transition:left 120ms ease-out,top 120ms ease-out,opacity 160ms ease-out',
      'will-change:left,top,transform,opacity',
      'opacity:0',
    ].join(';');
    cursor.style.backgroundImage = `url("${chrome.runtime.getURL(CURSOR_IMAGE_PATH)}")`;
    document.documentElement.appendChild(cursor);
    return cursor;
  };

  const moveVirtualCursor = async (x, y) => {
    const cursor = ensureCursor();
    const nextX = Math.max(0, Math.min(window.innerWidth, Number(x) || 0));
    const nextY = Math.max(0, Math.min(window.innerHeight, Number(y) || 0));
    cursor.style.opacity = '1';
    cursor.style.left = `${nextX}px`;
    cursor.style.top = `${nextY}px`;
    return { x: nextX, y: nextY };
  };

  const flashCursor = () => {
    const cursor = ensureCursor();
    cursor.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(0,0) scale(.86)' },
      { transform: 'translate(0,0) scale(1)' },
    ], { duration: 180, easing: 'ease-out' });
  };

  const selectorForElement = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.localName;
      if (current.classList && current.classList.length > 0) {
        part += `.${Array.from(current.classList).slice(0, 2).map((name) => CSS.escape(name)).join('.')}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((candidate) => candidate.localName === current.localName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      current = parent;
      if (parts.length >= 4) break;
    }
    return parts.join(' > ');
  };

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0;
  };

  const isTypeable = (element) => {
    if (!element || element.disabled || element.readOnly) return false;
    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
  };

  const interactiveElements = (page = 1, pageSize = MAX_INTERACTIVE_ITEMS) => {
    const rawItems = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[tabindex],summary,[contenteditable="true"]'))
      .filter((element) => element.id !== CURSOR_ID && isVisible(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = clip(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '', MAX_INTERACTIVE_TEXT).trim();
        return {
          selector: selectorForElement(element),
          tag: element.tagName.toLowerCase(),
          text,
          role: element.getAttribute('role') || '',
          aria_label: element.getAttribute('aria-label') || '',
          type: element.getAttribute('type') || '',
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
          typeable: isTypeable(element),
          viewport: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            center_x: Math.round(rect.left + rect.width / 2),
            center_y: Math.round(rect.top + rect.height / 2),
          },
        };
      })
      .filter((item) => item.selector);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || MAX_INTERACTIVE_ITEMS));
    const safePage = Math.max(1, Number(page) || 1);
    const start = (safePage - 1) * safePageSize;
    return {
      page: safePage,
      page_size: safePageSize,
      total: rawItems.length,
      items: rawItems.slice(start, start + safePageSize),
    };
  };

  const findElement = (selector) => {
    const trimmed = String(selector || '').trim();
    if (!trimmed) throw new Error('selector is required');
    const element = document.querySelector(trimmed);
    if (!element) throw new Error(`element not found: ${trimmed}`);
    return element;
  };

  const dispatchMouse = (target, type, x, y) => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      view: window,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    }));
  };

  const clickAt = async (x, y) => {
    const point = await moveVirtualCursor(x, y);
    await sleep(80);
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) throw new Error(`no element at (${point.x}, ${point.y})`);
    dispatchMouse(target, 'mousemove', point.x, point.y);
    dispatchMouse(target, 'mousedown', point.x, point.y);
    dispatchMouse(target, 'mouseup', point.x, point.y);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, view: window, button: 0 }));
    flashCursor();
    return { x: point.x, y: point.y, target: selectorForElement(target), text: clip(target.textContent || '', 300) };
  };

  const clickSelector = async (selector) => {
    const element = findElement(selector);
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return clickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const typeInto = async (selector, text) => {
    const element = findElement(selector);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    element.focus({ preventScroll: true });
    const value = String(text ?? '');
    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
    } else if ('value' in element) {
      element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else {
      throw new Error(`element is not typeable: ${selector}`);
    }
    const rect = element.getBoundingClientRect();
    await moveVirtualCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { selector, text_length: value.length };
  };

  const pressKey = (key) => {
    const target = document.activeElement || document.body || document.documentElement;
    const normalized = String(key || '').trim();
    if (!normalized) throw new Error('key is required');
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: normalized,
        code: normalized.length === 1 ? `Key${normalized.toUpperCase()}` : normalized,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
    return { key: normalized, target: selectorForElement(target) };
  };

  const scrollTarget = (params) => {
    const dx = Number(params.x) || 0;
    const dy = Number(params.y) || 500;
    const selector = String(params.selector || '').trim();
    if (selector) {
      const element = findElement(selector);
      element.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      return { selector, scroll_left: element.scrollLeft, scroll_top: element.scrollTop, viewport: { x: Math.round(rect.left), y: Math.round(rect.top) } };
    }
    window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    return { scroll_x: window.scrollX, scroll_y: window.scrollY };
  };

  const evaluateInMainWorld = (script, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for page evaluation result.'));
    }, Math.max(1000, Math.min(Number(timeoutMs) || 10000, 60000)));
    function onMessage(event) {
      if (event.source !== window || !event.data || event.data.type !== 'A2GENT_PAGE_EVAL_RESULT' || event.data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (event.data.ok) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.error || 'Page evaluation failed.'));
      }
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'A2GENT_PAGE_EVAL', requestId, script: String(script || '') }, '*');
  });

  const getPageDiagnosticsFromMainWorld = (detailLevel = 'compact') => new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ console_logs: [], page_errors: [], network_activity: [], capture_note: 'Timed out waiting for page diagnostics hook.' });
    }, 1000);
    function onMessage(event) {
      if (event.source !== window || !event.data || event.data.type !== 'A2GENT_PAGE_DIAGNOSTICS' || event.data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(event.data.payload || { console_logs: [], page_errors: [], network_activity: [] });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'A2GENT_GET_PAGE_DIAGNOSTICS', requestId, detailLevel }, '*');
  });

  const captureScreenshot = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'A2GENT_CAPTURE_VISIBLE_TAB' });
    if (!response || !response.ok || !response.dataUrl) {
      throw new Error(response?.error || 'Failed to capture visible tab.');
    }
    return { data_url: response.dataUrl, media_type: 'image/png' };
  };

  const collectDiagnostics = async (detailLevel = 'full') => {
    const pageDiagnostics = await getPageDiagnosticsFromMainWorld(detailLevel);
    return {
      schema: 'a2gent.browser.control_diagnostic.v1',
      source: SOURCE,
      extension_version: EXTENSION_VERSION,
      captured_at: new Date().toISOString(),
      page: pageSnapshot(),
      selected_text: clip((window.getSelection && window.getSelection()?.toString()) || '', 12000).trim(),
      dom_snapshot: {
        html: clip(document.documentElement?.outerHTML || '', MAX_HTML),
        text: clip(document.body?.innerText || document.documentElement?.textContent || '', MAX_TEXT),
        active_element: document.activeElement ? {
          tag: document.activeElement.tagName,
          selector: selectorForElement(document.activeElement),
          aria_label: document.activeElement.getAttribute('aria-label') || '',
        } : null,
      },
      console_logs: pageDiagnostics.console_logs || [],
      page_errors: pageDiagnostics.page_errors || [],
      network_activity: pageDiagnostics.network_activity || [],
    };
  };

  const executeCommand = async (command) => {
    const params = command?.params || {};
    switch (command?.action) {
      case 'eval':
        return { value: await evaluateInMainWorld(params.script, command.timeout_ms) };
      case 'get_text':
        return { text: clip(document.body?.innerText || document.documentElement?.textContent || '', MAX_TEXT), page: pageSnapshot() };
      case 'read_content':
        return { html: clip(document.documentElement?.outerHTML || '', MAX_HTML), page: pageSnapshot() };
      case 'get_interactive_elements':
        return interactiveElements(params.page, params.page_size);
      case 'type':
        return typeInto(params.selector, params.text);
      case 'press_key':
        return pressKey(params.key);
      case 'click':
        return clickSelector(params.selector);
      case 'click_at':
        return clickAt(params.x, params.y);
      case 'move_mouse':
        return moveVirtualCursor(params.x, params.y);
      case 'scroll':
        return scrollTarget(params);
      case 'get_console_logs': {
        const diagnostics = await getPageDiagnosticsFromMainWorld(params.detail_level || 'full');
        return { console_logs: diagnostics.console_logs || [], page_errors: diagnostics.page_errors || [] };
      }
      case 'get_network_logs': {
        const diagnostics = await getPageDiagnosticsFromMainWorld(params.detail_level || 'full');
        return { network_activity: diagnostics.network_activity || [] };
      }
      case 'get_diagnostics':
        return collectDiagnostics(params.detail_level || 'full');
      case 'screenshot':
        return captureScreenshot();
      default:
        throw new Error(`Unsupported command action: ${command?.action || ''}`);
    }
  };

  const pollLoop = async () => {
    for (;;) {
      try {
        const response = await apiFetch(`/browser-extension/pages/${encodeURIComponent(pageId)}/poll`, {
          method: 'POST',
          body: JSON.stringify({
            client_id: clientId,
            extension_version: EXTENSION_VERSION,
            timeout_ms: POLL_TIMEOUT_MS,
            page: pageSnapshot(),
          }),
        });
        const command = response?.command;
        if (!command?.id) {
          continue;
        }
        try {
          const result = await executeCommand(command);
          await postCommandResult(command.id, { ok: true, result });
        } catch (error) {
          await postCommandResult(command.id, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      } catch {
        await sleep(POLL_RETRY_MS);
      }
    }
  };

  const start = async () => {
    for (;;) {
      try {
        await registerPage();
        break;
      } catch {
        await sleep(POLL_RETRY_MS);
      }
    }
    void pollLoop();
    window.setInterval(() => {
      void registerPage().catch(() => {});
    }, 30000);
  };

  void start();
})();
