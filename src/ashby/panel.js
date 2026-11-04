(() => {
  const renderMarkdown = globalThis.__A2GENT_CHAT_ASSIST_MARKDOWN__;
  if (!renderMarkdown || globalThis.__A2GENT_ASHBY_PANEL__) return;
  globalThis.__A2GENT_ASHBY_PANEL__ = true;

  const AGENT_NAME = 'Veronika (HR)';
  const SESSION_URL = 'https://my.a2gent.net/#/chat/';
  const POLL_MS = 2000;
  const REPLY_TIMEOUT_MS = 10 * 60 * 1000;
  const WAITING_FOR_USER = ['input_required', 'paused', 'waiting_external'];
  const FINISHED = ['completed', 'failed', 'paused'];
  const ALIVE_AFTER_START_ERROR = ['queued', 'running', 'completed'];
  const STYLE = `:host{all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;width:300px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333}
*{box-sizing:border-box;font-family:inherit}.box{background:#fff;border:1px solid #c9d1dc;border-radius:10px;box-shadow:0 4px 16px #0003;overflow:hidden}
.head{display:flex;gap:8px;align-items:center;padding:6px 8px;background:#eef1f6;font-weight:600}.head a{margin-left:auto;color:#1a5fb4;text-decoration:none}
.avatar{flex:none;width:28px;height:28px;border-radius:50%;background:#7c4dff;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
.body{display:flex;flex-direction:column;gap:6px;padding:8px}textarea{width:100%;min-height:60px;resize:vertical;padding:6px;border:1px solid #c9d1dc;border-radius:6px;font-size:13px}
button{align-self:flex-end;cursor:pointer;border:0;border-radius:6px;background:#1a73e8;color:#fff;padding:5px 14px;font-size:13px}button:disabled{opacity:.5;cursor:wait}
.out{max-height:40vh;overflow:auto;padding:6px 8px;background:#f6f8fb;border-radius:6px;overflow-wrap:anywhere;user-select:text}.out.err{color:#b42318}.out:empty{display:none}
.md p,.md ul,.md ol,.md pre{margin:0 0 6px}.md>:last-child{margin-bottom:0}.md ul,.md ol{padding-left:20px}`;

  const api = async (path, options = {}) => {
    const proxied = await chrome.runtime.sendMessage({ type: 'A2GENT_BRUTE_API_FETCH', path, options });
    if (!proxied?.ok) throw new Error(proxied?.error || 'Brute request failed.');
    const { response } = proxied;
    if (!response?.ok) throw Object.assign(new Error(response?.body?.error || response?.bodyText || `HTTP ${response?.status}`), { status: response?.status });
    return response.body;
  };
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const assistantReplies = (session) => (session?.messages || []).filter((message) => message.role === 'assistant' && message.content?.trim());

  const findAgent = async () => {
    const body = await api('/unified-agents/');
    const agent = (Array.isArray(body?.agents) ? body.agents : []).find((candidate) => candidate.id && candidate.name === AGENT_NAME);
    if (!agent) throw new Error('HR agent Veronika not found');
    return agent;
  };

  const buildTask = (text) => `${text}\n\nPage: ${location.href}`;

  const startSession = async (task) => {
    const agent = await findAgent();
    const session = await post('/sessions', {
      agent_id: 'build',
      unified_agent_id: agent.id,
      queued: true,
      queue_mode: 'serial',
      task,
      metadata: {
        source: 'ashby',
        launch_target: 'agent',
        launch_agent_id: agent.id,
        launch_agent_name: agent.name,
        skip_telegram_sync: true,
      },
    });
    Object.assign(state, { sessionId: session.id, known: 0, awaiting: true });
    await post(`/sessions/${encodeURIComponent(session.id)}/start`, {}).catch(async (err) => {
      if (err.status === 409) return;
      const current = await api(`/sessions/${encodeURIComponent(session.id)}`).catch(() => null);
      if (!ALIVE_AFTER_START_ERROR.includes(current?.status)) throw err;
    });
  };

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

  const state = { awaiting: false, busy: false, error: '', known: 0, reply: '', status: '', sessionId: '', text: 'Autofill' };
  const host = document.createElement('div');
  host.setAttribute('data-a2gent-ashby', '');
  for (const type of ['click', 'mousedown', 'keydown', 'keyup']) host.addEventListener(type, (event) => event.stopPropagation());
  const shadow = host.attachShadow({ mode: 'closed' });

  const submit = async () => {
    if (state.busy || !state.text.trim()) return;
    Object.assign(state, { busy: true, error: '', reply: '', status: 'Sending…' });
    render();
    try {
      const session = state.sessionId ? await api(`/sessions/${encodeURIComponent(state.sessionId)}`) : null;
      const reusable = session?.status === 'completed';
      const unseenReply = reusable && state.awaiting && assistantReplies(session).length > state.known;
      const resume = Boolean(session) && (!FINISHED.includes(session.status) || unseenReply);
      if (!resume) {
        const task = buildTask(state.text.trim());
        if (reusable) {
          await post(`/sessions/${encodeURIComponent(state.sessionId)}/queue`, { message: task });
          Object.assign(state, { known: assistantReplies(session).length, awaiting: true });
        } else await startSession(task);
      }
      state.status = resume ? 'Still working on the previous request…' : 'Working…';
      render();
      const replies = await waitForReplies(state.sessionId, state.known);
      Object.assign(state, { awaiting: false, reply: replies[replies.length - 1].content.trim(), status: 'Done' });
    } catch (err) {
      state.error = err.message;
      state.status = '';
    }
    state.busy = false;
    render();
  };

  const render = () => {
    const textarea = el('textarea', { value: state.text, disabled: state.busy, oninput: () => { state.text = textarea.value; } });
    const button = el('button', { textContent: 'Submit', disabled: state.busy, onclick: submit });
    shadow.replaceChildren(el('style', { textContent: STYLE }), el('div', { className: 'box' },
      el('div', { className: 'head' }, el('div', { className: 'avatar', textContent: 'V', title: AGENT_NAME }), el('span', { textContent: AGENT_NAME }),
        state.sessionId ? el('a', { href: `${SESSION_URL}${encodeURIComponent(state.sessionId)}`, target: '_blank', rel: 'noopener', textContent: '↗', title: 'Open the session' }) : null),
      el('div', { className: 'body' }, textarea, button,
        state.status ? el('span', { className: 'status', textContent: state.status }) : null,
        state.error ? el('div', { className: 'out err', textContent: state.error }) : el('div', { className: 'out md' }, renderMarkdown(state.reply)))));
  };

  render();
  document.documentElement.append(host);
})();
