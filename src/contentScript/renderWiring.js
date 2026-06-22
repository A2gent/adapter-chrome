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

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const numericOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const clampOverlayPosition = (rawPosition = {}, state = {}, shadow = null) => {
    const viewportWidth = Math.max(320, window.innerWidth || 320);
    const viewportHeight = Math.max(240, window.innerHeight || 240);
    const margin = 8;
    const maxWidth = Math.max(280, viewportWidth - (margin * 2));
    const defaultWidth = Math.min(760, maxWidth);
    const width = clamp(numericOr(rawPosition.width, defaultWidth), Math.min(320, maxWidth), maxWidth);
    const panelHeight = shadow?.querySelector?.('.panel')?.getBoundingClientRect?.().height
      || Math.max(numericOr(state.overlayHeight, shared.COMPACT_OVERLAY_HEIGHT), shared.COMPACT_OVERLAY_MIN_HEIGHT);
    const defaultLeft = Math.round((viewportWidth - width) / 2);
    const left = clamp(numericOr(rawPosition.left, defaultLeft), margin, Math.max(margin, viewportWidth - width - margin));
    const bottom = clamp(numericOr(rawPosition.bottom, 12), margin, Math.max(margin, viewportHeight - panelHeight - margin));
    return { left, bottom, width };
  };

  const applyOverlayLayout = (host, state, shadow = null) => {
    if (!host || !state) return null;
    const position = clampOverlayPosition(state.overlayPosition, state, shadow);
    state.overlayPosition = position;
    host.style.setProperty('--a2gent-overlay-left', `${Math.round(position.left)}px`);
    host.style.setProperty('--a2gent-overlay-bottom', `${Math.round(position.bottom)}px`);
    host.style.setProperty('--a2gent-overlay-width', `${Math.round(position.width)}px`);
    return position;
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
        applyOverlayLayout(host, getState(), shadow);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    const dragHandle = shadow.querySelector('header');
    dragHandle?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest?.('button, input, select, textarea, a, [data-role="resize"]')) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const currentState = getState();
      const startPosition = applyOverlayLayout(host, currentState, shadow) || clampOverlayPosition(currentState.overlayPosition, currentState, shadow);
      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        const nextPosition = clampOverlayPosition({
          ...startPosition,
          left: startPosition.left + (moveEvent.clientX - startX),
          bottom: startPosition.bottom - (moveEvent.clientY - startY),
        }, getState(), shadow);
        getState().overlayPosition = nextPosition;
        applyOverlayLayout(host, getState(), shadow);
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
    applyOverlayLayout(host, state, shadow);
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
    applyOverlayLayout(host, state, shadow);
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
