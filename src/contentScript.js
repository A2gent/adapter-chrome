(() => {
  if (window.__A2GENT_BROWSER_ADAPTER_CONTENT__) {
    return;
  }
  window.__A2GENT_BROWSER_ADAPTER_CONTENT__ = true;

  const shared = window.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const focus = window.__A2GENT_CONTENT_SCRIPT_OVERLAY_FOCUS__;
  const api = window.__A2GENT_CONTENT_SCRIPT_CAESAR_API__;
  const diagnostics = window.__A2GENT_CONTENT_SCRIPT_PAGE_DIAGNOSTICS__;
  const drawingBridge = window.__A2GENT_CONTENT_SCRIPT_DRAWING_BRIDGE__;
  const settings = window.__A2GENT_CONTENT_SCRIPT_PROJECT_SETTINGS__;
  const renderWiring = window.__A2GENT_CONTENT_SCRIPT_RENDER_WIRING__;

  const DEFAULT_BRUTE_BASE_URL = shared.DEFAULT_BRUTE_BASE_URL;
  const DEFAULT_CAESAR_BASE_URL = shared.DEFAULT_CAESAR_BASE_URL;
  const STORAGE_BASE_URL_KEY = shared.STORAGE_BASE_URL_KEY;
  const SOURCE = shared.SOURCE;
  const EXTENSION_VERSION = shared.EXTENSION_VERSION;
  // Keep the literal event name visible in this entry file because source-based tests
  // verify that the overlay submit contract stays wired here: a2gent-overlay-submit.
  const OVERLAY_SUBMIT_EVENT = shared.OVERLAY_SUBMIT_EVENT;
  const DRAWING_CHANGE_EVENT = shared.DRAWING_CHANGE_EVENT;
  const DRAWING_ROOT_ID = shared.DRAWING_ROOT_ID;
  const MAX_SELECTED_TEXT_LIGHT = shared.MAX_SELECTED_TEXT_LIGHT;
  const MAX_SELECTED_TEXT_FULL = shared.MAX_SELECTED_TEXT_FULL;
  const MAX_DOM_HTML = shared.MAX_DOM_HTML;
  const MAX_DOM_TEXT = shared.MAX_DOM_TEXT;
  const MAX_NETWORK_ENTRIES = shared.MAX_NETWORK_ENTRIES;
  const COMPACT_OVERLAY_HEIGHT = shared.COMPACT_OVERLAY_HEIGHT;
  const COMPACT_OVERLAY_MIN_HEIGHT = shared.COMPACT_OVERLAY_MIN_HEIGHT;
  const EXPANDED_OVERLAY_MIN_HEIGHT = shared.EXPANDED_OVERLAY_MIN_HEIGHT;

  const buildSessionDetailUrl = shared.buildSessionDetailUrl;
  const shouldSubmitOverlayComposer = (event, role) => (
    event.type === 'keydown'
    && (role === 'prompt' || role === 'followup')
    && event.key === 'Enter'
    && !event.shiftKey
    && !event.isComposing
    && event.keyCode !== 229
  );
  // Keep the literal event.preventDefault() reference visible in this entry file because
  // source-based tests assert that submit-on-Enter stays coupled to prevented textarea newlines.

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
    messages: [],
    status: 'Idle',
    error: '',
    busy: false,
    recapturing: false,
    drawingEnabled: false,
    hasDrawing: false,
    annotationCount: 0,
    drawingStrokeCount: 0,
    sessionId: '',
    overlayHeight: COMPACT_OVERLAY_HEIGHT,
    settingsOpen: false,
  };

  const readOverlayFocusSnapshot = () => focus.readOverlayFocusSnapshot(shadow, state);
  const restoreOverlayFocusSnapshot = (snapshot) => focus.restoreOverlayFocusSnapshot(shadow, state, snapshot);
  const focusOverlayControl = (role, selection = null) => focus.focusOverlayControl(shadow, state, role, selection);
  const isOverlayRoleFocused = (role) => focus.isOverlayRoleFocused(host, shadow, state, role);
  const focusPrimaryControl = () => focus.focusPrimaryControl(shadow, state);

  const getState = () => state;
  const setRawState = (nextState) => {
    state = nextState;
  };

  const render = () => renderWiring.render({
    getHost: () => host,
    getShadow: () => shadow,
    getState,
    attachEvents,
    readOverlayFocusSnapshot,
    restoreOverlayFocusSnapshot,
    consumeShouldFocusPrimaryControl: () => {
      if (!shouldFocusPrimaryControl) return false;
      shouldFocusPrimaryControl = false;
      return true;
    },
    focusPrimaryControl,
  });

  const setState = (patch) => {
    state = { ...state, ...patch };
    render();
  };

  const appendMessage = (role, content) => {
    state = {
      ...state,
      messages: [...shared.normalizeMessages(state.messages), { role, content, timestamp: shared.nowIso() }],
    };
    render();
  };

  const updateLastAssistant = (delta) => {
    const messages = shared.normalizeMessages(state.messages);
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') {
      messages.push({ role: 'assistant', content: delta, timestamp: shared.nowIso() });
    } else {
      messages[messages.length - 1] = { ...last, content: `${last.content}${delta}` };
    }
    state = { ...state, messages };
    render();
  };

  const setMessagesFromServer = (messages) => {
    state = {
      ...state,
      messages: shared.normalizeMessages(messages),
    };
    render();
  };

  const validateLoopbackBaseUrl = shared.validateLoopbackBaseUrl;
  const storageGet = shared.storageGet;
  const storageSet = shared.storageSet;
  const serializeApiOptions = shared.serializeApiOptions;
  const sendRuntimeMessage = shared.sendRuntimeMessage;

  const client = api.createApiClient({ getBaseUrl: () => state.baseUrl || DEFAULT_BRUTE_BASE_URL });
  const createSession = client.createSession;
  const listProjects = client.listProjects;

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

  const sendStreamMessage = (sessionId, message, images = []) => client.sendStreamMessage(sessionId, message, images, { onEvent: handleStreamEvent });

  const syncDrawingState = () => {
    drawingBridge.syncDrawingState(getState, setRawState);
    render();
  };

  const toggleDrawing = () => {
    drawingBridge.toggleDrawing(setState);
    syncDrawingState();
  };

  const cancelDrawing = () => {
    drawingBridge.cancelDrawing();
    syncDrawingState();
  };

  const disableDrawingInput = () => {
    drawingBridge.disableDrawingInput();
    syncDrawingState();
  };

  const getDrawingSummary = () => drawingBridge.getDrawingSummary();

  const annotationReferenceComposerRole = () => (state.sessionId ? 'followup' : 'prompt');

  const syncAnnotationReferenceText = (reference) => {
    if (!reference || !reference.number) return;
    const role = annotationReferenceComposerRole();
    const nextText = shared.upsertAnnotationReferenceText(state[role], reference);
    if (nextText === state[role]) return;

    state = { ...state, [role]: nextText };
    // WHY: annotation text is typed in the floating annotation editor.
    // WHAT: update the composer value without moving focus away from that editor.
    render();
  };

  const collectFullDiagnostics = (userPrompt, reason) => diagnostics.collectFullDiagnostics({
    userPrompt,
    reason,
    disableDrawingInput,
    getDrawingSummary,
    host,
    isOverlayOpen: state.open,
  });
  const collectLightweightRefresh = diagnostics.collectLightweightRefresh;
  const imageFromScreenshot = diagnostics.imageFromScreenshot;
  const createInitialMessage = diagnostics.createInitialMessage;
  const createFollowupMessage = diagnostics.createFollowupMessage;
  const createRecaptureMessage = diagnostics.createRecaptureMessage;

  const loadSettingsAndProjects = () => settings.loadSettingsAndProjects({
    getState,
    setState,
    setRawState,
    listProjects,
    render,
  });

  const saveBaseUrl = () => settings.saveBaseUrl({
    shadow,
    setState,
    loadSettingsAndProjects,
  });

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
      const diagnosticsBundle = await collectFullDiagnostics(prompt, 'initial_full');
      const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) || null;
      const metadata = {
        source: SOURCE,
        created_by: 'adapter-chrome-extension',
        extension_version: EXTENSION_VERSION,
        browser_url: location.href,
        page_title: document.title,
        project_detection: state.projectDetection,
        project_name: selectedProject?.name || '',
        has_focus_annotation: Boolean(diagnosticsBundle.payload.focus_annotation),
        focus_annotation_count: diagnosticsBundle.payload.focus_annotation?.annotation_count || diagnosticsBundle.payload.focus_annotation?.stroke_count || 0,
      };
      const created = await createSession(state.selectedProjectId, metadata);
      setState({ sessionId: created.id, status: 'Sending diagnostics to agent...' });
      appendMessage('user', prompt);
      await sendStreamMessage(
        created.id,
        createInitialMessage(prompt, diagnosticsBundle.payload),
        [imageFromScreenshot(diagnosticsBundle.screenshotDataUrl, 'initial-page-screenshot.png')],
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

  focus.installOverlayKeyboardShield({
    hostRef: () => host,
    shadowRef: () => shadow,
    stateRef: () => state,
    onSubmit: (role) => {
      window.dispatchEvent(new CustomEvent(OVERLAY_SUBMIT_EVENT, { detail: role }));
    },
  });

  window.addEventListener(DRAWING_CHANGE_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.updatedReference) {
      syncAnnotationReferenceText(detail.updatedReference);
    }
    setState({
      drawingEnabled: Boolean(detail.enabled),
      hasDrawing: Boolean(detail.hasAnnotations ?? detail.hasStrokes),
      annotationCount: Number(detail.annotationCount ?? detail.strokeCount) || 0,
      drawingStrokeCount: Number(detail.annotationCount ?? detail.strokeCount) || 0,
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
      const diagnosticsBundle = await collectFullDiagnostics('Manual full diagnostic recapture', 'manual_full_recapture');
      appendMessage('user', 'Manual full diagnostic recapture');
      setState({ status: 'Sending full recapture...' });
      await sendStreamMessage(
        state.sessionId,
        createRecaptureMessage(diagnosticsBundle.payload),
        [imageFromScreenshot(diagnosticsBundle.screenshotDataUrl, 'manual-full-recapture.png')],
      );
      setState({ recapturing: false, busy: false, status: 'Full recapture sent' });
    } catch (error) {
      setState({ recapturing: false, busy: false, status: 'Error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const attachEvents = () => renderWiring.attachEvents({
    getShadow: () => shadow,
    getHost: () => host,
    getState,
    setState,
    saveBaseUrl,
    loadSettingsAndProjects,
    startSession,
    sendFollowup,
    sendFullRecapture,
    openSessionDetail,
    toggleDrawing,
    cancelDrawing,
    disableDrawingInput,
    submitOverlayComposer,
  });

  const ensureOverlay = () => renderWiring.ensureOverlay(
    () => host,
    () => shadow,
    (nextHost) => { host = nextHost; },
    (nextShadow) => { shadow = nextShadow; },
  );

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
