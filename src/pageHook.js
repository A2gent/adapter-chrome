(() => {
  if (window.__A2GENT_BROWSER_ADAPTER_HOOKED__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_HOOKED__ = true;

  const MAX_LOGS = 400;
  const MAX_NETWORK = 20;
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

  const latestNetwork = () => network
    .slice()
    .sort((a, b) => (Date.parse(a.captured_at || '') || 0) - (Date.parse(b.captured_at || '') || 0))
    .slice(-MAX_NETWORK);

  const recordNetwork = (entry) => {
    // WHY: full request/response headers and bodies made diagnostic prompts too large.
    // WHAT: retain only the latest compact endpoint-level records for the model.
    pushBounded(network, compactNetworkEntry(entry), MAX_NETWORK);
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
        network_activity: latestNetwork(),
      },
    }, '*');
  });
})();
