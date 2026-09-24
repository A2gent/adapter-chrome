const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOverlay } = require('../src/contentUi.js');

const baseState = (overrides = {}) => ({
  baseUrl: 'http://localhost:5445',
  busy: false,
  drawingEnabled: false,
  drawingTool: 'region',
  error: '',
  followup: '',
  hasDrawing: false,
  messages: [],
  projectDetection: { mode: 'default', label: 'Default project', detail: '' },
  projects: [],
  prompt: '',
  recapturing: false,
  selectedProjectId: '',
  sessionId: '',
  settingsOpen: false,
  status: 'Ready',
  ...overrides,
});

test('annotation action renders in header before settings', () => {
  const html = renderOverlay({
    state: baseState(),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  const drawIndex = html.indexOf('data-role="drawing-toggle"');
  const settingsIndex = html.indexOf('data-role="settings-toggle"');
  const composerIndex = html.indexOf('class="create-composer"');

  assert.notEqual(drawIndex, -1);
  assert.ok(drawIndex < settingsIndex, 'Draw focus should sit next to Settings in the header');
  assert.ok(settingsIndex < composerIndex, 'Header actions should render above the composer textarea');
  assert.doesNotMatch(html, /class="drawing-tools"/);
  assert.doesNotMatch(html, /data-role="drawing-tools"/);
});

test('active annotation tools render inside the movable dialog below the header', () => {
  const html = renderOverlay({
    state: baseState({ drawingEnabled: true, drawingTool: 'element' }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  const headerEnd = html.indexOf('</header>');
  const toolsIndex = html.indexOf('data-role="drawing-tools"');
  const composerIndex = html.indexOf('class="create-composer"');
  assert.ok(headerEnd > 0 && toolsIndex > headerEnd, 'Tool selection should sit below the dialog header');
  assert.ok(toolsIndex < composerIndex, 'Tool selection should stay above the composer');
  assert.match(html, /class="drawing-tools"/);
  assert.match(html, /data-tool="arrow" aria-pressed="false">Arrow<\/button>/);
  assert.match(html, /data-tool="region" aria-pressed="false">Rectangle<\/button>/);
  assert.match(html, /data-tool="element" aria-pressed="true">Element<\/button>/);
  assert.match(html, /data-role="drawing-hint"/);
});

test('drawing header reflects active drawing state and disables cancellation while busy', () => {
  const html = renderOverlay({
    state: baseState({ busy: true, drawingEnabled: true, hasDrawing: true }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /data-role="drawing-toggle"[\s\S]*class="ghost active-drawing"[\s\S]*aria-pressed="true"[\s\S]*disabled[\s\S]*>Done annotating<\/button>/);
  assert.match(html, /data-role="drawing-cancel"[\s\S]*disabled>Clear annotations<\/button>/);
});

test('settings panel renders escaped connection controls when explicitly opened', () => {
  const html = renderOverlay({
    state: baseState({
      baseUrl: 'http://localhost:5445/?x=<script>',
      settingsOpen: true,
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /<section class="settings-panel" aria-label="Adapter settings">/);
  assert.match(html, /data-role="settings-toggle"[\s\S]*aria-expanded="true"[\s\S]*Hide settings/);
  assert.match(html, /value="http:\/\/localhost:5445\/\?x=&lt;script&gt;"/);
  const settingsStart = html.indexOf('<section class="settings-panel"');
  const createStart = html.indexOf('<section class="create-panel"');
  const settingsOnly = settingsStart >= 0 && createStart > settingsStart
    ? html.slice(settingsStart, createStart)
    : html;
  assert.doesNotMatch(settingsOnly, /data-role="project"/);
  assert.doesNotMatch(html, /<script>/);
});

test('session creation form renders escaped project controls', () => {
  const html = renderOverlay({
    state: baseState({
      projectDetection: { mode: 'auto', label: 'Matched <repo>', detail: '' },
      projects: [
        { id: 'project-1', name: 'Safe project' },
        { id: 'project-<2>', name: 'Important <Project>' },
      ],
      selectedProjectId: 'project-<2>',
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /<section class="create-panel" aria-label="Create a new A2gent session">/);
  assert.match(html, /<option value="project-&lt;2&gt;" selected>Important &lt;Project&gt;<\/option>/);
  assert.match(html, /<div class="detection auto">[\s\S]*<strong>Matched &lt;repo&gt;<\/strong>[\s\S]*<span>Important &lt;Project&gt;<\/span>/);
  assert.doesNotMatch(html, /<script>|<repo>|<Project>/);
});

test('existing session view renders escaped inline messages and follow-up actions', () => {
  const html = renderOverlay({
    state: baseState({
      busy: true,
      followup: 'Use <details> next',
      messages: [
        { role: 'user', content: 'Problem: <button>broken</button>' },
        { role: 'assistant', content: 'Try "safe" & continue' },
      ],
      recapturing: true,
      sessionId: 'session-1',
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /<div class="panel has-session/);
  assert.match(html, /<section class="messages">[\s\S]*<div class="message user">[\s\S]*Problem: &lt;button&gt;broken&lt;\/button&gt;/);
  assert.match(html, /<div class="message assistant">[\s\S]*Try &quot;safe&quot; &amp; continue/);
  assert.match(html, /<textarea data-role="followup"[^>]*>Use &lt;details&gt; next<\/textarea>/);
  assert.match(html, /data-role="recapture"[\s\S]*disabled[\s\S]*Recapturing\.\.\./);
  assert.match(html, /data-role="send"[\s\S]*disabled>Send<\/button>/);
  assert.doesNotMatch(html, /<button>broken|<details>/);
});

test('existing session view treats malformed message history as empty', () => {
  const html = renderOverlay({
    state: baseState({
      messages: { role: 'user', content: 'not iterable' },
      sessionId: 'session-1',
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /No inline messages yet\. Create a session to start\./);
});

test('overlay panel is movable and gives session history more space', () => {
  const html = renderOverlay({
    state: baseState(),
    compactOverlayHeight: 176,
    compactOverlayMinHeight: 144,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /left: var\(--a2gent-overlay-left/);
  assert.match(html, /bottom: var\(--a2gent-overlay-bottom/);
  assert.match(html, /width: min\(var\(--a2gent-overlay-width/);
  assert.match(html, /header \{[\s\S]*cursor: move;/);
  assert.match(html, /\.create-composer textarea \{[\s\S]*height: 82px;[\s\S]*min-height: 82px;/);
  assert.match(html, /\.followup-row textarea \{ min-height: 72px; \}/);
  assert.match(html, /data-role="close" class="ghost icon-button" aria-label="Close" title="Close"[\s\S]*<svg class="close-icon"[\s\S]*<path d="M5 5l14 14M19 5L5 19"/);
});
