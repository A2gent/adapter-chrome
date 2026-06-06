((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const exported = factory(shared || require('./shared.js'));
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_OVERLAY_FOCUS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared) => {
  const overlayEventPath = (event) => {
    try {
      return typeof event?.composedPath === 'function' ? event.composedPath() : [];
    } catch {
      return [];
    }
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

  const isOverlayEvent = (event, host, shadow, state) => {
    if (!host || !state?.open) return false;
    const path = overlayEventPath(event);
    if (path.includes(host) || (shadow && path.includes(shadow))) return true;
    return event.target === host || (event.target instanceof Node && host.contains(event.target));
  };

  const readOverlayFocusSnapshot = (shadow, state) => {
    if (!shadow || !state?.open) return null;
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

  const focusOverlayControl = (shadow, state, role, selection = null) => {
    if (!state?.open || !shadow || !role) return;
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

  const restoreOverlayFocusSnapshot = (shadow, state, snapshot) => {
    if (!snapshot) return;
    focusOverlayControl(shadow, state, snapshot.role, snapshot);
    window.requestAnimationFrame(() => focusOverlayControl(shadow, state, snapshot.role, snapshot));
  };

  const isOverlayRoleFocused = (host, shadow, state, role) => (
    state?.open
    && document.activeElement === host
    && shadow?.activeElement?.getAttribute?.('data-role') === role
  );

  const focusPrimaryControl = (shadow, state) => {
    if (!state?.open || !shadow) return;
    const role = state.sessionId ? 'followup' : 'prompt';
    focusOverlayControl(shadow, state, role, { selectionStart: Number.MAX_SAFE_INTEGER, selectionEnd: Number.MAX_SAFE_INTEGER });
  };

  const installOverlayKeyboardShield = ({ hostRef, shadowRef, stateRef, onSubmit }) => {
    const handleOverlayKeyboardEvent = (event) => {
      const host = hostRef();
      const shadow = shadowRef();
      const state = stateRef();
      if (!isOverlayEvent(event, host, shadow, state)) return;

      const role = roleFromOverlayEvent(event);
      if (shouldSubmitOverlayComposer(event, role)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof onSubmit === 'function') {
          onSubmit(role, event);
        } else {
          window.dispatchEvent(new CustomEvent(shared.OVERLAY_SUBMIT_EVENT, { detail: role }));
        }
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

    return handleOverlayKeyboardEvent;
  };

  return {
    overlayEventPath,
    roleFromOverlayEvent,
    shouldSubmitOverlayComposer,
    isFocusableOverlayControl,
    isOverlayEvent,
    readOverlayFocusSnapshot,
    focusOverlayControl,
    restoreOverlayFocusSnapshot,
    isOverlayRoleFocused,
    focusPrimaryControl,
    installOverlayKeyboardShield,
  };
});
