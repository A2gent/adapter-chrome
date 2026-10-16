import { createHighlighter } from './highlight.js';

export const RATES = [0.7, 1, 1.2, 1.5, 2];
export const formatRate = rate => `${String(rate).replace(/\.0$/, '')}x`;

export function mountPlayer(article, send) {
  const doc = article.root.ownerDocument;
  const ru = article.language === 'ru';
  const highlighter = createHighlighter(article);
  const host = doc.createElement('div'); host.dataset.chromeSound = '';
  const shadow = host.attachShadow({mode:'closed'});
  const style = doc.createElement('style');
  style.textContent = `:host{position:fixed!important;left:50%!important;bottom:16px!important;transform:translateX(-50%)!important;display:block!important;margin:0!important;width:auto!important;max-width:min(720px,calc(100vw - 32px))!important;z-index:2147483647!important;color-scheme:light}:host([hidden]){display:none!important}*{box-sizing:border-box}.player{font:13px/1.2 system-ui,sans-serif;background:#fff;color:#1c2333;border:1px solid #0000000f;border-radius:40px;padding:8px 20px;box-shadow:0 10px 32px #0004,0 1px 3px #0002}.row{display:flex;align-items:center;justify-content:center;gap:14px}.icon{cursor:pointer;border:0;border-radius:50%;background:#eef1f6;color:#1c2333;padding:0;width:36px;height:36px;min-width:36px;display:grid;place-items:center;flex:0 0 auto;font:700 12px/1 system-ui,sans-serif;transition:background .15s,transform .15s}.icon:hover{background:#dfe5ee}.icon:active{transform:scale(.94)}.play{width:56px;height:56px;min-width:56px;background:#182337;color:#fff;box-shadow:0 4px 14px #18233766}.play:hover{background:#263a58}.speed{width:auto;min-width:44px;padding:0 12px;border-radius:18px;font-variant-numeric:tabular-nums}.icon:focus-visible{outline:3px solid #ffda69;outline-offset:2px}.icon:disabled{opacity:.65;cursor:wait}.status{margin-top:6px;text-align:center;overflow-wrap:anywhere}.status:empty{display:none}.spinner{display:inline-block;width:18px;height:18px;border:3px solid #7d8ea8;border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}.icon{transition:none}}`;
  const box = doc.createElement('section'); box.className = 'player'; box.setAttribute('aria-label', ru ? 'Озвучивание статьи' : 'Article audio');
  const row = doc.createElement('div'); row.className = 'row';
  const restart = doc.createElement('button'); restart.type = 'button'; restart.className = 'icon';
  restart.setAttribute('aria-label', ru ? 'Сначала фрагмент' : 'Restart chunk'); restart.title = restart.getAttribute('aria-label');
  restart.append(icon('M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z'));
  const play = doc.createElement('button'); play.type = 'button'; play.className = 'icon play';
  const speed = doc.createElement('button'); speed.type = 'button'; speed.className = 'icon speed';
  speed.title = ru ? 'Скорость воспроизведения' : 'Playback speed';
  const status = doc.createElement('div'); status.className = 'status'; status.setAttribute('role','status');
  row.append(restart, play, speed); box.append(row, status); shadow.append(style, box);
  (doc.body || doc.documentElement).append(host);
  let state = {phase:'idle'}; let busy = false; let disposed = false; let requestRevision = 0; let rate = 1; let visible = true;
  function setVisibility(next) {
    visible = Boolean(next);
    host.hidden = !visible;
    host.setAttribute('aria-hidden', String(!visible));
    return visible;
  }
  function icon(d) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('fill', 'currentColor'); path.setAttribute('d', d); svg.append(path);
    return svg;
  }
  function render(next) {
    if (disposed || !next) return;
    state = next;
    highlighter.update(state);
    if (RATES.includes(state.rate)) rate = state.rate;
    const loading = state.phase === 'loading';
    const active = ['playing','paused'].includes(state.phase);
    play.replaceChildren();
    if (loading) { const spinner = doc.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden','true'); play.append(spinner); }
    else play.append(icon(state.phase === 'playing' ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z'));
    // WHY: after start, audio can already be playing while the button still shows the loader.
    // WHAT: keep the control clickable and treat that click as pause, not a second play.
    const pausing = loading || state.phase === 'playing';
    const label = pausing ? (ru ? 'Пауза' : 'Pause') : (ru ? 'Слушать' : 'Play');
    play.setAttribute('aria-label', label); play.disabled = false; box.setAttribute('aria-busy', String(loading));
    restart.disabled = !active;
    speed.textContent = formatRate(rate);
    speed.setAttribute('aria-label', `${ru ? 'Скорость' : 'Speed'} ${formatRate(rate)}`);
    status.textContent = state.error || '';
  }
  async function request(action, extra = {}) {
    const revision = action === 'status' ? requestRevision : ++requestRevision;
    let timer;
    try {
      // A lost reply (worker restart) must not leave the controls stuck as busy.
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); });
      const next = await Promise.race([send({action, ...extra}), timeout]);
      // A status request started before a user command must not restore stale UI.
      if (revision === requestRevision) render(next);
    }
    catch {
      if (revision === requestRevision) render({phase:'error', error:ru ? 'Brute недоступен или расширение перезагружено. Проверьте настройки в меню расширения и обновите страницу.' : 'Brute unavailable or extension reloaded. Open the toolbar popup to check settings, then reload this page.'});
    }
    finally { clearTimeout(timer); }
  }
  async function guarded(event, run) {
    if (!event.isTrusted || busy) return;
    busy = true;
    try { await run(); } finally { busy = false; }
  }
  play.addEventListener('click', event => guarded(event, async () => {
    if (['idle','error'].includes(state.phase)) {
      render({phase:'loading'});
      await request('start', {text:article.text, language:article.language});
    } else if (state.phase === 'playing' || state.phase === 'loading') {
      // Explicit play/pause (not toggle) so a stale UI phase cannot invert the user's intent.
      // Reflect pause immediately while the command crosses two extension contexts.
      render({...state, phase:'paused'});
      await request('pause');
    } else await request('play');
  }));
  restart.addEventListener('click', event => guarded(event, () => request('restart')));
  speed.addEventListener('click', event => guarded(event, () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    speed.textContent = formatRate(rate);
    return request('rate', {value:rate});
  }));
  render(state);
  let polling = false;
  const timer = setInterval(async () => {
    if (disposed || polling || busy || state.phase === 'idle' || state.phase === 'error') return;
    polling = true;
    try { await request('status'); } finally { polling = false; }
  }, 100);
  return {host, isVisible:() => visible, toggleVisibility:() => setVisibility(!visible), setVisibility, destroy() { disposed = true; clearInterval(timer); highlighter.destroy(); host.remove(); void send({action:'stop'}).catch(() => {}); }};
}
