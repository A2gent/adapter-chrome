(() => {
  const MAX_LOGS = 400;
  const MAX_NETWORK_COMPACT = 20;
  const MAX_NETWORK_FULL = 400;
  const OVERLAY_SUBMIT_EVENT = 'a2gent-overlay-submit';

  const installKeyboardShield = () => {
    if (window.__A2GENT_BROWSER_ADAPTER_KEYBOARD_SHIELDED__) {
      return;
    }
    window.__A2GENT_BROWSER_ADAPTER_KEYBOARD_SHIELDED__ = true;

    const overlayEventPath = (event) => {
      try {
        return typeof event.composedPath === 'function' ? event.composedPath() : [];
      } catch {
        return [];
      }
    };

    const getOverlayHost = () => document.getElementById('a2gent-browser-adapter-root');

    const isOverlayOpen = (host) => {
      if (!host || !host.isConnected) return false;
      try {
        return window.getComputedStyle(host).display !== 'none';
      } catch {
        return false;
      }
    };

    const isOverlayKeyboardEvent = (event, host) => {
      const path = overlayEventPath(event);
      if (path.includes(host)) return true;
      return event.target === host || (event.target instanceof Node && host.contains(event.target));
    };

    const overlayEventRole = (event) => {
      for (const node of overlayEventPath(event)) {
        if (node && typeof node.getAttribute === 'function') {
          const role = node.getAttribute('data-role');
          if (role) return role;
        }
      }
      return '';
    };

    // WHY: overlay composers should submit like chat inputs while the host page is shielded from shortcuts.
    // WHAT: plain Enter submits, Shift+Enter inserts a newline, and IME composition Enter is ignored.
    const shouldSubmitOverlayComposer = (event, role) => (
      event.type === 'keydown'
      && (role === 'prompt' || role === 'followup')
      && event.key === 'Enter'
      && !event.shiftKey
      && !event.isComposing
      && event.keyCode !== 229
    );

    const handleOverlayKeyboardEvent = (event) => {
      const host = getOverlayHost();
      if (!isOverlayOpen(host) || !isOverlayKeyboardEvent(event, host)) return;

      const role = overlayEventRole(event);
      if (shouldSubmitOverlayComposer(event, role)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(OVERLAY_SUBMIT_EVENT, { detail: role }));
      }

      // WHY: site shortcut handlers such as YouTube's live in the page's MAIN world, where
      // Shadow DOM retargeting can make overlay textarea keystrokes look like page-level keys.
      // WHAT: stop overlay-originated key events in MAIN world without preventing normal text editing.
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(eventType, handleOverlayKeyboardEvent, { capture: true });
      document.addEventListener(eventType, handleOverlayKeyboardEvent, { capture: true });
    }
  };

  installKeyboardShield();

  if (window.__A2GENT_BROWSER_ADAPTER_HOOKED__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_HOOKED__ = true;

  const logs = [];
  const errors = [];
  const network = [];

  const clip = (value, limit = 12000) => {
    let text = '';
    try {
      if (typeof value === 'string') {
        text = value;
      } else if (value instanceof Error) {
        text = `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
      } else {
        text = JSON.stringify(value);
      }
    } catch {
      text = String(value);
    }
    return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
  };

  const pushBounded = (target, entry, max) => {
    target.push(entry);
    if (target.length > max) {
      target.splice(0, target.length - max);
    }
  };

  const serializeArgs = (args) => args.map((arg) => clip(arg, 4000));

  const endpointFromUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.href);
      // WHY: request query strings/fragments can be large and often contain tokens.
      // WHAT: keep only the endpoint identity so diagnostics stay model-sized.
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
        return `${parsed.protocol}[omitted]`;
      }
      if (parsed.origin && parsed.origin !== 'null') {
        return `${parsed.origin}${parsed.pathname || '/'}`;
      }
      return `${parsed.protocol}${parsed.pathname || ''}`;
    } catch {
      return raw.replace(/[?#].*$/, '');
    }
  };

  const compactNetworkEntry = (entry) => {
    const out = {
      captured_at: new Date().toISOString(),
      type: entry.type || 'network',
      method: String(entry.method || 'GET').toUpperCase(),
      url: endpointFromUrl(entry.url),
    };
    const status = Number(entry.status);
    if (Number.isFinite(status)) {
      out.status = status;
    }
    if (entry.statusText) {
      out.status_text = clip(entry.statusText, 160);
    }
    const durationMs = Number(entry.durationMs);
    if (Number.isFinite(durationMs)) {
      out.duration_ms = Math.round(durationMs);
    }
    if (entry.error) {
      out.error_message = clip(entry.error instanceof Error ? entry.error.message || String(entry.error) : entry.error, 500);
    }
    return out;
  };

  const latestLogs = () => logs.slice(-MAX_LOGS);

  const latestNetwork = () => network
    .slice()
    .sort((a, b) => (Date.parse(a.captured_at || '') || 0) - (Date.parse(b.captured_at || '') || 0))
    .slice(-MAX_NETWORK_COMPACT)
    .map((entry) => entry.compact || compactNetworkEntry(entry));

  const recordNetwork = (entry) => {
    // WHY: default diagnostic prompts must stay compact, while agent-driven tools can
    // ask Brute for the full in-memory record on demand.
    // WHAT: store bounded full records here, but latestNetwork() still returns compact latest-20.
    pushBounded(network, {
      ...entry,
      captured_at: new Date().toISOString(),
      method: String(entry.method || 'GET').toUpperCase(),
      url: String(entry.url || ''),
      compact: compactNetworkEntry(entry),
      error_message: entry.error ? clip(entry.error instanceof Error ? entry.error.message || String(entry.error) : entry.error, 2000) : undefined,
    }, MAX_NETWORK_FULL);
  };

  for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function a2gentConsoleProxy(...args) {
      pushBounded(logs, {
        captured_at: new Date().toISOString(),
        level,
        args: serializeArgs(args),
      }, MAX_LOGS);
      return original.apply(this, args);
    };
  }

  window.addEventListener('error', (event) => {
    pushBounded(errors, {
      captured_at: new Date().toISOString(),
      type: 'error',
      message: event.message || '',
      source: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
      error: event.error ? clip(event.error, 8000) : '',
    }, MAX_LOGS);
  });

  window.addEventListener('unhandledrejection', (event) => {
    pushBounded(errors, {
      captured_at: new Date().toISOString(),
      type: 'unhandledrejection',
      reason: clip(event.reason, 8000),
    }, MAX_LOGS);
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function a2gentFetchProxy(input, init = undefined) {
      const startedAt = Date.now();
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      try {
        const response = await originalFetch.apply(this, arguments);
        recordNetwork({
          type: 'fetch',
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        recordNetwork({
          type: 'fetch',
          url,
          method,
          error,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === 'function') {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function a2gentXHROpen(method, url) {
      this.__a2gentRequest = {
        type: 'xhr',
        method: String(method || 'GET'),
        url: String(url || ''),
      };
      return originalOpen.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function a2gentXHRSend() {
      const startedAt = Date.now();
      const req = this.__a2gentRequest || { type: 'xhr', method: 'GET', url: '' };
      this.addEventListener('loadend', () => {
        recordNetwork({
          ...req,
          status: this.status,
          statusText: this.statusText,
          durationMs: Date.now() - startedAt,
        });
      });
      return originalSend.apply(this, arguments);
    };
  }

  const fullNetwork = () => network
    .slice()
    .sort((a, b) => (Date.parse(a.captured_at || '') || 0) - (Date.parse(b.captured_at || '') || 0))
    .map((entry) => {
      const out = {
        captured_at: entry.captured_at || new Date().toISOString(),
        type: entry.type || 'network',
        method: String(entry.method || 'GET').toUpperCase(),
        url: String(entry.url || ''),
      };
      const status = Number(entry.status);
      if (Number.isFinite(status)) out.status = status;
      if (entry.statusText) out.status_text = clip(entry.statusText, 500);
      const durationMs = Number(entry.durationMs);
      if (Number.isFinite(durationMs)) out.duration_ms = Math.round(durationMs);
      if (entry.error_message || entry.error) out.error_message = clip(entry.error_message || entry.error, 2000);
      return out;
    });

  const serializeEvalResult = (value) => {
    if (value === undefined) return null;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (value instanceof Element) {
      return {
        node_type: 'element',
        tag: value.tagName,
        id: value.id || '',
        class_name: value.className || '',
        text: clip(value.textContent || '', 2000),
      };
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return clip(String(value), 8000);
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    if (event.data.type === 'A2GENT_GET_PAGE_DIAGNOSTICS') {
      const detailLevel = event.data.detailLevel || 'compact';
      const includeFull = detailLevel === 'full';
      window.postMessage({
        type: 'A2GENT_PAGE_DIAGNOSTICS',
        requestId: event.data.requestId,
        payload: {
          console_logs: includeFull ? logs.slice() : latestLogs(),
          page_errors: includeFull ? errors.slice() : errors.slice(-MAX_LOGS),
          network_activity: includeFull ? fullNetwork() : latestNetwork(),
        },
      }, '*');
      return;
    }

    if (event.data.type === 'A2GENT_PAGE_EVAL') {
      const requestId = event.data.requestId;
      Promise.resolve()
        .then(() => (0, eval)(String(event.data.script || '')))
        .then((result) => {
          window.postMessage({ type: 'A2GENT_PAGE_EVAL_RESULT', requestId, ok: true, result: serializeEvalResult(result) }, '*');
        })
        .catch((error) => {
          window.postMessage({ type: 'A2GENT_PAGE_EVAL_RESULT', requestId, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }, '*');
        });
    }
  });
})();
