// Sync mode panel on LinkedIn: links profiles to Brute person cards (socials.linkedin) and
// pushes scraped details into the card via PUT /projects/{id}/people/linkedin-sync.
(() => {
  const linkedin = globalThis.__A2GENT_PEOPLE_SYNC_LINKEDIN__;
  const shared = globalThis.__A2GENT_CONTENT_SCRIPT_SHARED__;
  if (!linkedin || !shared || globalThis.__A2GENT_PEOPLE_SYNC_PANEL__) return;
  globalThis.__A2GENT_PEOPLE_SYNC_PANEL__ = true;

  const MODE_KEY = 'a2gent.adapterChrome.mode';
  const PROJECT_KEY = 'a2gent.adapterChrome.peopleProject';
  const ICON_URL = chrome.runtime.getURL('icons/a2gent-16.png');
  const STYLE = `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;font:13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333}
*{box-sizing:border-box;font-family:inherit}.box{width:340px;max-height:60vh;display:flex;flex-direction:column;background:#fff;border:1px solid #0001;border-radius:10px;box-shadow:0 8px 28px #0003}
.head{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #0001}.brand-icon{display:block;width:18px;height:18px;flex:0 0 18px;object-fit:contain}
select,input{font-size:inherit;font-family:inherit;min-width:0;padding:3px 5px;border:1px solid #c9d1dc;border-radius:5px;background:#fff}.head select{flex:1}
.rows{overflow:auto}.row{display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid #0000000a}
.who{flex:1;min-width:0}.who b,.who small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.who small{color:#667}
.row input,.row select{width:120px}.row.stack{flex-wrap:wrap}.row.stack .who{flex-basis:100%}.row.stack input,.row.stack select{flex:1}button{cursor:pointer;border:0;border-radius:5px;background:#eef1f6;min-width:26px;height:24px;font-size:inherit;font-family:inherit}
button:hover{background:#dfe5ee}button:disabled{opacity:.5;cursor:wait}.ok{color:#127a3a;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.err,.note{padding:5px 8px;color:#b42318}.note{color:#127a3a;overflow-wrap:anywhere;user-select:text;max-height:96px;overflow:auto}.err:empty,.note:empty{display:none}
.sum{padding:5px 8px;color:#667}.sum:empty{display:none}
.combo{flex:1;min-width:0;display:flex;flex-direction:column}.row .combo input{width:auto}.list{max-height:180px;overflow:auto;margin-top:2px;border:1px solid #c9d1dc;border-radius:5px;background:#fff}.list[hidden]{display:none}.grp{position:sticky;top:0;padding:2px 6px;font-size:11px;font-weight:600;color:#667;background:#f3f5f9}.opt{padding:3px 6px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.opt:hover,.opt.on{background:#e3edfb}`;
  // Widgets injected next to LinkedIn's Message action; compact inputs keep the control action-sized.
  const INLINE_STYLE = `:host{all:initial;display:inline-flex;vertical-align:middle;flex:0 0 auto;width:auto;max-width:100%;margin:0 0 0 6px;font:13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333}
*{box-sizing:border-box;font-family:inherit}.row{display:flex;gap:5px;align-items:center;width:max-content;max-width:100%}.brand-icon{display:block;width:16px;height:16px;flex:0 0 16px;object-fit:contain}
.combo{display:flex;flex-direction:column;width:136px;flex:0 0 136px;min-width:0}.row .combo input{width:136px;flex:none}
select,input{font-size:inherit;font-family:inherit;min-width:0;padding:3px 5px;border:1px solid #c9d1dc;border-radius:5px;background:#fff}
.list{width:210px;max-height:180px;overflow:auto;margin-top:2px;border:1px solid #c9d1dc;border-radius:5px;background:#fff}.list[hidden]{display:none}.grp{position:sticky;top:0;padding:2px 6px;font-size:11px;font-weight:600;color:#667;background:#f3f5f9}.opt{padding:3px 6px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.opt:hover,.opt.on{background:#e3edfb}
button{cursor:pointer;border:0;border-radius:5px;background:#eef1f6;min-width:26px;height:24px;font-size:inherit;font-family:inherit}
button:hover{background:#dfe5ee}button:disabled{opacity:.5;cursor:wait}.ok{color:#127a3a;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}`;
  const INLINE_ATTR = 'data-a2gent-people-sync';

  let host; let shadow; let visible = true; let enabled = false;
  // slug -> { host, shadow, key } for widgets injected into the page.
  const inline = new Map(); let peopleVersion = 0;
  let projects = []; let projectId = ''; let people = []; let profiles = []; let kind = '';
  let error = ''; let notice = ''; let busy = ''; let href = ''; let signature = ''; let scanTimer;

  const api = async (path, options = {}) => {
    const proxied = await shared.sendRuntimeMessage({ type: 'A2GENT_BRUTE_API_FETCH', path, options });
    if (!proxied?.ok) throw new Error(proxied?.error || 'Brute request failed.');
    const response = proxied.response;
    if (!response?.ok) throw new Error(response?.body?.error || response?.bodyText || `HTTP ${response?.status}`);
    return response.body;
  };
  const projectPath = (suffix) => `/projects/${encodeURIComponent(projectId)}${suffix}`;
  const absolutePersonPath = (relativePath) => {
    const folder = String(projects.find((project) => project.id === projectId)?.folder || '').replace(/[\\/]+$/, '');
    const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
    const relative = String(relativePath || '').replace(/[\\/]/g, separator).replace(/^[/\\]+/, '');
    return folder ? `${folder}${separator}${relative}` : relative;
  };

  const loadPeople = async () => {
    people = [];
    peopleVersion += 1;
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
    } else {
      // LinkedIn re-renders rows and drops foreign nodes; re-inject without touching live widgets.
      renderInline();
    }
  };

  // choice: {path} links an existing card, {name} creates a new one; empty means use the already linked card.
  const sync = async (rowProfile, choice) => {
    // Profile sections load lazily, so re-parse at click time instead of using the render-time snapshot.
    const profile = kind === 'profile' ? linkedin.parseProfile(document, location.href) : rowProfile;
    visible = true;
    busy = profile.slug;
    render();
    try {
      let person = linkedin.linkedPeople(people).get(profile.slug);
      let action = 'Synced';
      if (!person && choice.path) {
        person = people.find((candidate) => candidate.path === choice.path);
        action = 'Linked';
      } else if (!person) {
        person = await api(projectPath('/people'), {
          method: 'POST',
          body: JSON.stringify({ name: choice.name || profile.name, importance: 5, status: 'active', socials: { linkedin: profile.url } }),
        });
        action = 'Created';
      }
      const updatedPerson = await api(projectPath('/people/linkedin-sync'), { method: 'PUT', body: JSON.stringify({ path: person.path, profile }) });
      await loadPeople();
      error = '';
      const outputPath = absolutePersonPath(updatedPerson?.path || person.path);
      const selectedProject = projects.find((project) => project.id === projectId);
      notice = `${action}${selectedProject?.name ? ` in ${selectedProject.name}` : ''}: ${outputPath}`;
    } catch (err) {
      error = err.message;
      notice = '';
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
  const brandIcon = () => el('img', { className: 'brand-icon', src: ICON_URL, alt: '', title: 'A2gent people sync' });

  // embedded: the widget sits beside LinkedIn actions, so use the product icon instead of a name column.
  const renderRow = (profile, linked, embedded = false) => {
    const person = linked.get(profile.slug);
    const who = embedded ? brandIcon()
      : el('div', { className: 'who', title: profile.url }, el('b', { textContent: profile.name }), el('small', { textContent: profile.headline }));
    if (person) {
      // List rows carry only name/headline; refreshing from them would wipe the richer profile-page sync.
      const refresh = kind === 'profile'
        ? el('button', { textContent: '↻', title: 'Sync profile into card', disabled: busy === profile.slug || !projectId, onclick: () => sync(profile, {}) })
        : null;
      return el('div', { className: 'row' }, who, el('span', { className: 'ok', textContent: `✓ ${person.name}`, title: person.path }), refresh);
    }
    // A custom combobox: <datalist> popups do not work inside the shadow root and a flat <select> is hard to
    // search. The list is in-flow (not a floating popup) so LinkedIn's overflow:hidden containers cannot clip it.
    const suggested = linkedin.suggestPerson(people, profile.name);
    let chosen = suggested?.path || '';
    let active = 0;
    let typed = false;
    const input = el('input', { placeholder: 'Search person or new name', value: suggested?.name || profile.name, title: 'Type to search people or name a new card' });
    const list = el('div', { className: 'list', hidden: true });
    const button = el('button', { disabled: busy === profile.slug || !projectId });
    const update = () => {
      button.textContent = chosen ? '🔗' : '+';
      button.title = chosen ? 'Link to the selected person and sync' : 'Create person card and sync';
    };
    const pick = (path, name) => {
      chosen = path;
      input.value = name;
      list.hidden = true;
      typed = false;
      update();
    };
    // Options grouped by the person's first group; the "new card" option always comes first.
    const refreshList = () => {
      // Until the user types, show everyone: the prefilled profile name must not hide the candidates.
      const query = (typed && !chosen ? input.value : '').trim().toLowerCase();
      const options = [{ path: '', name: input.value.trim() || profile.name, label: `+ New card: ${input.value.trim() || profile.name}` }];
      const groups = new Map();
      for (const person of people) {
        if (query && ![person.name, ...(person.aliases || [])].some((value) => String(value || '').toLowerCase().includes(query))) continue;
        const group = person.groups?.[0] || 'Other';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(person);
      }
      const names = [...groups.keys()].sort((x, y) => (x === 'Other') - (y === 'Other') || x.localeCompare(y));
      const children = [];
      const addOption = (option, label) => {
        const index = children.filter((child) => child.className.startsWith('opt')).length;
        children.push(el('div', {
          className: index === active ? 'opt on' : 'opt', textContent: label, title: option.path,
          // mousedown (not click) with preventDefault keeps focus in the input so blur does not close the list first.
          onmousedown: (event) => { event.preventDefault(); pick(option.path, option.path ? option.name : input.value.trim() || profile.name); },
        }));
        option.index = index;
      };
      const all = [options[0]];
      addOption(options[0], options[0].label);
      for (const name of names) {
        children.push(el('div', { className: 'grp', textContent: name }));
        for (const person of groups.get(name).sort((x, y) => x.name.localeCompare(y.name))) {
          all.push(person);
          addOption(person, person.name);
        }
      }
      active = Math.min(active, all.length - 1);
      list.replaceChildren(...children);
      list.options = all;
    };
    const open = () => { refreshList(); list.hidden = false; };
    input.addEventListener('input', () => { chosen = ''; typed = true; active = 0; update(); open(); });
    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('blur', () => { list.hidden = true; });
    // Keep LinkedIn keyboard shortcuts away from the input.
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      const count = list.options?.length || 0;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) { open(); return; }
        active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % Math.max(count, 1);
        refreshList();
        list.querySelector('.on')?.scrollIntoView?.({ block: 'nearest' });
      } else if (event.key === 'Escape') {
        list.hidden = true;
      } else if (event.key === 'Enter') {
        const option = !list.hidden && list.options?.[active];
        if (option) pick(option.path, option.path ? option.name : input.value.trim() || profile.name);
        else button.click();
      }
    });
    button.onclick = () => sync(profile, chosen ? { path: chosen } : { name: input.value.trim() });
    update();
    return el('div', { className: 'row' }, who, el('div', { className: 'combo' }, input, list), button);
  };

  const removeInline = () => {
    for (const widget of inline.values()) widget.host.remove();
    inline.clear();
  };

  const inlineTarget = (profile) => (kind === 'profile' ? linkedin.profileHeader(document) : linkedin.messageActionArea(document, profile.slug));

  // Injects/updates one widget per profile. Rebuilds a widget only when its state changes, so typing is
  // kept. Returns profiles with no place in the page; those stay in the floating panel.
  const renderInline = () => {
    const linked = linkedin.linkedPeople(people);
    const unplaced = [];
    const seen = new Set();
    for (const profile of profiles) {
      const target = inlineTarget(profile);
      if (!target) {
        unplaced.push(profile);
        continue;
      }
      seen.add(profile.slug);
      let widget = inline.get(profile.slug);
      if (!widget) {
        const widgetHost = document.createElement('div');
        widgetHost.setAttribute(INLINE_ATTR, profile.slug);
        // Rows are often clickable links/cards; keep our clicks and keys from reaching LinkedIn handlers.
        for (const type of ['click', 'mousedown', 'pointerdown', 'keydown', 'keyup']) widgetHost.addEventListener(type, (event) => event.stopPropagation());
        widget = { host: widgetHost, shadow: widgetHost.attachShadow({ mode: 'closed' }), key: '' };
        inline.set(profile.slug, widget);
      }
      if (widget.host.parentElement !== target) target.append(widget.host);
      const key = `${projectId}|${peopleVersion}|${busy === profile.slug}|${linked.get(profile.slug)?.path || ''}`;
      if (widget.key !== key) {
        widget.key = key;
        widget.shadow.replaceChildren(el('style', { textContent: INLINE_STYLE }), renderRow(profile, linked, true));
      }
    }
    for (const [slug, widget] of inline) {
      if (!seen.has(slug)) {
        widget.host.remove();
        inline.delete(slug);
      }
    }
    return unplaced;
  };

  const render = () => {
    if (!enabled || !kind) {
      host?.remove();
      removeInline();
      return;
    }
    const unplaced = renderInline();
    if (!host) {
      host = document.createElement('div');
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = !visible;
    const selectedProject = projects.find((project) => project.id === projectId);
    const select = el('select', { title: selectedProject?.folder || 'People project', onchange: async () => {
      projectId = select.value;
      await shared.storageSet(PROJECT_KEY, projectId);
      try { await loadPeople(); error = ''; } catch (err) { error = err.message; }
      render();
    } }, ...projects.map((project) => el('option', { value: project.id, textContent: project.name, title: project.folder, selected: project.id === projectId })));
    const linked = linkedin.linkedPeople(people);
    const rows = el('div', { className: 'rows' }, ...unplaced.map((profile) => renderRow(profile, linked)));
    const linkedCount = profiles.filter((profile) => linked.has(profile.slug)).length;
    const summary = profiles.length ? `${linkedCount}/${profiles.length} linked · forms are inline on the page` : '';
    const head = el('div', { className: 'head' }, brandIcon(), select,
      el('button', { textContent: '⟳', title: 'Reload people', onclick: () => loadProjects() }),
      el('button', { textContent: '×', title: 'Hide (toolbar icon shows it again)', onclick: () => { visible = false; render(); } }));
    shadow.replaceChildren(el('style', { textContent: STYLE }), el('div', { className: 'box' }, head, el('div', { className: 'err', textContent: error }), el('div', { className: 'note', textContent: notice }), el('div', { className: 'sum', textContent: unplaced.length < profiles.length ? summary : '' }), rows));
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
