((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const matching = root?.__A2GENT_CONTENT_SCRIPT_PROJECT_MATCHING__;
  const exported = factory(
    shared || require('./shared.js'),
    matching || require('./projectMatching.js'),
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_PROJECT_SETTINGS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared, matching) => {
  const loadSettingsAndProjects = async ({ getState, setState, setRawState, listProjects, render }) => {
    const storedBaseUrl = await shared.storageGet(shared.STORAGE_BASE_URL_KEY);
    const baseUrl = storedBaseUrl || shared.DEFAULT_BRUTE_BASE_URL;
    setRawState({ ...getState(), baseUrl });
    render();
    try {
      setState({ status: 'Loading projects...', error: '' });
      const projects = await listProjects();
      const detection = matching.detectProject(projects || [], location.href);
      setState({
        projects: projects || [],
        selectedProjectId: detection.projectId,
        projectDetection: { mode: detection.mode, label: detection.label, detail: detection.detail },
        status: 'Ready',
      });
    } catch (error) {
      setState({
        projects: [],
        selectedProjectId: '',
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Projects could not be loaded.' },
        status: 'Brute unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const saveBaseUrl = async ({ shadow, setState, loadSettingsAndProjects }) => {
    const input = shadow?.querySelector('[data-role="base-url"]');
    if (!input) return;
    try {
      const baseUrl = shared.validateLoopbackBaseUrl(input.value);
      await shared.storageSet(shared.STORAGE_BASE_URL_KEY, baseUrl);
      setState({ baseUrl, error: '', status: 'Base URL saved.', settingsOpen: false });
      await loadSettingsAndProjects();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    loadSettingsAndProjects,
    saveBaseUrl,
  };
});
