(() => {
  if (window.__A2GENT_BROWSER_ADAPTER_HOOKED__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_HOOKED__ = true;

  const MAX_LOGS = 400;
  const MAX_NETWORK = 200;
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

  const cloneHeaders = (headers) => {
    const out = {};
    try {
      if (!headers) return out;
      new Headers(headers).forEach((value, key) => {
        // Cookies are explicitly excluded by the product spec.
        if (key.toLowerCase() !== 'cookie' && key.toLowerCase() !== 'set-cookie') {
          out[key] = value;
        }
      });
    } catch {
      // Ignore opaque header shapes.
    }
    return out;
  };

  const recordNetwork = (entry) => pushBounded(network, entry, MAX_NETWORK);

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function a2gentFetchProxy(input, init = undefined) {
      const startedAt = Date.now();
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const requestHeaders = cloneHeaders((init && init.headers) || (input && input.headers));
      let requestBody = '';
      if (init && init.body && typeof init.body === 'string') {
        requestBody = clip(init.body, 16000);
      }
      try {
        const response = await originalFetch.apply(this, arguments);
        const clone = response.clone();
        const responseHeaders = cloneHeaders(clone.headers);
        let responseBody = '';
        try {
          const contentType = clone.headers.get('content-type') || '';
          if (/json|text|xml|html|javascript|css/i.test(contentType)) {
            responseBody = clip(await clone.text(), 32000);
          }
        } catch {
          responseBody = '';
        }
        recordNetwork({
          captured_at: new Date().toISOString(),
          type: 'fetch',
          url,
          method,
          request_headers: requestHeaders,
          request_body: requestBody,
          status: response.status,
          status_text: response.statusText,
          response_headers: responseHeaders,
          response_body: responseBody,
          duration_ms: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        recordNetwork({
          captured_at: new Date().toISOString(),
          type: 'fetch',
          url,
          method,
          request_headers: requestHeaders,
          request_body: requestBody,
          error: clip(error, 8000),
          duration_ms: Date.now() - startedAt,
        });
        throw error;
      }
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === 'function') {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function a2gentXHROpen(method, url) {
      this.__a2gentRequest = {
        type: 'xhr',
        method: String(method || 'GET'),
        url: String(url || ''),
        request_headers: {},
      };
      return originalOpen.apply(this, arguments);
    };
    OriginalXHR.prototype.setRequestHeader = function a2gentXHRHeader(name, value) {
      const lower = String(name || '').toLowerCase();
      if (this.__a2gentRequest && lower !== 'cookie' && lower !== 'set-cookie') {
        this.__a2gentRequest.request_headers[String(name)] = String(value);
      }
      return originalSetRequestHeader.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function a2gentXHRSend(body) {
      const startedAt = Date.now();
      const req = this.__a2gentRequest || { type: 'xhr', method: 'GET', url: '', request_headers: {} };
      req.request_body = typeof body === 'string' ? clip(body, 16000) : '';
      this.addEventListener('loadend', () => {
        const responseHeaders = {};
        try {
          const raw = this.getAllResponseHeaders() || '';
          for (const line of raw.trim().split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim();
            const lower = key.toLowerCase();
            if (lower === 'cookie' || lower === 'set-cookie') continue;
            responseHeaders[key] = line.slice(idx + 1).trim();
          }
        } catch {
          // Ignore header extraction failures.
        }
        recordNetwork({
          captured_at: new Date().toISOString(),
          ...req,
          status: this.status,
          status_text: this.statusText,
          response_headers: responseHeaders,
          response_body: typeof this.responseText === 'string' ? clip(this.responseText, 32000) : '',
          duration_ms: Date.now() - startedAt,
        });
      });
      return originalSend.apply(this, arguments);
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'A2GENT_GET_PAGE_DIAGNOSTICS') {
      return;
    }
    window.postMessage({
      type: 'A2GENT_PAGE_DIAGNOSTICS',
      requestId: event.data.requestId,
      payload: {
        console_logs: logs.slice(),
        page_errors: errors.slice(),
        network_activity: network.slice(),
      },
    }, '*');
  });
})();
