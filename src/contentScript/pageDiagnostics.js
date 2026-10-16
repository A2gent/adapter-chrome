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

  const SCREENSHOT_MAX_LONG_EDGE = 1280;
  const SCREENSHOT_JPEG_QUALITY = 0.8;

  const screenshotDimensions = (width, height, devicePixelRatio = 1) => {
    const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const scale = Math.min(1 / ratio, SCREENSHOT_MAX_LONG_EDGE / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  };

  const compressScreenshot = async (dataUrl, devicePixelRatio) => {
    // Decode locally: host-page CSP can block fetch(data:...) in content scripts.
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    try {
      // Remove retina density before bounding upload size; annotations remain in page CSS coordinates.
      const { width, height } = screenshotDimensions(bitmap.width, bitmap.height, devicePixelRatio);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: false });
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: SCREENSHOT_JPEG_QUALITY });
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(encoded);
      });
    } finally {
      bitmap.close();
    }
  };

  const captureScreenshot = async ({ host, isOverlayOpen }) => {
    const previousVisibility = host?.style.visibility || '';
    const shouldHideAdapterPanel = Boolean(host && isOverlayOpen);
    if (shouldHideAdapterPanel) {
      // WHY: screenshots should emphasize the user's page and numbered annotations, not the adapter controls.
      // WHAT: temporarily hide only the A2gent panel while leaving annotation markers visible for captureVisibleTab.
      host.style.visibility = 'hidden';
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'A2GENT_CAPTURE_VISIBLE_TAB' });
      if (!response || !response.ok || !response.dataUrl) {
        throw new Error(response?.error || 'Failed to capture visible tab.');
      }
      return await compressScreenshot(response.dataUrl, window.devicePixelRatio);
    } finally {
      if (shouldHideAdapterPanel && host) {
        host.style.visibility = previousVisibility;
      }
    }
  };

  const collectDomSnapshot = ({ drawingRootId = shared.DRAWING_ROOT_ID, userPrompt = '' } = {}) => {
    const clone = document.documentElement.cloneNode(true);
    try {
      clone.querySelector('#a2gent-browser-adapter-root')?.remove();
      clone.querySelector(`#${drawingRootId}`)?.remove();
    } catch {
      // Ignore DOM clone cleanup failures.
    }
    return {
      html: helpers.redactPromptOccurrences(shared.clip(clone.outerHTML || '', shared.MAX_DOM_HTML), userPrompt),
      text: helpers.redactPromptOccurrences(shared.clip(document.body?.innerText || document.documentElement?.textContent || '', shared.MAX_DOM_TEXT), userPrompt),
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
        focus_annotation: focusAnnotation || undefined,
        selected_text: helpers.redactPromptEcho(getSelectionText(shared.MAX_SELECTED_TEXT_FULL), userPrompt),
        console_logs: helpers.compactConsoleActivity(pageDiagnostics.console_logs, 20, userPrompt),
        page_errors: pageDiagnostics.page_errors || [],
        exclusions: {
          cookies: 'excluded by specification; extension does not read document.cookie or Cookie/Set-Cookie headers',
          browser_storage: 'excluded by specification; extension does not read localStorage, sessionStorage, IndexedDB, Cache Storage, or similar persisted storage',
          dom_snapshot: 'omitted from automatic diagnostic posts because it can be too large; agents can request page content on demand with browser-control commands',
          network_activity: 'omitted from automatic diagnostic posts because it can be too large; agents can request network logs on demand with get_network_logs',
        },
      },
    };
  };

  const jsonBlock = (label, payload) => `\n\n\`\`\`json ${label}\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const imageFromScreenshot = (dataUrl, name) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('Invalid screenshot image data URL.');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[match[1]];
    return {
      name: name.replace(/\.(?:png|jpe?g|webp)$/i, `.${extension}`),
      media_type: match[1],
      data_base64: match[2],
    };
  };

  const createInitialMessage = (prompt, diagnosticsPayload) => `${prompt}${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;
  const createFollowupMessage = (prompt, lightweightPayload) => `${prompt}${jsonBlock('a2gent_browser_context', lightweightPayload)}`;
  const createRecaptureMessage = (diagnosticsPayload) => `Manual full browser diagnostic recapture from the Chrome extension.${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;

  return {
    getSelectionText,
    getPageDiagnosticsFromMainWorld,
    SCREENSHOT_MAX_LONG_EDGE,
    screenshotDimensions,
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
