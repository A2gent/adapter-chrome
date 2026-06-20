((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const focus = root?.__A2GENT_CONTENT_SCRIPT_OVERLAY_FOCUS__;
  const exported = factory(
    shared || require('./shared.js'),
    focus || require('./overlayFocus.js'),
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_RENDER_WIRING__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared, focus) => {
  const ensureOverlay = (getHost, getShadow, setHost, setShadow) => {
    if (getHost() && getShadow()) return;
    const host = document.createElement('div');
    host.id = 'a2gent-browser-adapter-root';
    host.style.display = 'none';
    document.documentElement.appendChild(host);
    setHost(host);
    setShadow(host.attachShadow({ mode: 'open' }));
  };

  const attachEvents = ({
    getShadow,
    getHost,
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
  }) => {
    const shadow = getShadow();
    const host = getHost();
    shadow.querySelector('[data-role="close"]')?.addEventListener('click', () => {
      disableDrawingInput();
      setState({ open: false, settingsOpen: false });
    });
    shadow.querySelector('[data-role="settings-toggle"]')?.addEventListener('click', () => setState({ settingsOpen: !getState().settingsOpen }));
    shadow.querySelector('[data-role="refresh-projects"]')?.addEventListener('click', () => void loadSettingsAndProjects());
    shadow.querySelector('[data-role="save-base-url"]')?.addEventListener('click', () => void saveBaseUrl());
    shadow.querySelector('[data-role="project"]')?.addEventListener('change', (event) => {
      setState({
        selectedProjectId: event.target.value,
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Project chosen manually.' },
      });
    });
    shadow.querySelector('[data-role="prompt"]')?.addEventListener('input', (event) => {
      getState().prompt = event.target.value;
    });
    shadow.querySelector('[data-role="followup"]')?.addEventListener('input', (event) => {
      getState().followup = event.target.value;
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
        if (!focus.shouldSubmitOverlayComposer(event, role)) return;
        event.preventDefault();
        submitOverlayComposer(role);
      });
    });

    const resize = shadow.querySelector('[data-role="resize"]');
    resize?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const currentState = getState();
      const minHeight = currentState.sessionId || currentState.settingsOpen ? shared.EXPANDED_OVERLAY_MIN_HEIGHT : shared.COMPACT_OVERLAY_MIN_HEIGHT;
      const startHeight = Math.max(currentState.overlayHeight, minHeight);
      const onMove = (moveEvent) => {
        const maxHeight = Math.min(640, Math.floor(window.innerHeight * (window.innerWidth < 720 ? 0.6 : 0.9)));
        const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + (startY - moveEvent.clientY)));
        getState().overlayHeight = nextHeight;
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

  const render = ({ getHost, getShadow, getState, attachEvents, readOverlayFocusSnapshot, restoreOverlayFocusSnapshot, consumeShouldFocusPrimaryControl, focusPrimaryControl }) => {
    const host = getHost();
    const shadow = getShadow();
    const state = getState();
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
      compactOverlayHeight: shared.COMPACT_OVERLAY_HEIGHT,
      compactOverlayMinHeight: shared.COMPACT_OVERLAY_MIN_HEIGHT,
      expandedOverlayMinHeight: shared.EXPANDED_OVERLAY_MIN_HEIGHT,
    });
    attachEvents();
    restoreOverlayFocusSnapshot(focusSnapshot);
    if (consumeShouldFocusPrimaryControl()) {
      window.requestAnimationFrame(focusPrimaryControl);
    }
  };

  return {
    ensureOverlay,
    attachEvents,
    render,
  };
});
