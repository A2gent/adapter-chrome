(() => {
  const renderMarkdown = globalThis.__A2GENT_CHAT_ASSIST_MARKDOWN__;
  if (!renderMarkdown || globalThis.__A2GENT_SUMMARIZE_PANEL__) return;
  globalThis.__A2GENT_SUMMARIZE_PANEL__ = true;

  const MESSAGE_TYPE = 'A2GENT_SUMMARIZE_SELECTION';
  const AGENT_KEY = 'a2gent.adapterChrome.chatAgent';
  const DEFAULT_AGENT = { id: 'biz-aristotle', name: 'Аристотель' };
  const POLL_MS = 2000;
  const REPLY_TIMEOUT_MS = 5 * 60 * 1000;
  const WAITING_FOR_USER = ['input_required', 'paused', 'waiting_external'];
  const INSTRUCTION = 'Summarize the following text concisely, in the same language as the text. Reply with the summary only.';
  const LOGO_URL = chrome.runtime.getURL('icons/a2gent-32.png');
  const STYLE = `:host{all:initial}
*{box-sizing:border-box;font-family:inherit}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(380px,100vw);z-index:2147483647;display:flex;flex-direction:column;background:#fff;color:#1c2333;border-left:1px solid #c9d1dc;box-shadow:-4px 0 16px #0002;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #e3e8ef}.logo{width:16px;height:16px;border-radius:3px}.title{flex:1;font-weight:600}
button{cursor:pointer;border:0;border-radius:5px;background:#eef1f6;min-width:26px;height:24px;font-size:15px;color:inherit}button:hover{background:#dfe5ee}
.out{flex:1;overflow:auto;padding:10px;overflow-wrap:anywhere;user-select:text}.out.err{color:#b42318}.out.busy{display:flex;align-items:center;justify-content:center;color:#525c6b}
.spinner{width:22px;height:22px;border:3px solid #dfe5ee;border-top-color:#1a5fb4;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
a{color:#1a5fb4;text-decoration:none}
.md p,.md ul,.md ol,.md pre,.md blockquote,.md table{margin:0 0 6px}.md>:last-child{margin-bottom:0}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{margin:8px 0 4px;font-size:13px;line-height:1.3;font-weight:600}.md ul,.md ol{padding-left:20px}
.md code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:0 3px;background:#0000000f;border-radius:3px}
.md pre{padding:6px 8px;overflow-x:auto;background:#0000000a;border-radius:5px}.md pre code{padding:0;background:none}
.md blockquote{padding-left:8px;border-left:3px solid #c9d1dc;color:#525c6b}`;

  let current = null;

  const api = async (path, options = {}) => {
    const proxied = await chrome.runtime.sendMessage({ type: 'A2GENT_BRUTE_API_FETCH', path, options });
    if (!proxied?.ok) throw new Error(proxied?.error || 'Brute request failed.');
    const { response } = proxied;
    if (!response?.ok) throw new Error(response?.body?.error || response?.bodyText || `HTTP ${response?.status}`);
    return response.body;
  };
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  const resolveAgent = async () => {
    const saved = (await chrome.storage.local.get(AGENT_KEY))[AGENT_KEY];
    try {
      const body = await api('/unified-agents/');
      const list = (Array.isArray(body?.agents) ? body.agents : []).filter((agent) => agent.id && agent.name);
      return list.find((agent) => agent.id === saved) || list.find((agent) => agent.id === DEFAULT_AGENT.id) || list[0] || DEFAULT_AGENT;
    } catch {
      return { id: saved || DEFAULT_AGENT.id, name: saved || DEFAULT_AGENT.name };
    }
  };

  const waitForReply = async (sessionId, isCancelled) => {
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (Date.now() < deadline && !isCancelled()) {
      const session = await api(`/sessions/${encodeURIComponent(sessionId)}`);
      if (session?.status === 'failed') throw new Error('The agent run failed.');
      if (WAITING_FOR_USER.includes(session?.status)) throw new Error('The agent is waiting for input.');
      const replies = (session?.messages || []).filter((message) => message.role === 'assistant' && message.content?.trim());
      if (session?.status === 'completed' && replies.length) return replies[replies.length - 1].content.trim();
      await sleep(POLL_MS);
    }
    if (isCancelled()) return '';
    throw new Error('The agent is taking too long.');
  };

  const summarize = async (text, isCancelled) => {
    const agent = await resolveAgent();
    const session = await post('/sessions', {
      agent_id: 'build',
      unified_agent_id: agent.id,
      queued: true,
      queue_mode: 'serial',
      task: `${INSTRUCTION}\n\n${text}`,
      metadata: {
        source: 'summarize_selection',
        launch_target: 'agent',
        launch_agent_id: agent.id,
        launch_agent_name: agent.name,
        skip_telegram_sync: true,
      },
    });
    await post(`/sessions/${encodeURIComponent(session.id)}/start`, {}).catch(() => {});
    return waitForReply(session.id, isCancelled);
  };

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const close = () => {
    if (!current) return;
    current.closed = true;
    document.removeEventListener('keydown', current.onKey, true);
    current.host.remove();
    current = null;
  };

  const open = () => {
    close();
    const host = document.createElement('div');
    host.setAttribute('data-a2gent-summarize', '');
    const shadow = host.attachShadow({ mode: 'closed' });
    const out = el('div', { className: 'out busy' }, el('div', { className: 'spinner', role: 'status', title: 'Summarizing' }));
    const bar = el('div', { className: 'bar' }, el('img', { className: 'logo', src: LOGO_URL, alt: 'A2gent' }),
      el('span', { className: 'title', textContent: 'Summary' }), el('button', { className: 'close', textContent: '×', title: 'Close', onclick: close }));
    shadow.append(el('style', { textContent: STYLE }), el('div', { className: 'panel' }, bar, out));
    const state = { host, closed: false, onKey: (event) => { if (event.key === 'Escape') close(); } };
    document.addEventListener('keydown', state.onKey, true);
    document.documentElement.append(host);
    current = state;
    return { state, out };
  };

  const show = (out, className, ...children) => {
    out.className = `out ${className}`;
    out.replaceChildren(...children);
  };

  const start = async (rawText) => {
    const { state, out } = open();
    const text = String(rawText || '').trim();
    if (!text) return show(out, 'err', 'No text selected.');
    try {
      const summary = await summarize(text, () => state.closed);
      if (state.closed) return;
      show(out, 'md', summary ? renderMarkdown(summary) : 'Empty reply.');
    } catch (error) {
      if (!state.closed) show(out, 'err', error.message);
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPE) start(message.text);
    return false;
  });
})();
