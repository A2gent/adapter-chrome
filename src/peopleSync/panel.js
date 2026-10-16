// Sync mode panel on LinkedIn: links profiles to Brute person cards (socials.linkedin) and
// pushes scraped details into the card via PUT /projects/{id}/people/linkedin-sync.
(() => {
  const linkedin = globalThis.__A2GENT_PEOPLE_SYNC_LINKEDIN__;
  const shared = globalThis.__A2GENT_CONTENT_SCRIPT_SHARED__;
  if (!linkedin || !shared || globalThis.__A2GENT_PEOPLE_SYNC_PANEL__) return;
  globalThis.__A2GENT_PEOPLE_SYNC_PANEL__ = true;

  const MODE_KEY = 'a2gent.adapterChrome.mode';
  const PROJECT_KEY = 'a2gent.adapterChrome.peopleProject';
  const STYLE = `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;font:12px/1.3 system-ui,sans-serif;color:#1c2333}
*{box-sizing:border-box}.box{width:340px;max-height:60vh;display:flex;flex-direction:column;background:#fff;border:1px solid #0001;border-radius:10px;box-shadow:0 8px 28px #0003}
.head{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #0001}.logo{font-weight:700;color:#0a66c2}
select,input{font:inherit;min-width:0;padding:3px 5px;border:1px solid #c9d1dc;border-radius:5px;background:#fff}.head select{flex:1}
.rows{overflow:auto}.row{display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid #0000000a}
.who{flex:1;min-width:0}.who b,.who small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.who small{color:#667}
.row input{width:120px}button{cursor:pointer;border:0;border-radius:5px;background:#eef1f6;min-width:26px;height:24px;font:inherit}
button:hover{background:#dfe5ee}button:disabled{opacity:.5;cursor:wait}.ok{color:#127a3a;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.err{color:#b42318;padding:5px 8px}.err:empty{display:none}`;

  let host; let shadow; let visible = true; let enabled = false;
  let projects = []; let projectId = ''; let people = []; let profiles = []; let kind = '';
  let error = ''; let busy = ''; let href = ''; let signature = ''; let scanTimer;

  const api = async (path, options = {}) => {
    const proxied = await shared.sendRuntimeMessage({ type: 'A2GENT_BRUTE_API_FETCH', path, options });
    if (!proxied?.ok) throw new Error(proxied?.error || 'Brute request failed.');
    const response = proxied.response;
    if (!response?.ok) throw new Error(response?.body?.error || response?.bodyText || `HTTP ${response?.status}`);
    return response.body;
  };
  const projectPath = (suffix) => `/projects/${encodeURIComponent(projectId)}${suffix}`;

  const loadPeople = async () => {
    people = [];
    if (projectId) people = (await api(projectPath('/people')))?.people || [];
  };

  const loadProjects = async () => {
    try {
      projects = ((await api('/projects')) || []).filter((project) => project.folder);
      const saved = await shared.storageGet(PROJECT_KEY);
      const fallback = await shared.storageGet(shared.STORAGE_SELECTED_PROJECT_KEY);
      projectId = [saved, fallback].find((id) => projects.some((project) => project.id === id)) || projects[0]?.id || '';
      await loadPeople();
      error = '';
    } catch (err) {
      error = err.message;
    }
    render();
  };

  const scan = () => {
    scanTimer = null;
    href = location.href;
    kind = linkedin.pageKind(location.pathname);
    profiles = kind === 'profile' ? [linkedin.parseProfile(document, location.href)]
      : kind === 'list' ? linkedin.parseList(document) : [];
    profiles = profiles.filter((profile) => profile.slug && profile.name);
    // Re-render only when the visible profile set changes so typing in inputs is not interrupted.
    const next = profiles.map((profile) => `${profile.slug}:${profile.name}`).join('|');
    if (next !== signature) {
      signature = next;
      render();
    }
  };

  const sync = async (rowProfile, input) => {
    // Profile sections load lazily, so re-parse at click time instead of using the render-time snapshot.
    const profile = kind === 'profile' ? linkedin.parseProfile(document, location.href) : rowProfile;
    busy = profile.slug;
    render();
    try {
      let person = linkedin.linkedPeople(people).get(profile.slug);
      if (!person) {
        const typed = input.trim() || profile.name;
        person = linkedin.suggestPerson(people, typed);
        if (!person) {
          person = await api(projectPath('/people'), {
            method: 'POST',
            body: JSON.stringify({ name: typed, importance: 5, status: 'active', socials: { linkedin: profile.url } }),
          });
        }
      }
      await api(projectPath('/people/linkedin-sync'), { method: 'PUT', body: JSON.stringify({ path: person.path, profile }) });
      await loadPeople();
      error = '';
    } catch (err) {
      error = err.message;
    }
    busy = '';
    render();
  };

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((child) => child != null));
    return node;
  };

  const renderRow = (profile, linked, listId) => {
    const person = linked.get(profile.slug);
    const who = el('div', { className: 'who', title: profile.url }, el('b', { textContent: profile.name }), el('small', { textContent: profile.headline }));
    if (person) {
      // List rows carry only name/headline; refreshing from them would wipe the richer profile-page sync.
      const refresh = kind === 'profile'
        ? el('button', { textContent: '↻', title: 'Sync profile into card', disabled: busy === profile.slug || !projectId, onclick: () => sync(profile, '') })
        : null;
      return el('div', { className: 'row' }, who, el('span', { className: 'ok', textContent: `✓ ${person.name}`, title: person.path }), refresh);
    }
    const suggested = linkedin.suggestPerson(people, profile.name);
    const input = el('input', { placeholder: profile.name, value: suggested?.name || '', title: 'Existing person or new card name' });
    input.setAttribute('list', listId);
    const button = el('button', { disabled: busy === profile.slug || !projectId, onclick: () => sync(profile, input.value) });
    const updateButton = () => {
      const match = linkedin.suggestPerson(people, input.value.trim() || profile.name);
      button.textContent = match ? '🔗' : '+';
      button.title = match ? `Link to ${match.name} and sync` : 'Create person card and sync';
    };
    input.addEventListener('input', updateButton);
    // Keep LinkedIn keyboard shortcuts away from the input.
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') button.click();
    });
    updateButton();
    return el('div', { className: 'row' }, who, input, button);
  };

  const render = () => {
    if (!enabled || !kind) {
      host?.remove();
      return;
    }
    if (!host) {
      host = document.createElement('div');
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = !visible;
    const select = el('select', { title: 'People project', onchange: async () => {
      projectId = select.value;
      await shared.storageSet(PROJECT_KEY, projectId);
      try { await loadPeople(); error = ''; } catch (err) { error = err.message; }
      render();
    } }, ...projects.map((project) => el('option', { value: project.id, textContent: project.name, selected: project.id === projectId })));
    const linked = linkedin.linkedPeople(people);
    const listId = 'a2gent-people-names';
    const names = el('datalist', { id: listId }, ...people.map((person) => el('option', { value: person.name })));
    const rows = el('div', { className: 'rows' }, ...profiles.map((profile) => renderRow(profile, linked, listId)));
    const head = el('div', { className: 'head' }, el('span', { className: 'logo', textContent: 'in→' }), select,
      el('button', { textContent: '⟳', title: 'Reload people', onclick: () => loadProjects() }),
      el('button', { textContent: '×', title: 'Hide (toolbar icon shows it again)', onclick: () => { visible = false; render(); } }));
    shadow.replaceChildren(el('style', { textContent: STYLE }), el('div', { className: 'box' }, head, el('div', { className: 'err', textContent: error }), rows, names));
  };

  const applyMode = (mode) => {
    enabled = mode === 'sync';
    if (enabled && !projects.length) loadProjects();
    signature = '';
    if (enabled) scan(); else render();
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'A2GENT_PEOPLE_SYNC_TOGGLE') return;
    visible = !visible;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MODE_KEY]) applyMode(changes[MODE_KEY].newValue);
  });
  chrome.storage.local.get(MODE_KEY).then((saved) => applyMode(saved[MODE_KEY]));

  // LinkedIn is a SPA with lazy-loaded sections and infinite lists: rescan on DOM changes and route changes.
  new MutationObserver(() => {
    if (enabled && !scanTimer) scanTimer = setTimeout(scan, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (enabled && href !== location.href) scan(); }, 1500);
})();
