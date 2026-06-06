((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const exported = factory(shared || require('./shared.js'));
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_CAESAR_API__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared) => {
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

    const createSession = async (projectId, metadata) => apiFetch('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'build',
        project_id: projectId || undefined,
        metadata,
      }),
    });

    const listProjects = async () => apiFetch('/projects');

    const sendStreamMessage = async (sessionId, message, images = [], handlers = {}) => {
      const baseUrl = shared.validateLoopbackBaseUrl(await getBaseUrl());
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const streamPath = `/sessions/${encodeURIComponent(sessionId)}/chat/stream`;
      const onEvent = typeof handlers.onEvent === 'function' ? handlers.onEvent : () => {};

      await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'A2GENT_BRUTE_STREAM' });
        let settled = false;
        let buffer = '';

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
        const fail = (error) => settle(reject, error instanceof Error ? error : new Error(String(error)));

        const consumeChunk = (chunk) => {
          buffer += String(chunk || '');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '') continue;
            onEvent(JSON.parse(trimmed));
          }
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
              const tail = buffer.trim();
              if (tail) {
                onEvent(JSON.parse(tail));
              }
              settle(resolve);
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
        // WHY: streaming chat responses must also avoid direct localhost fetches from
        // HTTPS page contexts, otherwise Chrome blocks them before Brute can respond.
        // WHAT: open a runtime Port so the service worker can fetch and forward NDJSON
        // chunks while this content script keeps the existing inline UI update logic.
        port.postMessage({
          type: 'A2GENT_BRUTE_STREAM_START',
          requestId,
          baseUrl,
          path: streamPath,
          options: shared.serializeApiOptions({
            method: 'POST',
            headers: {
              Accept: 'application/x-ndjson',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message, images }),
          }),
        });
      });
    };

    return {
      apiFetch,
      createSession,
      listProjects,
      sendStreamMessage,
    };
  };

  return {
    apiErrorDetail,
    createApiClient,
  };
});
