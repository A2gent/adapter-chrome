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
    host.setAttribute('dir', 'ltr');
    host.style.display = 'none';
    document.documentElement.appendChild(host);
    setHost(host);
    setShadow(host.attachShadow({ mode: 'open' }));
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const clampOverlayWidth = (rawWidth, viewportWidth = window.innerWidth || 320) => {
    const width = Math.max(320, Number(viewportWidth) || 320);
    const minWidth = Math.min(shared.SIDEBAR_OVERLAY_MIN_WIDTH, width - 16);
    const maxWidth = Math.max(minWidth, Math.round(width * shared.SIDEBAR_OVERLAY_MAX_WIDTH_RATIO));
    const fallback = Math.round(width * shared.SIDEBAR_OVERLAY_WIDTH_RATIO);
    const requested = Number(rawWidth);
    const chosen = Number.isFinite(requested) && requested > 0 ? requested : fallback;
    return clamp(chosen, minWidth, maxWidth);
  };

  const applyOverlayLayout = (host, state) => {
    if (!host || !state) return null;
    const width = clampOverlayWidth(state.overlayWidth);
    state.overlayWidth = width;
    host.style.setProperty('--a2gent-overlay-width', `${Math.round(width)}px`);
    return { width };
  };

  const attachEvents = ({
    getShadow,
    getHost,
    getState,
    setState,
    saveBaseUrl,
    loadSettingsAndProjects,
    changeProject,
    changeProvider,
    changeAgent,
    changeModel,
    startSession,
    sendFollowup,
    sendFullRecapture,
    openSessionDetail,
    toggleDrawing,
    cancelDrawing,
    setDrawingTool,
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
      if (typeof changeProject === 'function') {
        void changeProject(event.target.value);
        return;
      }
      setState({
        selectedProjectId: event.target.value,
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Project chosen manually.' },
      });
    });
    shadow.querySelector('[data-role="agent"]')?.addEventListener('change', (event) => {
      if (typeof changeAgent === 'function') void changeAgent(event.target.value);
      else setState({ selectedAgentId: event.target.value });
    });
    shadow.querySelector('[data-role="provider"]')?.addEventListener('change', (event) => {
      if (typeof changeProvider === 'function') void changeProvider(event.target.value);
      else setState({ selectedProvider: event.target.value });
    });
    shadow.querySelector('[data-role="model"]')?.addEventListener('change', (event) => {
      if (typeof changeModel === 'function') void changeModel(event.target.value);
      else setState({ selectedModel: event.target.value });
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
    shadow.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDrawingTool?.(button.getAttribute('data-tool'));
      });
    });
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
      const startX = event.clientX;
      const currentState = getState();
      const startWidth = applyOverlayLayout(host, currentState)?.width || clampOverlayWidth(currentState.overlayWidth);
      const onMove = (moveEvent) => {
        // WHY: the handle sits on the left edge of a right-docked panel.
        // WHAT: dragging left grows the sidebar; dragging right shrinks it.
        const nextWidth = clampOverlayWidth(startWidth + (startX - moveEvent.clientX));
        getState().overlayWidth = nextWidth;
        applyOverlayLayout(host, getState());
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
    // WHY: high page z-index / stacking contexts can cover a plain shadow panel and steal focus.
    // WHAT: promote the host into the browser top layer (popover) or max fixed z-index fallback.
    shared.setOverlayHostTopLayer(host, state.open, {
      zIndex: shared.OVERLAY_TOP_LAYER_Z_INDEX,
      pointerEvents: 'none',
      raise: state.open,
    });
    applyOverlayLayout(host, state);
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
    applyOverlayLayout(host, state);
    const messages = shadow.querySelector('.messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    restoreOverlayFocusSnapshot(focusSnapshot);
    if (consumeShouldFocusPrimaryControl()) {
      window.requestAnimationFrame(focusPrimaryControl);
    }
  };

  return {
    ensureOverlay,
    attachEvents,
    render,
    clampOverlayWidth,
  };
});
