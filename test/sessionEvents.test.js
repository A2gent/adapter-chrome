const test = require('node:test');
const assert = require('node:assert/strict');

const sessionEvents = require('../src/contentScript/sessionEvents.js');

test('parseSseJsonEvents extracts JSON data blocks and keeps a partial tail', () => {
  const first = sessionEvents.parseSseJsonEvents(
    ':heartbeat\n\nevent: session_snapshot\ndata: {"type":"session_snapshot","status":"running","messages":[]}\n\nevent: assistant_delta\ndata: {"type":"assistant_delta","delta":"Hel',
  );
  assert.deepEqual(first.events, [
    { type: 'session_snapshot', status: 'running', messages: [] },
  ]);

  const second = sessionEvents.parseSseJsonEvents('lo"}\n\n', first.buffer);
  assert.deepEqual(second.events, [
    { type: 'assistant_delta', delta: 'Hello' },
  ]);
  assert.equal(second.buffer, '');
});

test('flushSseBuffer parses a complete trailing event and ignores comments', () => {
  assert.deepEqual(
    sessionEvents.flushSseBuffer('event: done\ndata: {"type":"done","status":"completed","messages":[]}\n'),
    [{ type: 'done', status: 'completed', messages: [] }],
  );
  assert.deepEqual(sessionEvents.flushSseBuffer(':heartbeat\n'), []);
  assert.deepEqual(sessionEvents.flushSseBuffer(''), []);
});

test('displayMessageContent strips adapter diagnostic fences and keeps the user prompt', () => {
  assert.equal(
    sessionEvents.displayMessageContent({
      role: 'user',
      content: 'Fix the button\n\n```json a2gent_browser_diagnostic\n{"huge":true}\n```',
    }),
    'Fix the button',
  );
  assert.equal(
    sessionEvents.displayMessageContent({
      role: 'user',
      content: 'Continue\n\n```json a2gent_browser_context\n{"url":"https://example.test"}\n```',
    }),
    'Continue',
  );
  assert.equal(
    sessionEvents.displayMessageContent({
      role: 'assistant',
      content: '',
      tool_calls: [{ name: 'read_file' }, { name: 'bash' }],
    }),
    '[Tool: read_file, bash]',
  );
});

test('applySessionStreamEvent replaces history from snapshots and streams assistant deltas', () => {
  const snapshot = sessionEvents.applySessionStreamEvent([], {
    type: 'session_snapshot',
    status: 'running',
    messages: [
      { role: 'user', content: 'Look at this\n\n```json a2gent_browser_diagnostic\n{"x":1}\n```', timestamp: '2026-09-25T00:00:00.000Z' },
    ],
  });
  assert.equal(snapshot.messages[0].content, 'Look at this');
  assert.deepEqual(snapshot.patch, { status: 'Session running' });

  const delta = sessionEvents.applySessionStreamEvent(snapshot.messages, {
    type: 'assistant_delta',
    delta: 'I see the issue',
  }, () => '2026-09-25T00:01:00.000Z');
  assert.equal(delta.messages[1].role, 'assistant');
  assert.equal(delta.messages[1].content, 'I see the issue');

  const more = sessionEvents.applySessionStreamEvent(delta.messages, {
    type: 'assistant_delta',
    delta: ' now.',
  });
  assert.equal(more.messages[1].content, 'I see the issue now.');

  const done = sessionEvents.applySessionStreamEvent(more.messages, {
    type: 'done',
    status: 'completed',
    messages: [
      { role: 'user', content: 'Look at this', timestamp: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', content: 'I see the issue now.', timestamp: '2026-09-25T00:01:00.000Z' },
    ],
  });
  assert.equal(done.messages.length, 2);
  assert.deepEqual(done.patch, { status: 'Session completed', busy: false });
});

test('applySessionStreamEvent surfaces tool status and stream errors without duplicating history', () => {
  const tools = sessionEvents.applySessionStreamEvent([], {
    type: 'tool_executing',
    tool_calls: [{ name: 'screenshot' }],
  });
  assert.deepEqual(tools.messages, []);
  assert.equal(tools.patch.status, 'Running tool: screenshot');

  const failed = sessionEvents.applySessionStreamEvent(
    [{ role: 'user', content: 'Hi', timestamp: '2026-09-25T00:00:00.000Z' }],
    { type: 'error', error: 'provider timeout', status: 'failed' },
  );
  assert.equal(failed.messages[0].content, 'Hi');
  assert.deepEqual(failed.patch, {
    error: 'provider timeout',
    status: 'Error',
    busy: false,
  });
});
