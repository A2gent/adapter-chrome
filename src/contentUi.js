((root) => {
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const DRAWING_TOOLS = [
    { id: 'arrow', label: 'Arrow', hint: 'Drag an arrow. Notes stay in the popup; screenshots show only the number.' },
    { id: 'region', label: 'Rectangle', hint: 'Drag a rectangle. Notes stay in the popup; screenshots show only the number.' },
    { id: 'element', label: 'Element', hint: 'Click a page element to highlight it with a precise red border.' },
  ];

  const activeDrawingTool = (state) => (
    DRAWING_TOOLS.some((tool) => tool.id === state.drawingTool) ? state.drawingTool : 'region'
  );

  const iconSvg = (className, pathMarkup) => `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">${pathMarkup}</svg>
  `;

  const ICONS = {
    annotate: iconSvg('action-icon', '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="m13.5 6.5 3 3" fill="none" stroke="currentColor" stroke-width="2"></path>'),
    doneAnnotating: iconSvg('action-icon', '<path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>'),
    clearAnnotations: iconSvg('action-icon', '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'),
    refreshProjects: iconSvg('action-icon', '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M16 16h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'),
    settings: iconSvg('action-icon', '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" stroke-width="2"></path><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'),
  };

  const drawingToggleLabel = (state) => {
    if (state.drawingEnabled) return 'Done annotating';
    if (state.hasDrawing) return 'Add annotation';
    return 'Annotate';
  };

  const drawingToggleIcon = (state) => (
    state.drawingEnabled ? ICONS.doneAnnotating : ICONS.annotate
  );

  const renderDrawingTools = (state) => {
    // WHY: the previous floating toolbar sat at the top of the page and could not move with the dialog.
    // WHAT: keep Arrow/Rectangle/Element inside the adapter panel so dragging the dialog moves the tools.
    if (!state.drawingEnabled) return '';
    const toolId = activeDrawingTool(state);
    const hint = DRAWING_TOOLS.find((tool) => tool.id === toolId)?.hint || DRAWING_TOOLS[1].hint;
    return `
      <div class="drawing-tools" data-role="drawing-tools">
        <div class="drawing-tool-buttons">
          ${DRAWING_TOOLS.map((tool) => `
            <button type="button" data-tool="${tool.id}" aria-pressed="${tool.id === toolId ? 'true' : 'false'}">${tool.label}</button>
          `).join('')}
        </div>
        <span class="drawing-hint" data-role="drawing-hint">${hint}</span>
      </div>
    `;
  };

  const renderDrawingHeaderActions = (state) => {
    const toggleLabel = drawingToggleLabel(state);
    return `
      <button
        type="button"
        data-role="drawing-toggle"
        class="ghost icon-button ${state.drawingEnabled ? 'active-drawing' : ''}"
        aria-pressed="${state.drawingEnabled ? 'true' : 'false'}"
        aria-label="${escapeHtml(toggleLabel)}"
        title="${escapeHtml(toggleLabel)}"
        ${state.busy ? 'disabled' : ''}
      >${drawingToggleIcon(state)}</button>
      ${(state.drawingEnabled || state.hasDrawing) ? `
        <button
          type="button"
          data-role="drawing-cancel"
          class="ghost icon-button danger"
          aria-label="Clear annotations"
          title="Clear annotations"
          ${state.busy ? 'disabled' : ''}
        >${ICONS.clearAnnotations}</button>
      ` : ''}
    `;
  };

  const renderProjectContext = (state, selectedProject, projectOptions) => `
    <div class="project-row">
      <label>
        <span>Project context</span>
        <select data-role="project">
          <option value="">Select project...</option>
          ${projectOptions}
        </select>
      </label>
      <button
        type="button"
        data-role="refresh-projects"
        class="secondary icon-button"
        aria-label="Refresh projects"
        title="Refresh projects"
      >${ICONS.refreshProjects}</button>
    </div>
  `;

  const renderCreation = (state, selectedProject, projectOptions) => `
    <section class="create-panel" aria-label="Create a new A2gent session">
      ${renderProjectContext(state, selectedProject, projectOptions)}
      <section class="create-composer">
        <textarea data-role="prompt" rows="1" aria-label="Start a new chat" placeholder="Start a new chat... Enter to send, Shift+Enter for newline.">${escapeHtml(state.prompt)}</textarea>
        <button
          type="button"
          data-role="create"
          class="primary send-button ${state.busy ? 'is-busy' : ''}"
          aria-label="${state.busy ? 'Creating session' : 'Create session and send diagnostics'}"
          title="${state.busy ? 'Creating session' : 'Create session and send diagnostics'}"
          ${state.busy ? 'disabled' : ''}
        >
          <span class="visually-hidden">${state.busy ? 'Working...' : 'Create session and send diagnostics'}</span>
          <svg class="send-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M3.7 20.3 21 12 3.7 3.7l1.4 6.1L14 12l-8.9 2.2-1.4 6.1Z" fill="currentColor"></path>
          </svg>
        </button>
      </section>
    </section>
  `;

  const renderContinuation = (state, messages) => `
    <section class="messages">${messages}</section>
    <section class="followup-row">
      <textarea data-role="followup" placeholder="Follow up. Enter to send, Shift+Enter for newline.">${escapeHtml(state.followup)}</textarea>
      <div class="actions continuation-actions">
        <button type="button" data-role="open-session" class="secondary">Open Session</button>
        <button type="button" data-role="recapture" class="secondary" ${state.busy ? 'disabled' : ''}>
          ${state.recapturing ? 'Recapturing...' : 'Full recapture & send'}
        </button>
        <button type="button" data-role="send" class="primary" ${state.busy ? 'disabled' : ''}>Send</button>
      </div>
    </section>
  `;

  const renderStyles = ({ compactOverlayHeight, compactOverlayMinHeight, expandedOverlayMinHeight }) => `
    :host {
      all: initial;
      --a2gent-overlay-height: ${compactOverlayHeight}px;
      /* WHY: popover UA styles center a bordered dialog; we only need transparent top-layer stacking. */
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      overflow: visible;
      pointer-events: none;
    }
    * { box-sizing: border-box; }
    .panel {
      position: fixed;
      left: var(--a2gent-overlay-left, 0px);
      right: auto;
      bottom: var(--a2gent-overlay-bottom, 0px);
      width: min(var(--a2gent-overlay-width, 100vw), calc(100vw - var(--a2gent-overlay-left, 0px)));
      height: min(var(--a2gent-overlay-height), 60vh);
      min-height: ${compactOverlayMinHeight}px;
      max-height: 640px;
      z-index: 2147483647;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 14px 14px;
      color: #e9f0fb;
      background: linear-gradient(180deg, #14181f 0%, #0d1117 100%);
      border-top: 1px solid rgba(145, 181, 255, 0.28);
      box-shadow: 0 -14px 44px rgba(0, 0, 0, 0.45);
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      direction: ltr;
      text-align: left;
      unicode-bidi: isolate;
    }
    .panel.has-session,
    .panel.settings-open { min-height: ${expandedOverlayMinHeight}px; }
    .panel.is-new-session:not(.settings-open) { justify-content: flex-start; }
    .resize { position: absolute; top: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
    header, .settings-row, .project-row, .session-bar, .followup-row, .actions, .header-actions { display: flex; align-items: center; gap: 8px; }
    header {
      justify-content: space-between;
      flex: 0 0 auto;
      min-height: 32px;
      cursor: move;
      user-select: none;
      touch-action: none;
    }
    .drawing-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      cursor: move;
      user-select: none;
      touch-action: none;
    }
    .drawing-tool-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .drawing-tools button {
      border-radius: 999px;
      padding: 6px 11px;
      cursor: pointer;
    }
    .drawing-tools button[aria-pressed="true"] {
      background: #ffd166;
      color: #111827;
      font-weight: 800;
    }
    .drawing-hint { color: #9fb1c7; font-size: 12px; min-width: 0; flex: 1 1 180px; }
    header textarea,
    header input,
    header select,
    header button,
    header a { cursor: auto; }
    header > div:first-child { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
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
    input:focus, select:focus, textarea:focus {
      border-color: rgba(102, 95, 255, 0.95);
      box-shadow: 0 0 0 1px rgba(102, 95, 255, 0.36);
    }
    textarea { min-height: 80px; resize: vertical; }
    textarea::placeholder { color: rgba(243, 247, 255, 0.58); }
    .settings-panel {
      display: grid;
      gap: 8px;
      padding: 8px;
      border: 1px solid rgba(155, 181, 220, 0.16);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
    }
    .settings-row label { flex: 1 1 360px; }
    .project-row label { flex: 0 1 220px; max-width: 220px; }
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
    button.secondary.active { background: #ffd166; color: #111827; font-weight: 700; }
    button.ghost { background: transparent; border: 1px solid rgba(255,255,255,.16); }
    .icon-button {
      width: 36px;
      min-width: 36px;
      height: 36px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .close-icon { width: 18px; height: 18px; }
    .action-icon { width: 18px; height: 18px; }
    button.ghost.active-drawing { border-color: rgba(255, 209, 102, .86); color: #ffe7a6; }
    button.ghost.danger { border-color: rgba(255, 95, 86, .52); color: #ffb4b4; }
    button.ghost:hover, button.secondary:hover { background: rgba(255,255,255,.16); }
    .status { margin-left: 0; color: #9fc0f0; font-size: 12px; }
    .status.error { color: #ffb4b4; }
    .warning {
      border: 1px solid rgba(255, 202, 96, .3);
      background: rgba(255, 202, 96, .09);
      color: #f7dfaa;
      border-radius: 9px;
      padding: 7px 9px;
      font-size: 12px;
    }
    .create-panel {
      display: grid;
      gap: 8px;
      flex: 0 0 auto;
    }
    .create-composer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 48px;
      gap: 12px;
      align-items: center;
      flex: 0 0 auto;
      min-height: 84px;
    }
    .create-composer textarea {
      height: 82px;
      min-height: 82px;
      max-height: 160px;
      resize: none;
      overflow: auto;
      border-radius: 14px;
      border-color: rgba(102, 95, 255, 0.95);
      background: rgba(255, 255, 255, 0.10);
      box-shadow: 0 0 0 1px rgba(102, 95, 255, 0.32);
      padding: 15px 18px;
      color: #f4f4f5;
      font-size: 16px;
      line-height: 24px;
    }
    button.send-button {
      width: 48px;
      min-width: 48px;
      height: 48px;
      padding: 0;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.14);
      color: #f7fbff;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.04);
    }
    .send-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.20); }
    .send-button:focus-visible { box-shadow: 0 0 0 2px rgba(102, 95, 255, 0.72); }
    .send-icon { width: 30px; height: 30px; transform: translateX(1px); }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
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
    .followup-row textarea { min-height: 72px; }
    .continuation-actions { justify-content: flex-end; flex-wrap: wrap; }
    @media (max-width: 720px) {
      .panel {
        width: min(var(--a2gent-overlay-width, 100vw), calc(100vw - var(--a2gent-overlay-left, 0px)));
        height: min(var(--a2gent-overlay-height), 60vh);
        padding: 10px 10px 12px;
      }
      .settings-row, .project-row, .followup-row { display: grid; grid-template-columns: 1fr; }
      button { width: 100%; }
      .header-actions button, .drawing-tools button, .project-row .icon-button { width: auto; }
      .create-composer { grid-template-columns: minmax(0, 1fr) 44px; gap: 10px; min-height: 76px; }
      .create-composer textarea { height: 74px; min-height: 74px; padding: 13px 15px; font-size: 15px; }
      .create-composer button.send-button { width: 44px; min-width: 44px; height: 44px; }
      .send-icon { width: 28px; height: 28px; }
    }
  `;

  const renderSettingsPanel = (state) => {
    if (!state.settingsOpen) return '';
    // WHY: connection setup is an advanced control, not the primary diagnosis action.
    // WHAT: render it only after the user explicitly opens Settings.
    return `
      <section class="settings-panel" aria-label="Adapter settings">
        <section class="warning">
          Diagnosis sends a compact page diagnostic bundle to your local Brute instance: URL, title, selected text, screenshot, console logs and page errors. DOM snapshots and network logs are omitted from automatic posts so agents can fetch them on demand only when needed. Cookies, browser storage, network headers and request/response bodies are excluded.
        </section>
        <div class="settings-row">
          <label>
            <span>Local Brute URL</span>
            <input data-role="base-url" value="${escapeHtml(state.baseUrl)}" placeholder="http://localhost:5445" />
          </label>
          <button type="button" data-role="save-base-url" class="secondary">Save URL</button>
        </div>
      </section>
    `;
  };

  const renderMessages = (messages) => {
    if (!messages.length) {
      return '<div class="empty">No inline messages yet. Create a session to start.</div>';
    }
    return messages.map((message) => `
      <div class="message ${message.role}">
        <div class="message-role">${escapeHtml(message.role)}</div>
        <pre>${escapeHtml(message.content)}</pre>
      </div>
    `).join('');
  };

  const renderOverlay = ({ state, compactOverlayHeight, compactOverlayMinHeight, expandedOverlayMinHeight }) => {
    const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) || null;
    const projectOptions = state.projects.map((project) => (
      `<option value="${escapeHtml(project.id)}" ${project.id === state.selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`
    )).join('');
    const messages = renderMessages(Array.isArray(state.messages) ? state.messages : []);
    const settingsPanel = renderSettingsPanel(state);

    return `
      <style>${renderStyles({ compactOverlayHeight, compactOverlayMinHeight, expandedOverlayMinHeight })}</style>
      <div class="panel ${state.sessionId ? 'has-session' : 'is-new-session'} ${state.settingsOpen ? 'settings-open' : ''}" role="dialog" aria-label="A2gent browser diagnostics">
        <div class="resize" data-role="resize" title="Drag to resize"></div>
        <header>
          <div>
            <strong>A2gent Browser Adapter</strong>
            <span class="status ${state.error ? 'error' : ''}">${escapeHtml(state.error || state.status)}</span>
          </div>
          <div class="header-actions">
            ${renderDrawingHeaderActions(state)}
            <button
              type="button"
              data-role="settings-toggle"
              class="ghost icon-button"
              aria-expanded="${state.settingsOpen ? 'true' : 'false'}"
              aria-label="${state.settingsOpen ? 'Hide settings' : 'Settings'}"
              title="${state.settingsOpen ? 'Hide settings' : 'Settings'}"
            >${ICONS.settings}</button>
            <button type="button" data-role="close" class="ghost icon-button" aria-label="Close" title="Close">
              <svg class="close-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
              </svg>
            </button>
          </div>
        </header>
        ${renderDrawingTools(state)}
        ${settingsPanel}
        ${state.sessionId ? renderContinuation(state, messages) : renderCreation(state, selectedProject, projectOptions)}
      </div>
    `;
  };

  const api = { renderOverlay };

  if (root && typeof root === 'object') {
    root.__A2GENT_CONTENT_UI__ = api;
  }

  if (typeof module !== 'undefined') {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
