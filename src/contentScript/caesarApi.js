((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const sessionLaunch = root?.__A2GENT_CONTENT_SCRIPT_SESSION_LAUNCH__;
  const sessionEvents = root?.__A2GENT_CONTENT_SCRIPT_SESSION_EVENTS__;
  const exported = factory(
    shared || require('./shared.js'),
    sessionLaunch || require('./sessionLaunch.js'),
    sessionEvents || require('./sessionEvents.js'),
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_CAESAR_API__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared, sessionLaunch, sessionEvents) => {
  const apiErrorDetail = (response) => {
    const body = response?.body;
    return body?.error || body?.message || response?.bodyText || `${response?.status || ''} ${response?.statusText || ''}`.trim() || 'Brute request failed.';
  };

  const createApiClient = ({ getBaseUrl }) => {
    const apiFetch = async (path, options = {}) => {
      const baseUrl = shared.validateLoopbackBaseUrl(await getBaseUrl());
      // WHY: HTTPS host pages cannot directly fetch http://localhost due to Chrome's
      // Private Network Access checks against the page origin.
      // WHAT: ask the extension service worker to perform the loopback request under
      // extension host_permissions, then normalize the response back to fetch-like data.
      const proxied = await shared.sendRuntimeMessage({
        type: 'A2GENT_BRUTE_API_FETCH',
        baseUrl,
        path,
        options: shared.serializeApiOptions(options),
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

    const createSession = async (projectId, metadata, options = {}) => {
      const agent = options.agent || sessionLaunch.createBuiltInHostAgent();
      return apiFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify(sessionLaunch.buildSessionRequest({
          agent,
          provider: options.provider,
          model: options.model,
          projectId,
          metadata,
          task: options.task,
          images: options.images,
        })),
      });
    };

    const listProjects = async () => apiFetch('/projects');
    const listProviders = async () => apiFetch('/providers');
    const listProviderModels = async (provider) => {
      const providerType = typeof provider === 'string' ? provider : provider?.type;
      const path = sessionLaunch.modelsPathForProvider(providerType);
      if (!path) return sessionLaunch.normalizeModelsResponse({}, provider);
      try {
        const body = await apiFetch(path);
        return sessionLaunch.normalizeModelsResponse(body, provider);
      } catch {
        return sessionLaunch.normalizeModelsResponse({}, provider);
      }
    };
    const listUnifiedAgents = async (projectId = '') => {
      const query = String(projectId || '').trim() === '' ? '' : `?project_id=${encodeURIComponent(String(projectId).trim())}`;
      const body = await apiFetch(`/unified-agents/${query}`);
      if (Array.isArray(body?.agents)) return body.agents;
      return Array.isArray(body) ? body : [];
    };

    // WHY: both follow-up chat/stream and live /events need the same service-worker
    // loopback proxy, but they speak NDJSON vs SSE.
    // WHAT: one Port opener that feeds the matching parser and can stay open for SSE.
    const openBruteStream = ({ path, options, format = 'ndjson', onEvent }) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const emit = typeof onEvent === 'function' ? onEvent : () => {};
      let buffer = '';
      let settled = false;
      let resolvePromise = () => {};
      let rejectPromise = () => {};
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const port = chrome.runtime.connect({ name: 'A2GENT_BRUTE_STREAM' });

      const cleanup = () => {
        try {
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
        } catch {
          // Ignore listener cleanup after an extension reload/disconnect.
        }
      };
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          port.disconnect();
        } catch {
          // The port may already be disconnected by the service worker.
        }
        callback(value);
      };
      const fail = (error) => settle(rejectPromise, error instanceof Error ? error : new Error(String(error)));
      const succeed = () => settle(resolvePromise);

      const consumeNdjson = (chunk, { flush = false } = {}) => {
        buffer += String(chunk || '');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') continue;
          emit(JSON.parse(trimmed));
        }
        if (flush) {
          const tail = buffer.trim();
          buffer = '';
          if (tail) emit(JSON.parse(tail));
        }
      };

      const consumeSse = (chunk, { flush = false } = {}) => {
        const parsed = sessionEvents.parseSseJsonEvents(chunk, buffer);
        buffer = parsed.buffer;
        for (const event of parsed.events) emit(event);
        if (flush) {
          for (const event of sessionEvents.flushSseBuffer(buffer)) emit(event);
          buffer = '';
        }
      };

      const consumeChunk = (chunk, extra) => {
        if (format === 'sse') consumeSse(chunk, extra);
        else consumeNdjson(chunk, extra);
      };

      function onMessage(portMessage) {
        if (!portMessage || portMessage.requestId !== requestId) return;
        try {
          if (portMessage.type === 'A2GENT_BRUTE_STREAM_CHUNK') {
            consumeChunk(portMessage.chunk);
            return;
          }
          if (portMessage.type === 'A2GENT_BRUTE_STREAM_ERROR') {
            fail(new Error(portMessage.error || 'Brute stream failed.'));
            return;
          }
          if (portMessage.type === 'A2GENT_BRUTE_STREAM_DONE') {
            consumeChunk('', { flush: true });
            succeed();
          }
        } catch (error) {
          fail(error);
        }
      }

      function onDisconnect() {
        if (!settled) {
          fail(new Error('Brute stream disconnected. Reload the extension and try again.'));
        }
      }

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      void Promise.resolve(getBaseUrl()).then((rawBaseUrl) => {
        if (settled) return;
        const baseUrl = shared.validateLoopbackBaseUrl(rawBaseUrl);
        // WHY: streaming responses must also avoid direct localhost fetches from
        // HTTPS page contexts, otherwise Chrome blocks them before Brute can respond.
        // WHAT: open a runtime Port so the service worker can fetch and forward chunks.
        port.postMessage({
          type: 'A2GENT_BRUTE_STREAM_START',
          requestId,
          baseUrl,
          path,
          options: shared.serializeApiOptions(options),
        });
      }).catch(fail);

      return {
        promise,
        stop: () => settle(resolvePromise),
      };
    };

    const sendStreamMessage = async (sessionId, message, images = [], handlers = {}) => {
      const stream = openBruteStream({
        path: `/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
        format: 'ndjson',
        onEvent: handlers.onEvent,
        options: {
          method: 'POST',
          headers: {
            Accept: 'application/x-ndjson',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, images }),
        },
      });
      await stream.promise;
    };

    const subscribeSessionEvents = (sessionId, handlers = {}) => {
      const stream = openBruteStream({
        path: `/sessions/${encodeURIComponent(sessionId)}/events`,
        format: 'sse',
        onEvent: handlers.onEvent,
        options: {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
          },
        },
      });
      stream.promise.catch((error) => {
        if (typeof handlers.onError === 'function') handlers.onError(error);
      });
      return {
        stop: stream.stop,
        promise: stream.promise,
      };
    };

    return {
      apiFetch,
      createSession,
      listProviders,
      listProviderModels,
      listProjects,
      listUnifiedAgents,
      sendStreamMessage,
      subscribeSessionEvents,
    };
  };

  return {
    apiErrorDetail,
    createApiClient,
  };
});
