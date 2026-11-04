// Google Chat assistant: a toolbar above each composer that sends the visible conversation, or the
// draft typed in the composer, to a Brute agent and shows the reply. It never writes to the composer
// and never sends anything to Chat; nothing leaves the page until the user clicks a button.
(() => {
  const googleChat = globalThis.__A2GENT_CHAT_ASSIST_GOOGLE_CHAT__;
  if (!googleChat || globalThis.__A2GENT_CHAT_ASSIST_PANEL__) return;
  globalThis.__A2GENT_CHAT_ASSIST_PANEL__ = true;

  const AGENT_KEY = 'a2gent.adapterChrome.chatAgent';
  const DEFAULT_AGENT = { id: 'biz-aristotle', name: 'Аристотель' };
  const SESSION_URL = 'https://my.a2gent.net/chat/';
  const POLL_MS = 2000;
  const REPLY_TIMEOUT_MS = 10 * 60 * 1000;
  const SCAN_DELAY_MS = 800;
  const WAITING_FOR_USER = ['input_required', 'paused', 'waiting_external'];
  const CONVERSATION_KEY_LENGTH = 200;
  const HOST_ATTR = 'data-a2gent-chat-assist';
  const STYLE = `:host{all:initial;display:block;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333}
*{box-sizing:border-box;font-family:inherit}.bar{display:flex;gap:4px;align-items:center;padding:2px 8px}
select{font-size:12px;max-width:150px;padding:2px 4px;border:1px solid #c9d1dc;border-radius:5px;background:#fff;color:inherit}
button{cursor:pointer;border:0;border-radius:5px;background:#eef1f6;min-width:26px;height:24px;font-size:13px}button:hover{background:#dfe5ee}button:disabled{opacity:.5;cursor:wait}
a{margin-left:auto;font-size:12px;color:#1a5fb4;text-decoration:none}.out{margin:2px 8px 4px;padding:6px 8px;max-height:40vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;background:#f6f8fb;border:1px solid #0001;border-radius:8px}
.out.err{color:#b42318}.out:empty{display:none}`;

  const widgets = new Map();
  let agents = [DEFAULT_AGENT];
  let agentId = DEFAULT_AGENT.id;
  let scanTimer;

  const api = async (path, options = {}) => {
    const proxied = await chrome.runtime.sendMessage({ type: 'A2GENT_BRUTE_API_FETCH', path, options });
    if (!proxied?.ok) throw new Error(proxied?.error || 'Brute request failed.');
    const { response } = proxied;
    if (!response?.ok) throw new Error(response?.body?.error || response?.bodyText || `HTTP ${response?.status}`);
    return response.body;
  };
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  const startSession = async (task) => {
    const agent = agents.find((candidate) => candidate.id === agentId) || DEFAULT_AGENT;
    const session = await post('/sessions', {
      agent_id: 'build',
      unified_agent_id: agent.id,
      queued: true,
      queue_mode: 'serial',
      task,
      metadata: {
        source: 'google_chat',
        launch_target: 'agent',
        launch_agent_id: agent.id,
        launch_agent_name: agent.name,
        // Work conversations must stay local instead of being mirrored into a Telegram topic.
        skip_telegram_sync: true,
      },
    });
    // Start skips the project-wide serial queue. It only fails when the queue already picked the session up.
    await post(`/sessions/${encodeURIComponent(session.id)}/start`, {}).catch(() => {});
    return session.id;
  };

  const assistantReplies = (session) => (session?.messages || []).filter((message) => message.role === 'assistant' && message.content?.trim());

  // Short polls instead of one long request: MV3 service workers do not outlive a slow agent run.
  const waitForReplies = async (sessionId, known) => {
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const session = await api(`/sessions/${encodeURIComponent(sessionId)}`);
      const replies = assistantReplies(session);
      if (session?.status === 'failed') throw new Error('The agent run failed. Open the session for details.');
      if (WAITING_FOR_USER.includes(session?.status)) throw new Error('The agent is waiting for input. Open the session to continue.');
      if (session?.status === 'completed' && replies.length > known) return replies;
      await sleep(POLL_MS);
    }
    throw new Error('The agent is taking too long. Open the session to follow it.');
  };

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((child) => child != null));
    return node;
  };

  const render = (widget) => {
    const { busy, error, reply, sessionId } = widget;
    const select = el('select', { title: 'Agent', disabled: busy, onchange: () => {
      agentId = select.value;
      chrome.storage.local.set({ [AGENT_KEY]: agentId });
      for (const other of widgets.values()) render(other);
    } }, ...agents.map((agent) => el('option', { value: agent.id, textContent: agent.name, selected: agent.id === agentId })));
    const button = (textContent, title, onclick) => el('button', { textContent, title, disabled: busy, onclick });
    const bar = el('div', { className: 'bar' }, select,
      button('🔎', 'Analyze this conversation', () => analyze(widget)),
      button('📝', 'Review the draft typed in the reply box', () => reviewDraft(widget)),
      busy ? el('span', { textContent: '…' }) : null,
      reply || error ? button('×', 'Hide the result', () => { widget.reply = ''; widget.error = ''; render(widget); }) : null,
      sessionId ? el('a', { href: `${SESSION_URL}${encodeURIComponent(sessionId)}`, target: '_blank', rel: 'noopener', textContent: '↗', title: 'Open the session' }) : null);
    widget.shadow.replaceChildren(el('style', { textContent: STYLE }), bar,
      el('div', { className: error ? 'out err' : 'out', textContent: error || reply }));
  };

  const ask = async (widget, buildPrompt) => {
    if (widget.busy) return;
    Object.assign(widget, { busy: true, error: '', reply: '' });
    render(widget);
    try {
      // Messages may have loaded after the toolbar appeared, so resolve the pane at click time.
      Object.assign(widget, googleChat.conversationFor(widget.textbox));
      const transcript = googleChat.transcriptText(googleChat.parseMessages(widget.pane));
      if (!transcript) throw new Error('No messages found in this conversation.');
      // Chat can reuse one composer for another conversation; a session must not mix conversations or agents.
      const key = `${agentId}|${transcript.slice(0, CONVERSATION_KEY_LENGTH)}`;
      if (widget.key !== key) Object.assign(widget, { key, sessionId: '', transcript: '' });
      // Brute only delivers queued messages to completed sessions; anything else needs a fresh session.
      const session = widget.sessionId ? await api(`/sessions/${encodeURIComponent(widget.sessionId)}`) : null;
      const reusable = session?.status === 'completed';
      const known = reusable ? assistantReplies(session).length : 0;
      const prompt = buildPrompt(transcript, reusable ? widget.transcript : '');
      if (reusable) await post(`/sessions/${encodeURIComponent(widget.sessionId)}/queue`, { message: prompt });
      else widget.sessionId = await startSession(prompt);
      widget.transcript = transcript;
      render(widget);
      const replies = await waitForReplies(widget.sessionId, known);
      widget.reply = replies[replies.length - 1].content.trim();
    } catch (err) {
      widget.error = err.message;
    }
    widget.busy = false;
    render(widget);
  };

  const analyze = (widget) => ask(widget, (transcript) => googleChat.analysisPrompt(transcript));

  const reviewDraft = (widget) => {
    const draft = googleChat.visibleText(widget.textbox);
    if (!draft) {
      widget.error = 'Type a draft in the reply box first.';
      render(widget);
      return;
    }
    // The session already knows the conversation unless new messages arrived since the last request.
    ask(widget, (transcript, known) => googleChat.draftPrompt(draft, transcript === known ? '' : transcript));
  };

  const scan = () => {
    scanTimer = null;
    const visible = new Set(googleChat.composers(document));
    // A hidden composer keeps its widget: Chat hides panes while navigating and the reply must survive.
    for (const [textbox, widget] of widgets) {
      if (textbox.isConnected) continue;
      widget.host.remove();
      widgets.delete(textbox);
    }
    for (const textbox of visible) {
      if (widgets.has(textbox)) continue;
      const conversation = googleChat.conversationFor(textbox);
      if (!conversation) continue;
      const host = document.createElement('div');
      host.setAttribute(HOST_ATTR, '');
      // Chat has global keyboard shortcuts; keep our controls away from them.
      for (const type of ['click', 'mousedown', 'keydown', 'keyup']) host.addEventListener(type, (event) => event.stopPropagation());
      const widget = { host, shadow: host.attachShadow({ mode: 'closed' }), textbox, ...conversation, key: '', sessionId: '', transcript: '', busy: false, error: '', reply: '' };
      widgets.set(textbox, widget);
      render(widget);
    }
    for (const [textbox, widget] of widgets) {
      widget.host.hidden = !visible.has(textbox);
      if (!widget.composer.isConnected) Object.assign(widget, googleChat.conversationFor(textbox));
      if (!widget.host.isConnected) widget.composer.before(widget.host);
    }
  };

  const loadAgents = async () => {
    const saved = (await chrome.storage.local.get(AGENT_KEY))[AGENT_KEY];
    try {
      const body = await api('/unified-agents/');
      const list = (Array.isArray(body?.agents) ? body.agents : []).filter((agent) => agent.id && agent.name);
      if (list.length) agents = list;
    } catch {
      // Brute may be down right now; the first click reports it with a real error.
    }
    agentId = [saved, DEFAULT_AGENT.id].find((id) => agents.some((agent) => agent.id === id)) || agents[0].id;
    for (const widget of widgets.values()) render(widget);
  };

  loadAgents();
  scan();
  // Chat is a SPA that rebuilds panes while navigating, so composers come and go.
  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(scan, SCAN_DELAY_MS);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
