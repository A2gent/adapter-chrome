((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const exported = factory(shared || require('./shared.js'));
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_SESSION_EVENTS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared) => {
  const DIAGNOSTIC_FENCE = /```json a2gent_browser_[a-z_]+\n[\s\S]*?```/g;

  const parseSseJsonEvent = (block) => {
    const dataLines = String(block || '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return null;
    try {
      return JSON.parse(dataLines.join('\n'));
    } catch {
      return null;
    }
  };

  const parseSseJsonEvents = (chunk, buffer = '') => {
    const combined = `${buffer}${String(chunk || '')}`;
    const blocks = combined.split(/\n\n/);
    const rest = blocks.pop() || '';
    const events = [];
    for (const block of blocks) {
      const event = parseSseJsonEvent(block);
      if (event) events.push(event);
    }
    return { events, buffer: rest };
  };

  const flushSseBuffer = (buffer) => {
    const event = parseSseJsonEvent(String(buffer || '').trim());
    return event ? [event] : [];
  };

  const displayMessageContent = (message) => {
    const stripped = String(message?.content || '').replace(DIAGNOSTIC_FENCE, '').trim();
    if (stripped) return stripped;
    const tools = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .map((tool) => tool?.name)
      .filter(Boolean);
    if (tools.length > 0) return `[Tool: ${tools.join(', ')}]`;
    const results = (Array.isArray(message?.tool_results) ? message.tool_results : [])
      .map((result) => result?.content || result?.name || '')
      .filter(Boolean);
    return results.join('\n');
  };

  const normalizeVisibleMessages = (messages) => shared.normalizeMessages(
    (Array.isArray(messages) ? messages : []).map((message) => (
      message ? { ...message, content: displayMessageContent(message) } : message
    )),
  ).filter((message) => message.content);

  const appendAssistantDelta = (messages, delta, nowIso = shared.nowIso) => {
    const next = normalizeVisibleMessages(messages);
    const last = next[next.length - 1];
    if (!last || last.role !== 'assistant') {
      next.push({ role: 'assistant', content: String(delta || ''), timestamp: nowIso() });
      return next;
    }
    next[next.length - 1] = { ...last, content: `${last.content}${delta}` };
    return next;
  };

  const applySessionStreamEvent = (messages, event, nowIso = shared.nowIso) => {
    if (!event || typeof event !== 'object') {
      return { messages: normalizeVisibleMessages(messages), patch: {} };
    }
    if (event.type === 'session_snapshot' || event.type === 'done' || event.type === 'input_required') {
      const patch = {};
      if (event.status) patch.status = `Session ${event.status}`;
      if (event.type === 'done') patch.busy = false;
      return {
        messages: Array.isArray(event.messages) ? normalizeVisibleMessages(event.messages) : normalizeVisibleMessages(messages),
        patch,
      };
    }
    if (event.type === 'assistant_delta' && event.delta) {
      return { messages: appendAssistantDelta(messages, event.delta, nowIso), patch: {} };
    }
    if (event.type === 'status' && event.status) {
      return { messages: normalizeVisibleMessages(messages), patch: { status: `Session ${event.status}` } };
    }
    if (event.type === 'tool_executing') {
      const names = (event.tool_calls || []).map((tool) => tool?.name).filter(Boolean);
      return {
        messages: normalizeVisibleMessages(messages),
        patch: { status: names.length ? `Running tool: ${names.join(', ')}` : 'Running tool' },
      };
    }
    if (event.type === 'error') {
      return {
        messages: Array.isArray(event.messages) ? normalizeVisibleMessages(event.messages) : normalizeVisibleMessages(messages),
        patch: {
          error: event.error || 'Session stream failed.',
          status: 'Error',
          busy: false,
        },
      };
    }
    return { messages: normalizeVisibleMessages(messages), patch: {} };
  };

  return {
    parseSseJsonEvent,
    parseSseJsonEvents,
    flushSseBuffer,
    displayMessageContent,
    normalizeVisibleMessages,
    applySessionStreamEvent,
  };
});
