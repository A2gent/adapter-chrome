((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const matching = root?.__A2GENT_CONTENT_SCRIPT_PROJECT_MATCHING__;
  const sessionLaunch = root?.__A2GENT_CONTENT_SCRIPT_SESSION_LAUNCH__;
  const exported = factory(
    shared || require('./shared.js'),
    matching || require('./projectMatching.js'),
    sessionLaunch || require('./sessionLaunch.js'),
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_PROJECT_SETTINGS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared, matching, sessionLaunch) => {
  const persistLaunchPrefs = async (getState, patch = {}) => {
    const state = getState();
    await shared.storageSet(shared.STORAGE_SESSION_LAUNCH_KEY, {
      provider: patch.provider ?? state.selectedProvider,
      model: patch.model ?? state.selectedModel,
      agentId: patch.agentId ?? state.selectedAgentId,
    });
  };

  const loadSettingsAndProjects = async ({
    getState,
    setState,
    setRawState,
    listProjects,
    listProviders,
    listUnifiedAgents,
    listProviderModels,
    render,
  }) => {
    const storedBaseUrl = await shared.storageGet(shared.STORAGE_BASE_URL_KEY);
    const storedLaunch = await shared.storageGet(shared.STORAGE_SESSION_LAUNCH_KEY) || {};
    const baseUrl = storedBaseUrl || shared.DEFAULT_BRUTE_BASE_URL;
    setRawState({ ...getState(), baseUrl });
    render();
    try {
      setState({ status: 'Loading projects...', error: '' });
      const [projects, providers, globalAgents] = await Promise.all([
        listProjects(),
        listProviders ? listProviders().catch(() => []) : Promise.resolve([]),
        listUnifiedAgents ? listUnifiedAgents().catch(() => []) : Promise.resolve([]),
      ]);
      const detection = matching.detectProject(projects || [], location.href);
      const selectedProjectId = detection.projectId || '';
      const projectAgents = selectedProjectId && listUnifiedAgents
        ? await listUnifiedAgents(selectedProjectId).catch(() => [])
        : [];
      const agents = sessionLaunch.buildAgentOptions({
        globalAgents: globalAgents || [],
        projectAgents: projectAgents || [],
        projectId: selectedProjectId,
      });
      const selectedAgent = sessionLaunch.resolveSelectedAgent(agents, storedLaunch.agentId || getState().selectedAgentId);
      const selectedProvider = sessionLaunch.resolveSelectedProvider(providers || [], storedLaunch.provider || getState().selectedProvider);
      const provider = (providers || []).find((item) => item.type === selectedProvider) || null;
      const models = sessionLaunch.shouldShowProviderControls(selectedAgent) && provider && listProviderModels
        ? await listProviderModels(provider).catch(() => sessionLaunch.normalizeModelsResponse({}, provider))
        : [];
      const selectedModel = sessionLaunch.resolveSelectedModel(
        provider,
        models,
        storedLaunch.model || getState().selectedModel,
      );
      await persistLaunchPrefs(() => ({
        selectedProvider,
        selectedModel,
        selectedAgentId: selectedAgent.id,
      }));
      setState({
        projects: projects || [],
        selectedProjectId,
        projectDetection: { mode: detection.mode, label: detection.label, detail: detection.detail },
        providers: providers || [],
        globalAgents: globalAgents || [],
        models,
        agents,
        selectedProvider,
        selectedModel,
        selectedAgentId: selectedAgent.id,
        status: 'Ready',
        error: '',
      });
    } catch (error) {
      setState({
        projects: [],
        selectedProjectId: '',
        projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Projects could not be loaded.' },
        providers: [],
        globalAgents: [],
        models: [],
        agents: [sessionLaunch.createBuiltInHostAgent()],
        selectedProvider: '',
        selectedModel: '',
        selectedAgentId: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
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

  const changeProject = async ({ getState, setState, listUnifiedAgents, projectId }) => {
    const projectAgents = projectId && listUnifiedAgents
      ? await listUnifiedAgents(projectId).catch(() => [])
      : [];
    const agents = sessionLaunch.buildAgentOptions({
      globalAgents: getState().globalAgents || [],
      projectAgents,
      projectId,
    });
    const selectedAgent = sessionLaunch.resolveSelectedAgent(agents, getState().selectedAgentId);
    setState({
      selectedProjectId: projectId,
      projectDetection: { mode: 'manual', label: 'Manual selection', detail: 'Project chosen manually.' },
      agents,
      selectedAgentId: selectedAgent.id,
      models: sessionLaunch.shouldShowProviderControls(selectedAgent) ? getState().models : [],
    });
    await persistLaunchPrefs(getState, { agentId: selectedAgent.id });
  };

  const changeProvider = async ({ getState, setState, listProviderModels, providerType }) => {
    const providers = getState().providers || [];
    const provider = providers.find((item) => item.type === providerType) || { type: providerType };
    const models = sessionLaunch.isModellessProvider(providerType) || !listProviderModels
      ? sessionLaunch.normalizeModelsResponse({}, provider)
      : await listProviderModels(provider).catch(() => sessionLaunch.normalizeModelsResponse({}, provider));
    const selectedModel = sessionLaunch.resolveSelectedModel(provider, models, '', { reset: true });
    setState({ selectedProvider: providerType, models, selectedModel });
    await persistLaunchPrefs(getState, { provider: providerType, model: selectedModel });
  };

  const changeAgent = async ({ getState, setState, agentId }) => {
    const agent = sessionLaunch.resolveSelectedAgent(getState().agents || [], agentId);
    setState({
      selectedAgentId: agent.id,
      models: sessionLaunch.shouldShowProviderControls(agent) ? getState().models : [],
    });
    await persistLaunchPrefs(getState, { agentId: agent.id });
  };

  const changeModel = async ({ getState, setState, model }) => {
    setState({ selectedModel: model });
    await persistLaunchPrefs(getState, { model });
  };

  return {
    loadSettingsAndProjects,
    saveBaseUrl,
    changeProject,
    changeProvider,
    changeAgent,
    changeModel,
  };
});
