((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const exported = factory(shared || require('./shared.js'));
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_PROJECT_MATCHING__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared) => {
  const wildcardCount = (pattern) => (String(pattern || '').match(/\*/g) || []).length;
  const literalCharCount = (pattern) => String(pattern || '').replace(/\*/g, '').length;
  const literalPathLength = (pattern) => {
    try {
      return new URL(String(pattern || '').replace(/\*/g, 'wildcard')).pathname.replace(/wildcard/g, '').length;
    } catch {
      return 0;
    }
  };

  const patternMatchesUrl = (pattern, currentUrl) => {
    try {
      if (typeof URLPattern !== 'undefined') {
        return new URLPattern(pattern).test(currentUrl);
      }
    } catch {
      // Fallback below for our restricted '*' subset.
    }
    const escaped = String(pattern || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(String(currentUrl || ''));
  };

  const compareScores = (left, right) => {
    if (left.wildcards !== right.wildcards) return left.wildcards - right.wildcards;
    if (left.literalChars !== right.literalChars) return right.literalChars - left.literalChars;
    if (left.literalPath !== right.literalPath) return right.literalPath - left.literalPath;
    return 0;
  };

  const detectProject = (projects, currentUrl) => {
    const matches = [];
    for (const project of Array.isArray(projects) ? projects : []) {
      for (const pattern of project.url_patterns || []) {
        if (!pattern || !patternMatchesUrl(pattern, currentUrl)) continue;
        matches.push({
          project,
          pattern,
          wildcards: wildcardCount(pattern),
          literalChars: literalCharCount(pattern),
          literalPath: literalPathLength(pattern),
        });
      }
    }
    if (matches.length === 0) {
      return { projectId: '', mode: 'manual', label: 'Manual selection', detail: 'No URL pattern matched this page.' };
    }
    matches.sort(compareScores);
    const best = matches[0];
    const tied = matches.filter((candidate) => compareScores(candidate, best) === 0);
    const tiedProjectIds = new Set(tied.map((candidate) => candidate.project.id));
    if (tiedProjectIds.size > 1) {
      return {
        projectId: '',
        mode: 'manual',
        label: 'Manual selection required',
        detail: `Multiple projects matched equally: ${tied.map((item) => `${item.project.name} (${item.pattern})`).join(', ')}`,
      };
    }
    return {
      projectId: best.project.id,
      mode: 'auto',
      label: `Auto-detected: ${best.project.name}`,
      detail: `Matched ${best.pattern}`,
    };
  };

  return {
    wildcardCount,
    literalCharCount,
    literalPathLength,
    patternMatchesUrl,
    compareScores,
    detectProject,
    clip: shared.clip,
  };
});
