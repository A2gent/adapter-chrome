((root) => {
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const renderDrawingHeaderActions = (state) => {
    const drawLabel = state.drawingEnabled ? 'Done drawing' : (state.hasDrawing ? 'Add more focus' : 'Draw focus');
    return `
      <button
        type="button"
        data-role="drawing-toggle"
        class="ghost ${state.drawingEnabled ? 'active-drawing' : ''}"
        aria-pressed="${state.drawingEnabled ? 'true' : 'false'}"
        ${state.busy ? 'disabled' : ''}
      >${drawLabel}</button>
      ${(state.drawingEnabled || state.hasDrawing) ? `
        <button type="button" data-role="drawing-cancel" class="ghost danger" ${state.busy ? 'disabled' : ''}>Cancel drawing</button>
      ` : ''}
    `;
  };

  const renderCreation = (state) => `
    <section class="create-composer" aria-label="Create a new A2gent session">
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
    :host { all: initial; --a2gent-overlay-height: ${compactOverlayHeight}px; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: min(var(--a2gent-overlay-height), 60vh);
      min-height: ${compactOverlayMinHeight}px;
      max-height: 640px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 14px 14px;
      color: #e9f0fb;
      background: linear-gradient(180deg, #14181f 0%, #0d1117 100%);
      border-top: 1px solid rgba(145, 181, 255, 0.28);
      box-shadow: 0 -14px 44px rgba(0, 0, 0, 0.45);
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel.has-session,
    .panel.settings-open { min-height: ${expandedOverlayMinHeight}px; }
    .panel.is-new-session:not(.settings-open) { justify-content: flex-start; }
    .resize { position: absolute; top: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
    header, .settings-row, .project-row, .session-bar, .followup-row, .actions, .header-actions { display: flex; align-items: center; gap: 8px; }
    header { justify-content: space-between; flex: 0 0 auto; min-height: 32px; }
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
    .detection { flex: 1; display: grid; gap: 2px; min-width: 200px; color: #9fb1c7; }
    .detection strong { color: #e9f0fb; font-size: 12px; }
    .detection.auto strong { color: #9ff0c1; }
    .detection.default strong { color: #f7dfaa; }
    .create-composer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 48px;
      gap: 12px;
      align-items: center;
      flex: 0 0 auto;
      min-height: 56px;
    }
    .create-composer textarea {
      height: 56px;
      min-height: 56px;
      max-height: 112px;
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
    .followup-row textarea { min-height: 54px; }
    .continuation-actions { justify-content: flex-end; flex-wrap: wrap; }
    @media (max-width: 720px) {
      .panel { height: min(var(--a2gent-overlay-height), 60vh); padding: 10px 10px 12px; }
      .settings-row, .project-row, .followup-row { display: grid; grid-template-columns: 1fr; }
      button { width: 100%; }
      .header-actions button { width: auto; }
      .create-composer { grid-template-columns: minmax(0, 1fr) 44px; gap: 10px; }
      .create-composer textarea { height: 52px; min-height: 52px; padding: 13px 15px; font-size: 15px; }
      .create-composer button.send-button { width: 44px; min-width: 44px; height: 44px; }
      .send-icon { width: 28px; height: 28px; }
    }
  `;

  const renderSettingsPanel = (state, selectedProject, projectOptions) => {
    if (!state.settingsOpen) return '';
    // WHY: connection and project setup are advanced controls, not the primary diagnosis action.
    // WHAT: render them only after the user explicitly opens Settings.
    return `
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
    const messages = renderMessages(state.messages || []);
    const settingsPanel = renderSettingsPanel(state, selectedProject, projectOptions);

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
            <button type="button" data-role="settings-toggle" class="ghost" aria-expanded="${state.settingsOpen ? 'true' : 'false'}">
              ${state.settingsOpen ? 'Hide settings' : 'Settings'}
            </button>
            <button type="button" data-role="close" class="ghost">Close</button>
          </div>
        </header>
        ${settingsPanel}
        ${state.sessionId ? renderContinuation(state, messages) : renderCreation(state)}
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
