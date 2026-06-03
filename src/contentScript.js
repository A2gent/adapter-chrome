(() => {
  if (window.__A2GENT_BROWSER_ADAPTER_CONTENT__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_CONTENT__ = true;

  const DEFAULT_BRUTE_BASE_URL = 'http://localhost:5445';
  const DEFAULT_CAESAR_BASE_URL = 'http://localhost:5173';
  const DEFAULT_PROJECT_ID = 'system-kb';
  const DEFAULT_PROJECT_NAME = 'Knowledge Base';
  const STORAGE_BASE_URL_KEY = 'a2gent.adapterChrome.baseUrl';
  const SOURCE = 'adapter-chrome';
  const EXTENSION_VERSION = '0.1.0';
  const MAX_SELECTED_TEXT_LIGHT = 4000;
  const MAX_SELECTED_TEXT_FULL = 12000;
  const MAX_DOM_HTML = 180000;
  const MAX_DOM_TEXT = 60000;
  const MAX_PERF_ENTRIES = 20;
  const MAX_NETWORK_ENTRIES = 20;

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
    sessionId: '',
    messages: [],
    overlayHeight: 320,
    settingsOpen: false,
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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

  const focusPrimaryControl = () => {
    if (!state.open || !shadow) return;
    const role = state.sessionId ? 'followup' : 'prompt';
    const target = shadow.querySelector(`[data-role="${role}"]`);
    if (!target || typeof target.focus !== 'function') return;
    target.focus({ preventScroll: true });
    if (typeof target.setSelectionRange === 'function') {
      const end = String(target.value || '').length;
      target.setSelectionRange(end, end);
    }
  };

  const handleOverlayKeyboardEvent = (event) => {
    if (!isOverlayEvent(event)) return;

    const role = roleFromOverlayEvent(event);
    if (event.type === 'keydown' && role === 'followup' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void sendFollowup();
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
    const response = await chrome.runtime.sendMessage({ type: 'A2GENT_CAPTURE_VISIBLE_TAB' });
    if (!response || !response.ok || !response.dataUrl) {
      throw new Error(response?.error || 'Failed to capture visible tab.');
    }
    return response.dataUrl;
  };
  const performanceEntryName = (entry) => {
    if (entry.entryType === 'resource' || entry.entryType === 'navigation') {
      return endpointFromUrl(entry.name);
    }
    return String(entry.name || '');
  };

  const collectPerformanceEntries = () => {
    try {
      return performance.getEntries()
        .filter((entry) => entry.entryType === 'navigation' || entry.entryType === 'resource' || entry.entryType === 'paint')
        .sort((a, b) => a.startTime - b.startTime)
        .slice(-MAX_PERF_ENTRIES)
        .map((entry) => {
          const out = {
            name: performanceEntryName(entry),
            entry_type: entry.entryType,
            start_time: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
          };
          if (entry.initiatorType) {
            out.initiator_type = entry.initiatorType;
          }
          return out;
        });
    } catch {
      return [];
    }
  };

  const collectDomSnapshot = () => {
    const clone = document.documentElement.cloneNode(true);
    try {
      clone.querySelector('#a2gent-browser-adapter-root')?.remove();
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
        selected_text: getSelectionText(MAX_SELECTED_TEXT_FULL),
        dom_snapshot: collectDomSnapshot(),
        browser_observed_state: {
          performance_entries: collectPerformanceEntries(),
        },
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

  const findDefaultProject = (projects) => {
    const items = Array.isArray(projects) ? projects : [];
    return items.find((project) => project.id === DEFAULT_PROJECT_ID)
      || items.find((project) => String(project.name || '').trim().toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase())
      || null;
  };

  const withDefaultProjectFallback = (projects, detection) => {
    if (detection.projectId) return detection;
    const project = findDefaultProject(projects);
    if (!project) return detection;
    // WHY: new browser-diagnosis sessions should be usable immediately even when
    // URL auto-detection has no project match. Brute seeds this system project.
    // WHAT: fall back to Knowledge Base while preserving URL auto-detection wins.
    return {
      projectId: project.id,
      mode: 'default',
      label: `Default project: ${project.name}`,
      detail: detection.detail
        ? `${detection.detail} Using Brute built-in Knowledge Base as the default project.`
        : 'Using Brute built-in Knowledge Base as the default project.',
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
      const detection = withDefaultProjectFallback(projects || [], detectProject(projects || [], location.href));
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
      setState({ busy: false, status: 'Session updated' });
    } catch (error) {
      setState({ busy: false, status: 'Error', error: error instanceof Error ? error.message : String(error) });
    }
  };

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
    shadow.querySelector('[data-role="close"]')?.addEventListener('click', () => setState({ open: false, settingsOpen: false }));
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
    shadow.querySelector('[data-role="send"]')?.addEventListener('click', () => void sendFollowup());
    shadow.querySelector('[data-role="recapture"]')?.addEventListener('click', () => void sendFullRecapture());
    shadow.querySelector('[data-role="open-session"]')?.addEventListener('click', () => openSessionDetail());
    shadow.querySelector('[data-role="followup"]')?.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void sendFollowup();
      }
    });

    const resize = shadow.querySelector('[data-role="resize"]');
    resize?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = state.overlayHeight;
      const onMove = (moveEvent) => {
        const maxHeight = Math.min(640, Math.floor(window.innerHeight * (window.innerWidth < 720 ? 0.6 : 0.9)));
        const nextHeight = Math.min(maxHeight, Math.max(240, startHeight + (startY - moveEvent.clientY)));
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

    const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) || null;
    const projectOptions = state.projects.map((project) => (
      `<option value="${escapeHtml(project.id)}" ${project.id === state.selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`
    )).join('');
    const messages = state.messages.length === 0
      ? '<div class="empty">No inline messages yet. Create a session to start.</div>'
      : state.messages.map((message) => `
        <div class="message ${message.role}">
          <div class="message-role">${escapeHtml(message.role)}</div>
          <pre>${escapeHtml(message.content)}</pre>
        </div>
      `).join('');
    // Keep connection and project setup out of the primary diagnosis flow; users must explicitly open settings to change them.
    const settingsPanel = state.settingsOpen ? `
      <section class="settings-panel" aria-label="Adapter settings">
        <section class="warning">
          Diagnosis sends a broad page diagnostic bundle to your local Brute instance: URL, title, selected text, screenshot, DOM/text snapshot, console/errors and the latest 20 endpoint-level network records. Cookies, browser storage, network headers and request/response bodies are excluded.
        </section>
        <div class="settings-row">
          <label>
            <span>Local Brute URL</span>
            <input data-role="base-url" value="${escapeHtml(state.baseUrl)}" placeholder="http://localhost:5445" />
          </label>
          <button type="button" data-role="save-base-url" class="secondary">Save URL</button>
        </div>
        <div class="project-row">
          <label>
            <span>Project context</span>
            <select data-role="project">
              <option value="">Select project...</option>
              ${projectOptions}
            </select>
          </label>
          <button type="button" data-role="refresh-projects" class="secondary">Refresh projects</button>
          <div class="detection ${state.projectDetection.mode}">
            <strong>${escapeHtml(state.projectDetection.label)}</strong>
            <span>${escapeHtml(state.projectDetection.detail || (selectedProject ? selectedProject.name : ''))}</span>
          </div>
        </div>
      </section>
    ` : '';

    shadow.innerHTML = `
      <style>${styles()}</style>
      <div class="panel" role="dialog" aria-label="A2gent browser diagnostics">
        <div class="resize" data-role="resize" title="Drag to resize"></div>
        <header>
          <div>
            <strong>A2gent Browser Adapter</strong>
            <span class="status ${state.error ? 'error' : ''}">${escapeHtml(state.error || state.status)}</span>
          </div>
          <div class="header-actions">
            <button type="button" data-role="settings-toggle" class="ghost" aria-expanded="${state.settingsOpen ? 'true' : 'false'}">
              ${state.settingsOpen ? 'Hide settings' : 'Settings'}
            </button>
            <button type="button" data-role="close" class="ghost">Close</button>
          </div>
        </header>
        ${settingsPanel}
        ${state.sessionId ? renderContinuation(messages) : renderCreation()}
      </div>
    `;
    attachEvents();
    if (shouldFocusPrimaryControl) {
      window.requestAnimationFrame(focusPrimaryControl);
    }
  };

  const renderCreation = () => `
    <section class="create-grid">
      <label>
        <span>What should the agent investigate?</span>
        <textarea data-role="prompt" placeholder="Describe the UI issue, selected text question, or debugging task...">${escapeHtml(state.prompt)}</textarea>
      </label>
      <div class="actions">
        <button type="button" data-role="create" class="primary" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Working...' : 'Create session & send diagnostics'}
        </button>
      </div>
    </section>
  `;

  const renderContinuation = (messages) => `
    <section class="messages">${messages}</section>
    <section class="followup-row">
      <textarea data-role="followup" placeholder="Follow up. Cmd/Ctrl+Enter to send with lightweight refreshed page context.">${escapeHtml(state.followup)}</textarea>
      <div class="actions continuation-actions">
        <button type="button" data-role="open-session" class="secondary">Open Session</button>
        <button type="button" data-role="recapture" class="secondary" ${state.busy ? 'disabled' : ''}>
          ${state.recapturing ? 'Recapturing...' : 'Full recapture & send'}
        </button>
        <button type="button" data-role="send" class="primary" ${state.busy ? 'disabled' : ''}>Send</button>
      </div>
    </section>
  `;

  const styles = () => `
    :host { all: initial; --a2gent-overlay-height: 320px; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: min(var(--a2gent-overlay-height), 60vh);
      min-height: 240px;
      max-height: 640px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px 12px;
      color: #e9f0fb;
      background: linear-gradient(180deg, #121821 0%, #0e1218 100%);
      border-top: 1px solid rgba(145, 181, 255, 0.35);
      box-shadow: 0 -14px 44px rgba(0, 0, 0, 0.45);
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .resize { position: absolute; top: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
    header, .settings-row, .project-row, .session-bar, .followup-row, .actions, .header-actions { display: flex; align-items: center; gap: 8px; }
    header { justify-content: space-between; flex: 0 0 auto; }
    .header-actions { flex: 0 0 auto; }
    strong { font-weight: 700; }
    code { color: #b9d8ff; }
    label { display: grid; gap: 3px; flex: 1; min-width: 0; }
    label > span { color: #9fb1c7; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    input, select, textarea {
      width: 100%;
      border: 1px solid rgba(155, 181, 220, 0.24);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      color: #f3f7ff;
      padding: 7px 9px;
      font: inherit;
      outline: none;
    }
    textarea { min-height: 80px; resize: vertical; }
    .settings-panel {
      display: grid;
      gap: 8px;
      padding: 8px;
      border: 1px solid rgba(155, 181, 220, 0.16);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
    }
    .settings-row label { flex: 1 1 360px; }
    .project-row select { min-height: 34px; }
    button {
      border: 0;
      border-radius: 8px;
      padding: 8px 12px;
      color: #f7fbff;
      background: rgba(255, 255, 255, 0.12);
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.primary { background: #3978d6; font-weight: 700; }
    button.secondary { background: rgba(84, 119, 166, 0.42); }
    button.ghost { background: transparent; border: 1px solid rgba(255,255,255,.16); }
    .status { margin-left: 10px; color: #9fc0f0; font-size: 12px; }
    .status.error { color: #ffb4b4; }
    .warning {
      border: 1px solid rgba(255, 202, 96, .3);
      background: rgba(255, 202, 96, .09);
      color: #f7dfaa;
      border-radius: 9px;
      padding: 7px 9px;
      font-size: 12px;
    }
    .detection { flex: 1; display: grid; gap: 2px; min-width: 200px; color: #9fb1c7; }
    .detection strong { color: #e9f0fb; font-size: 12px; }
    .detection.auto strong { color: #9ff0c1; }
    .detection.default strong { color: #f7dfaa; }
    .create-grid { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; min-height: 0; }
    .messages {
      flex: 1 1 auto;
      overflow: auto;
      display: grid;
      gap: 8px;
      min-height: 0;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 10px;
      padding: 8px;
      background: rgba(0,0,0,.18);
    }
    .message { border-radius: 9px; padding: 7px 9px; background: rgba(255,255,255,.06); }
    .message.user { border-left: 3px solid #3978d6; }
    .message.assistant { border-left: 3px solid #67c587; }
    .message-role { font-size: 11px; color: #9fb1c7; margin-bottom: 3px; text-transform: uppercase; }
    .message pre { margin: 0; white-space: pre-wrap; color: #eef5ff; font: inherit; }
    .empty { color: #8fa1b9; }
    .followup-row { display: grid; grid-template-columns: 1fr; align-items: stretch; }
    .followup-row textarea { min-height: 54px; }
    .continuation-actions { justify-content: flex-end; flex-wrap: wrap; }
    @media (max-width: 720px) {
      .panel { height: min(var(--a2gent-overlay-height), 60vh); }
      .settings-row, .project-row, .create-grid, .followup-row { display: grid; grid-template-columns: 1fr; }
      button { width: 100%; }
      .header-actions button { width: auto; }
    }
  `;

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
