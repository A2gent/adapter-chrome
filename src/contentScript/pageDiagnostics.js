((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const helpers = root?.__A2GENT_CONTENT_SCRIPT_DIAGNOSTICS__;
  const exported = factory(
    shared || require('./shared.js'),
    helpers || require('./diagnosticsHelpers.js'),
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_PAGE_DIAGNOSTICS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared, helpers) => {
  const getSelectionText = (max) => shared.clip(((window.getSelection && window.getSelection()?.toString()) || ''), max).trim();

  const getPageDiagnosticsFromMainWorld = () => new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ console_logs: [], page_errors: [], network_activity: [], capture_note: 'Timed out waiting for page diagnostics hook.' });
    }, 500);
    function onMessage(event) {
      if (event.source !== window || !event.data || event.data.type !== 'A2GENT_PAGE_DIAGNOSTICS' || event.data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(event.data.payload || { console_logs: [], page_errors: [], network_activity: [] });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'A2GENT_GET_PAGE_DIAGNOSTICS', requestId }, '*');
  });

  const captureScreenshot = async ({ host, isOverlayOpen }) => {
    const previousVisibility = host?.style.visibility || '';
    const shouldHideAdapterPanel = Boolean(host && isOverlayOpen);
    if (shouldHideAdapterPanel) {
      // WHY: screenshots should emphasize the user's page and freeform focus mark, not the adapter controls.
      // WHAT: temporarily hide only the A2gent panel while leaving the drawing canvas visible for captureVisibleTab.
      host.style.visibility = 'hidden';
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'A2GENT_CAPTURE_VISIBLE_TAB' });
      if (!response || !response.ok || !response.dataUrl) {
        throw new Error(response?.error || 'Failed to capture visible tab.');
      }
      return response.dataUrl;
    } finally {
      if (shouldHideAdapterPanel && host) {
        host.style.visibility = previousVisibility;
      }
    }
  };

  const collectDomSnapshot = ({ drawingRootId = shared.DRAWING_ROOT_ID } = {}) => {
    const clone = document.documentElement.cloneNode(true);
    try {
      clone.querySelector('#a2gent-browser-adapter-root')?.remove();
      clone.querySelector(`#${drawingRootId}`)?.remove();
    } catch {
      // Ignore DOM clone cleanup failures.
    }
    return {
      html: shared.clip(clone.outerHTML || '', shared.MAX_DOM_HTML),
      text: shared.clip(document.body?.innerText || document.documentElement?.textContent || '', shared.MAX_DOM_TEXT),
      active_element: document.activeElement ? {
        tag: document.activeElement.tagName,
        id: document.activeElement.id || '',
        class_name: document.activeElement.className || '',
        aria_label: document.activeElement.getAttribute('aria-label') || '',
      } : null,
    };
  };

  const collectLightweightRefresh = () => ({
    schema: 'a2gent.browser.lightweight_context.v1',
    source: shared.SOURCE,
    captured_at: shared.nowIso(),
    page: {
      url: location.href,
      title: document.title,
    },
    selected_text: getSelectionText(shared.MAX_SELECTED_TEXT_LIGHT) || undefined,
  });

  const collectFullDiagnostics = async ({ userPrompt, reason, disableDrawingInput, getDrawingSummary, host, isOverlayOpen }) => {
    disableDrawingInput?.();
    const focusAnnotation = getDrawingSummary?.() || null;
    const [pageDiagnostics, screenshotDataUrl] = await Promise.all([
      getPageDiagnosticsFromMainWorld(),
      captureScreenshot({ host, isOverlayOpen }),
    ]);
    return {
      screenshotDataUrl,
      payload: {
        schema: 'a2gent.browser.diagnostic.v1',
        source: shared.SOURCE,
        extension_version: shared.EXTENSION_VERSION,
        diagnostic_bundle_type: reason,
        captured_at: shared.nowIso(),
        page: {
          url: location.href,
          title: document.title,
          referrer: document.referrer || '',
          visibility_state: document.visibilityState,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            device_pixel_ratio: window.devicePixelRatio,
            scroll_x: window.scrollX,
            scroll_y: window.scrollY,
          },
          user_agent: navigator.userAgent,
        },
        user_prompt: userPrompt,
        focus_annotation: focusAnnotation || undefined,
        selected_text: getSelectionText(shared.MAX_SELECTED_TEXT_FULL),
        dom_snapshot: collectDomSnapshot(),
        console_logs: pageDiagnostics.console_logs || [],
        page_errors: pageDiagnostics.page_errors || [],
        network_activity: helpers.compactNetworkActivity(pageDiagnostics.network_activity, shared.MAX_NETWORK_ENTRIES, shared.nowIso, location.href),
        exclusions: {
          cookies: 'excluded by specification; extension does not read document.cookie or Cookie/Set-Cookie headers',
          browser_storage: 'excluded by specification; extension does not read localStorage, sessionStorage, IndexedDB, Cache Storage, or similar persisted storage',
          network_details: 'network diagnostics are limited to latest 20 endpoint-level records and compact timing entries; request/response headers, bodies, URL query strings, and URL fragments are omitted',
        },
      },
    };
  };

  const jsonBlock = (label, payload) => `\n\n\`\`\`json ${label}\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const imageFromScreenshot = (dataUrl, name) => ({
    name,
    media_type: 'image/png',
    data_base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
  });

  const createInitialMessage = (prompt, diagnosticsPayload) => `${prompt}${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;
  const createFollowupMessage = (prompt, lightweightPayload) => `${prompt}${jsonBlock('a2gent_browser_context', lightweightPayload)}`;
  const createRecaptureMessage = (diagnosticsPayload) => `Manual full browser diagnostic recapture from the Chrome extension.${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;

  return {
    getSelectionText,
    getPageDiagnosticsFromMainWorld,
    captureScreenshot,
    collectDomSnapshot,
    collectLightweightRefresh,
    collectFullDiagnostics,
    jsonBlock,
    imageFromScreenshot,
    createInitialMessage,
    createFollowupMessage,
    createRecaptureMessage,
  };
});
