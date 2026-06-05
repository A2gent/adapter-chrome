(() => {
  if (window.__A2GENT_BROWSER_ADAPTER_CONTENT__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_CONTENT__ = true;

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
  const COMPACT_OVERLAY_HEIGHT = 148;
  const COMPACT_OVERLAY_MIN_HEIGHT = 116;
  const EXPANDED_OVERLAY_MIN_HEIGHT = 240;

  let host = null;
  let shadow = null;
  let shouldFocusPrimaryControl = false;
  let state = {
    open: false,
    baseUrl: DEFAULT_BRUTE_BASE_URL,
    projects: [],
    selectedProjectId: '',
    projectDetection: { mode: 'manual', label: 'Manual selection', detail: '' },
    prompt: '',
    followup: '',
    status: 'Idle',
    error: '',
    busy: false,
    recapturing: false,
    drawingEnabled: false,
    hasDrawing: false,
    drawingStrokeCount: 0,
    sessionId: '',
    messages: [],
    overlayHeight: COMPACT_OVERLAY_HEIGHT,
    settingsOpen: false,
  };

  const clip = (value, max) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  };

  const nowIso = () => new Date().toISOString();

  // WHY: sessions are persisted in Brute, but users inspect them in Caesar's browser UI.
  // WHAT: build the local Caesar chat/session-detail URL opened by the Open Session button.
  const buildSessionDetailUrl = (sessionId) => `${DEFAULT_CAESAR_BASE_URL}/chat/${encodeURIComponent(sessionId)}`;

  const setState = (patch) => {
    state = { ...state, ...patch };
    render();
  };

  const overlayEventPath = (event) => {
    try {
      return typeof event.composedPath === 'function' ? event.composedPath() : [];
    } catch {
      return [];
    }
  };

  const isOverlayEvent = (event) => {
    if (!host || !state.open) return false;
    const path = overlayEventPath(event);
    if (path.includes(host) || (shadow && path.includes(shadow))) return true;
    return event.target === host || (event.target instanceof Node && host.contains(event.target));
  };

  const roleFromOverlayEvent = (event) => {
    for (const node of overlayEventPath(event)) {
      if (node && typeof node.getAttribute === 'function') {
        const role = node.getAttribute('data-role');
        if (role) return role;
      }
    }
    return '';
  };

  // WHY: overlay composers should behave like chat inputs, not plain textareas.
  // WHAT: Enter submits, Shift+Enter keeps the textarea newline, and IME confirmation is left alone.
  const shouldSubmitOverlayComposer = (event, role) => (
    event.type === 'keydown'
    && (role === 'prompt' || role === 'followup')
    && event.key === 'Enter'
    && !event.shiftKey
    && !event.isComposing
    && event.keyCode !== 229
  );

  const isFocusableOverlayControl = (element) => (
    element
    && typeof element.getAttribute === 'function'
    && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName)
  );

  const readOverlayFocusSnapshot = () => {
    if (!shadow || !state.open) return null;
    const active = shadow.activeElement;
    if (!isFocusableOverlayControl(active)) return null;

    const snapshot = {
      role: active.getAttribute('data-role') || '',
      tagName: active.tagName,
    };
    if (typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number') {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
      snapshot.selectionDirection = active.selectionDirection || 'none';
    }
    return snapshot.role ? snapshot : null;
  };

  const focusOverlayControl = (role, selection = null) => {
    if (!state.open || !shadow || !role) return;
    const target = shadow.querySelector(`[data-role="${role}"]`);
    if (!target || typeof target.focus !== 'function') return;
    target.focus({ preventScroll: true });
    if (selection && typeof target.setSelectionRange === 'function') {
      const valueLength = String(target.value || '').length;
      const start = Math.min(selection.selectionStart ?? valueLength, valueLength);
      const end = Math.min(selection.selectionEnd ?? start, valueLength);
      target.setSelectionRange(start, end, selection.selectionDirection || 'none');
    }
  };

  const restoreOverlayFocusSnapshot = (snapshot) => {
    if (!snapshot) return;
    focusOverlayControl(snapshot.role, snapshot);
    window.requestAnimationFrame(() => focusOverlayControl(snapshot.role, snapshot));
  };

  const isOverlayRoleFocused = (role) => (
    state.open
    && document.activeElement === host
    && shadow?.activeElement?.getAttribute?.('data-role') === role
  );

  const focusPrimaryControl = () => {
    if (!state.open || !shadow) return;
    const role = state.sessionId ? 'followup' : 'prompt';
    focusOverlayControl(role, { selectionStart: Number.MAX_SAFE_INTEGER, selectionEnd: Number.MAX_SAFE_INTEGER });
  };

  const handleOverlayKeyboardEvent = (event) => {
    if (!isOverlayEvent(event)) return;

    const role = roleFromOverlayEvent(event);
    if (shouldSubmitOverlayComposer(event, role)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent(OVERLAY_SUBMIT_EVENT, { detail: role }));
      return;
    }

    // WHY: pages such as YouTube install global keyboard shortcuts on window/document.
    // WHAT: stop overlay-originated key events before page listeners see them, while leaving
    // browser default text editing intact by not calling preventDefault for normal typing.
    event.stopImmediatePropagation();
  };

  for (const eventType of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(eventType, handleOverlayKeyboardEvent, { capture: true });
    document.addEventListener(eventType, handleOverlayKeyboardEvent, { capture: true });
  }

  const appendMessage = (role, content) => {
    state = {
      ...state,
      messages: [...state.messages, { role, content, timestamp: nowIso() }],
    };
    render();
  };

  const updateLastAssistant = (delta) => {
    const messages = [...state.messages];
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') {
      messages.push({ role: 'assistant', content: delta, timestamp: nowIso() });
    } else {
      messages[messages.length - 1] = { ...last, content: `${last.content}${delta}` };
    }
    state = { ...state, messages };
    render();
  };

  const setMessagesFromServer = (messages) => {
    if (!Array.isArray(messages)) return;
    state = {
      ...state,
      messages: messages
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({
          role: message.role,
          content: message.content || '',
          timestamp: message.timestamp || nowIso(),
        })),
    };
    render();
  };

  const storageGet = (key) => new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });

  const storageSet = (key, value) => new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });

  const validateLoopbackBaseUrl = (raw) => {
    try {
      const parsed = new URL(String(raw || '').trim());
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

  const apiFetch = async (path, options = {}) => {
    const baseUrl = validateLoopbackBaseUrl(state.baseUrl || DEFAULT_BRUTE_BASE_URL);
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`.trim();
      try {
        const body = await response.json();
        detail = body.error || body.message || detail;
      } catch {
        try {
          detail = await response.text();
        } catch {
          // Keep status fallback.
        }
      }
      throw new Error(detail);
    }
    if (response.status === 204) return null;
    return response.json();
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

  const sendStreamMessage = async (sessionId, message, images = []) => {
    const baseUrl = validateLoopbackBaseUrl(state.baseUrl || DEFAULT_BRUTE_BASE_URL);
    const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, images }),
    });
    if (!response.ok || !response.body) {
      let detail = `${response.status} ${response.statusText}`.trim();
      try {
        const body = await response.json();
        detail = body.error || body.message || detail;
      } catch {
        // Ignore parse errors.
      }
      throw new Error(detail);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        handleStreamEvent(JSON.parse(trimmed));
      }
    }
    const tail = buffer.trim();
    if (tail) {
      handleStreamEvent(JSON.parse(tail));
    }
  };

  const handleStreamEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'assistant_delta' && event.delta) {
      updateLastAssistant(event.delta);
      return;
    }
    if (event.type === 'status' && event.status) {
      setState({ status: `Session ${event.status}` });
      return;
    }
    if (event.type === 'tool_executing') {
      appendMessage('assistant', `\n[Tool executing: ${(event.tool_calls || []).map((tool) => tool.name).join(', ')}]\n`);
      return;
    }
    if (event.type === 'done') {
      setMessagesFromServer(event.messages || []);
      setState({ status: `Session ${event.status || 'updated'}`, busy: false });
      return;
    }
    if (event.type === 'error') {
      setState({ error: event.error || 'Session stream failed.', status: 'Error', busy: false });
    }
  };

  const getSelectionText = (max) => clip((window.getSelection && window.getSelection()?.toString()) || '', max).trim();

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

  const endpointFromUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, location.href);
      // WHY: diagnostic network payloads were overwhelming model context.
      // WHAT: keep endpoint identity while dropping query/fragment/body/header data.
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

  const latestByCapturedAt = (entries, limit) => (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) => (Date.parse(a?.captured_at || '') || 0) - (Date.parse(b?.captured_at || '') || 0))
    .slice(-limit);

  const compactNetworkActivity = (entries) => latestByCapturedAt(entries, MAX_NETWORK_ENTRIES)
    .map((entry) => {
      const out = {
        captured_at: entry.captured_at || nowIso(),
        type: entry.type || 'network',
        method: String(entry.method || 'GET').toUpperCase(),
        url: endpointFromUrl(entry.url),
      };
      const status = Number(entry.status);
      if (Number.isFinite(status)) {
        out.status = status;
      }
      if (entry.status_text) {
        out.status_text = clip(entry.status_text, 160);
      }
      const durationMs = Number(entry.duration_ms);
      if (Number.isFinite(durationMs)) {
        out.duration_ms = Math.round(durationMs);
      }
      if (entry.error_message || entry.error) {
        out.error_message = clip(entry.error_message || entry.error, 500);
      }
      return out;
    });

  const captureScreenshot = async () => {
    const previousVisibility = host?.style.visibility || '';
    const shouldHideAdapterPanel = Boolean(host && state.open);
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

  const getDrawingOverlay = () => window.__A2GENT_DRAWING_OVERLAY__ || null;

  const syncDrawingState = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    state = {
      ...state,
      drawingEnabled: Boolean(drawingOverlay.isEnabled?.()),
      hasDrawing: Boolean(drawingOverlay.hasStrokes?.()),
      drawingStrokeCount: drawingOverlay.getSummary?.()?.stroke_count || 0,
    };
    render();
  };

  const toggleDrawing = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) {
      setState({ error: 'Drawing overlay is unavailable. Reload the page or extension.' });
      return;
    }
    drawingOverlay.toggle();
    syncDrawingState();
  };

  const cancelDrawing = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    drawingOverlay.clear({ exit: true });
    syncDrawingState();
  };

  const disableDrawingInput = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay?.isEnabled?.()) return;
    drawingOverlay.setEnabled(false);
    syncDrawingState();
  };

  const getDrawingSummary = () => getDrawingOverlay()?.getSummary?.() || null;

  const collectDomSnapshot = () => {
    const clone = document.documentElement.cloneNode(true);
    try {
      clone.querySelector('#a2gent-browser-adapter-root')?.remove();
      clone.querySelector(`#${DRAWING_ROOT_ID}`)?.remove();
    } catch {
      // Ignore DOM clone cleanup failures.
    }
    return {
      html: clip(clone.outerHTML || '', MAX_DOM_HTML),
      text: clip(document.body?.innerText || document.documentElement?.textContent || '', MAX_DOM_TEXT),
      active_element: document.activeElement ? {
        tag: document.activeElement.tagName,
        id: document.activeElement.id || '',
        class_name: document.activeElement.className || '',
        aria_label: document.activeElement.getAttribute('aria-label') || '',
      } : null,
    };
  };

  const collectFullDiagnostics = async (userPrompt, reason) => {
    disableDrawingInput();
    const focusAnnotation = getDrawingSummary();
    const [pageDiagnostics, screenshotDataUrl] = await Promise.all([
      getPageDiagnosticsFromMainWorld(),
      captureScreenshot(),
    ]);
    return {
      screenshotDataUrl,
      payload: {
        schema: 'a2gent.browser.diagnostic.v1',
        source: SOURCE,
        extension_version: EXTENSION_VERSION,
        diagnostic_bundle_type: reason,
        captured_at: nowIso(),
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
        selected_text: getSelectionText(MAX_SELECTED_TEXT_FULL),
        dom_snapshot: collectDomSnapshot(),
        console_logs: pageDiagnostics.console_logs || [],
        page_errors: pageDiagnostics.page_errors || [],
        network_activity: compactNetworkActivity(pageDiagnostics.network_activity),
        exclusions: {
          cookies: 'excluded by specification; extension does not read document.cookie or Cookie/Set-Cookie headers',
          browser_storage: 'excluded by specification; extension does not read localStorage, sessionStorage, IndexedDB, Cache Storage, or similar persisted storage',
          network_details: 'network diagnostics are limited to latest 20 endpoint-level records and compact timing entries; request/response headers, bodies, URL query strings, and URL fragments are omitted',
        },
      },
    };
  };

  const collectLightweightRefresh = () => ({
    schema: 'a2gent.browser.lightweight_context.v1',
    source: SOURCE,
    captured_at: nowIso(),
    page: {
      url: location.href,
      title: document.title,
    },
    selected_text: getSelectionText(MAX_SELECTED_TEXT_LIGHT) || undefined,
  });

  const jsonBlock = (label, payload) => `\n\n\`\`\`json ${label}\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  const imageFromScreenshot = (dataUrl, name) => ({
    name,
    media_type: 'image/png',
    data_base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
  });

  const createInitialMessage = (prompt, diagnosticsPayload) => `${prompt}${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;

  const createFollowupMessage = (prompt, lightweightPayload) => `${prompt}${jsonBlock('a2gent_browser_context', lightweightPayload)}`;

  const createRecaptureMessage = (diagnosticsPayload) => `Manual full browser diagnostic recapture from the Chrome extension.${jsonBlock('a2gent_browser_diagnostic', diagnosticsPayload)}`;

  const wildcardCount = (pattern) => (pattern.match(/\*/g) || []).length;
  const literalCharCount = (pattern) => pattern.replace(/\*/g, '').length;
  const literalPathLength = (pattern) => {
    try {
      return new URL(pattern.replace(/\*/g, 'wildcard')).pathname.replace(/wildcard/g, '').length;
    } catch {
      return 0;
    }
  };

  const patternMatchesUrl = (pattern, currentUrl) => {
    try {
      if (typeof URLPattern !== 'undefined') {
        return new URLPattern(pattern).test(currentUrl);
      }
    } catch {
      // Fallback below for our restricted '*' subset.
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(currentUrl);
  };

  const compareScores = (left, right) => {
    if (left.wildcards !== right.wildcards) return left.wildcards - right.wildcards;
    if (left.literalChars !== right.literalChars) return right.literalChars - left.literalChars;
    if (left.literalPath !== right.literalPath) return right.literalPath - left.literalPath;
    return 0;
  };

  const detectProject = (projects, currentUrl) => {
    const matches = [];
    for (const project of projects) {
      for (const pattern of project.url_patterns || []) {
        if (!pattern || !patternMatchesUrl(pattern, currentUrl)) continue;
        matches.push({
          project,
          pattern,
          wildcards: wildcardCount(pattern),
          literalChars: literalCharCount(pattern),
          literalPath: literalPathLength(pattern),
        });
      }
    }
    if (matches.length === 0) {
      return { projectId: '', mode: 'manual', label: 'Manual selection', detail: 'No URL pattern matched this page.' };
    }
    matches.sort(compareScores);
    const best = matches[0];
    const tied = matches.filter((candidate) => compareScores(candidate, best) === 0);
    const tiedProjectIds = new Set(tied.map((candidate) => candidate.project.id));
    if (tiedProjectIds.size > 1) {
      return {
        projectId: '',
        mode: 'manual',
        label: 'Manual selection required',
        detail: `Multiple projects matched equally: ${tied.map((item) => `${item.project.name} (${item.pattern})`).join(', ')}`,
      };
    }
    return {
      projectId: best.project.id,
      mode: 'auto',
      label: `Auto-detected: ${best.project.name}`,
      detail: `Matched ${best.pattern}`,
    };
  };

  const loadSettingsAndProjects = async () => {
    const storedBaseUrl = await storageGet(STORAGE_BASE_URL_KEY);
    const baseUrl = storedBaseUrl || DEFAULT_BRUTE_BASE_URL;
    state.baseUrl = baseUrl;
    render();
    try {
      setState({ status: 'Loading projects...', error: '' });
      const projects = await listProjects();
      const detection = detectProject(projects || [], location.href);
      setState({
        projects: projects || [],
        selectedProjectId: detection.projectId,
        projectDetection: { mode: detection.mode, label: detection.label, detail: detection.detail },
        status: 'Ready',
      });
    } catch (error) {
      setState({
        projects: [],
        selectedProjectId: '',
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Projects could not be loaded.' },
        status: 'Brute unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const saveBaseUrl = async () => {
    const input = shadow.querySelector('[data-role="base-url"]');
    if (!input) return;
    try {
      const baseUrl = validateLoopbackBaseUrl(input.value);
      await storageSet(STORAGE_BASE_URL_KEY, baseUrl);
      setState({ baseUrl, error: '', status: 'Base URL saved.', settingsOpen: false });
      await loadSettingsAndProjects();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const startSession = async () => {
    if (state.busy) return;
    const prompt = state.prompt.trim();
    if (!prompt) {
      setState({ error: 'Describe what the agent should investigate.' });
      return;
    }
    if (!state.selectedProjectId) {
      setState({ error: 'Open Settings and select a project before creating a session.' });
      return;
    }

    setState({ busy: true, status: 'Capturing full diagnostics...', error: '' });
    try {
      const diagnostics = await collectFullDiagnostics(prompt, 'initial_full');
      const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) || null;
      const metadata = {
        source: SOURCE,
        created_by: 'adapter-chrome-extension',
        extension_version: EXTENSION_VERSION,
        browser_url: location.href,
        page_title: document.title,
        project_detection: state.projectDetection,
        project_name: selectedProject?.name || '',
        has_focus_annotation: Boolean(diagnostics.payload.focus_annotation),
        focus_annotation_stroke_count: diagnostics.payload.focus_annotation?.stroke_count || 0,
      };
      setState({ status: 'Creating Brute session...' });
      const created = await createSession(state.selectedProjectId, metadata);
      setState({ sessionId: created.id, status: 'Sending diagnostics to agent...' });
      appendMessage('user', prompt);
      await sendStreamMessage(
        created.id,
        createInitialMessage(prompt, diagnostics.payload),
        [imageFromScreenshot(diagnostics.screenshotDataUrl, 'initial-page-screenshot.png')],
      );
      setState({ busy: false, status: 'Session ready', followup: '' });
    } catch (error) {
      setState({ busy: false, status: 'Error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const sendFollowup = async () => {
    const prompt = state.followup.trim();
    if (!state.sessionId || !prompt || state.busy) return;
    const lightweight = collectLightweightRefresh();
    appendMessage('user', prompt);
    setState({ busy: true, followup: '', status: 'Sending message with lightweight page context...', error: '' });
    try {
      await sendStreamMessage(state.sessionId, createFollowupMessage(prompt, lightweight), []);
      const shouldReturnToFollowup = isOverlayRoleFocused('followup');
      setState({ busy: false, status: 'Session updated' });
      if (shouldReturnToFollowup) {
        window.requestAnimationFrame(() => focusOverlayControl('followup'));
      }
    } catch (error) {
      setState({ busy: false, status: 'Error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const submitOverlayComposer = (role) => {
    if (role === 'prompt') {
      void startSession();
      return;
    }
    if (role === 'followup') {
      void sendFollowup();
    }
  };

  window.addEventListener(OVERLAY_SUBMIT_EVENT, (event) => submitOverlayComposer(event.detail));
  window.addEventListener(DRAWING_CHANGE_EVENT, (event) => {
    const detail = event.detail || {};
    setState({
      drawingEnabled: Boolean(detail.enabled),
      hasDrawing: Boolean(detail.hasStrokes),
      drawingStrokeCount: Number(detail.strokeCount) || 0,
    });
  });

  const openSessionDetail = () => {
    const sessionId = String(state.sessionId || '').trim();
    if (!sessionId) return;

    // WHY: opening a browser tab is more reliable from the extension service worker than from an injected content script.
    // WHAT: ask the background script to open Caesar, falling back to window.open if the extension context was reloaded.
    try {
      chrome.runtime.sendMessage({ type: 'A2GENT_OPEN_SESSION_DETAIL', sessionId }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          window.open(buildSessionDetailUrl(sessionId), '_blank', 'noopener');
        }
      });
    } catch {
      window.open(buildSessionDetailUrl(sessionId), '_blank', 'noopener');
    }
  };

  const sendFullRecapture = async () => {
    if (!state.sessionId || state.busy || state.recapturing) return;
    setState({ recapturing: true, busy: true, status: 'Capturing full diagnostics...', error: '' });
    try {
      const diagnostics = await collectFullDiagnostics('Manual full diagnostic recapture', 'manual_full_recapture');
      appendMessage('user', 'Manual full diagnostic recapture');
      setState({ status: 'Sending full recapture...' });
      await sendStreamMessage(
        state.sessionId,
        createRecaptureMessage(diagnostics.payload),
        [imageFromScreenshot(diagnostics.screenshotDataUrl, 'manual-full-recapture.png')],
      );
      setState({ recapturing: false, busy: false, status: 'Full recapture sent' });
    } catch (error) {
      setState({ recapturing: false, busy: false, status: 'Error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const attachEvents = () => {
    shadow.querySelector('[data-role="close"]')?.addEventListener('click', () => {
      disableDrawingInput();
      setState({ open: false, settingsOpen: false });
    });
    shadow.querySelector('[data-role="settings-toggle"]')?.addEventListener('click', () => setState({ settingsOpen: !state.settingsOpen }));
    shadow.querySelector('[data-role="refresh-projects"]')?.addEventListener('click', () => void loadSettingsAndProjects());
    shadow.querySelector('[data-role="save-base-url"]')?.addEventListener('click', () => void saveBaseUrl());
    shadow.querySelector('[data-role="project"]')?.addEventListener('change', (event) => {
      setState({
        selectedProjectId: event.target.value,
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Project chosen manually.' },
      });
    });
    shadow.querySelector('[data-role="prompt"]')?.addEventListener('input', (event) => {
      state.prompt = event.target.value;
    });
    shadow.querySelector('[data-role="followup"]')?.addEventListener('input', (event) => {
      state.followup = event.target.value;
    });
    shadow.querySelector('[data-role="create"]')?.addEventListener('click', () => void startSession());
    shadow.querySelectorAll('[data-role="drawing-toggle"]').forEach((button) => button.addEventListener('click', () => toggleDrawing()));
    shadow.querySelectorAll('[data-role="drawing-cancel"]').forEach((button) => button.addEventListener('click', () => cancelDrawing()));
    shadow.querySelector('[data-role="send"]')?.addEventListener('click', () => void sendFollowup());
    shadow.querySelector('[data-role="recapture"]')?.addEventListener('click', () => void sendFullRecapture());
    shadow.querySelector('[data-role="open-session"]')?.addEventListener('click', () => openSessionDetail());
    shadow.querySelectorAll('[data-role="prompt"], [data-role="followup"]').forEach((textarea) => {
      textarea.addEventListener('keydown', (event) => {
        const role = event.currentTarget?.getAttribute?.('data-role') || '';
        if (!shouldSubmitOverlayComposer(event, role)) return;
        event.preventDefault();
        submitOverlayComposer(role);
      });
    });

    const resize = shadow.querySelector('[data-role="resize"]');
    resize?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const minHeight = state.sessionId || state.settingsOpen ? EXPANDED_OVERLAY_MIN_HEIGHT : COMPACT_OVERLAY_MIN_HEIGHT;
      const startHeight = Math.max(state.overlayHeight, minHeight);
      const onMove = (moveEvent) => {
        const maxHeight = Math.min(640, Math.floor(window.innerHeight * (window.innerWidth < 720 ? 0.6 : 0.9)));
        const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + (startY - moveEvent.clientY)));
        state.overlayHeight = nextHeight;
        host.style.setProperty('--a2gent-overlay-height', `${nextHeight}px`);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  };

  const render = () => {
    if (!host || !shadow) return;
    host.style.display = state.open ? 'block' : 'none';
    host.style.setProperty('--a2gent-overlay-height', `${state.overlayHeight}px`);
    if (!state.open) return;

    const ui = window.__A2GENT_CONTENT_UI__;
    if (!ui?.renderOverlay) {
      shadow.innerHTML = '<div>A2gent Browser Adapter UI failed to load. Reload the extension.</div>';
      return;
    }

    // WHY: full shadow DOM replacement destroys the focused textarea/input.
    // WHAT: remember the overlay control and selection so YouTube/player focus is not restored while the user types.
    const focusSnapshot = readOverlayFocusSnapshot();
    shadow.innerHTML = ui.renderOverlay({
      state,
      compactOverlayHeight: COMPACT_OVERLAY_HEIGHT,
      compactOverlayMinHeight: COMPACT_OVERLAY_MIN_HEIGHT,
      expandedOverlayMinHeight: EXPANDED_OVERLAY_MIN_HEIGHT,
    });
    attachEvents();
    restoreOverlayFocusSnapshot(focusSnapshot);
    if (shouldFocusPrimaryControl) {
      shouldFocusPrimaryControl = false;
      window.requestAnimationFrame(focusPrimaryControl);
    }
  };

  const ensureOverlay = () => {
    if (host && shadow) return;
    host = document.createElement('div');
    host.id = 'a2gent-browser-adapter-root';
    host.style.display = 'none';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
  };

  const toggleOverlay = async () => {
    ensureOverlay();
    const nextOpen = !state.open;
    if (nextOpen) {
      shouldFocusPrimaryControl = true;
    }
    setState({ open: nextOpen, settingsOpen: false });
    if (nextOpen && state.projects.length === 0 && !state.busy) {
      await loadSettingsAndProjects();
    }
    if (nextOpen) {
      window.requestAnimationFrame(focusPrimaryControl);
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'A2GENT_TOGGLE_OVERLAY') {
      void toggleOverlay();
    }
  });
})();
