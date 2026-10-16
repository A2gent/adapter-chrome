export function createHighlighter(article) {
  const doc = article.root.ownerDocument;
  const view = doc.defaultView;
  const registry = view.CSS?.highlights;
  if (!registry || !view.Highlight) return {update() {}, destroy() {}};
  const points = [];
  for (const segment of article.segments || []) {
    if (points.length) points.push(null, null); // extractArticle joins with two newlines.
    for (let i = 0; i < segment.text.length; i++) points.push(segment.points?.[i] || null);
  }
  const style = doc.createElement('style');
  style.dataset.hearhearHighlight = '';
  style.textContent = '::highlight(hearhear-word){background-color:#ffda69;color:#182337;text-decoration:underline}';
  (doc.head || doc.documentElement).append(style);
  let previous = '';
  const clear = () => { registry.delete('hearhear-word'); previous = ''; };
  return {
    update(state) {
      const {wordStart:start, wordEnd:end} = state;
      if (!['playing','paused'].includes(state.phase) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > points.length) { clear(); return; }
      const key = `${start}:${end}`;
      if (key === previous) return;
      clear();
      const source = points.slice(start, end);
      // Generated labels (Long code, Diagram, list numbering) are not page words.
      // Never guess a match in other visible/hidden text when a source is absent.
      if (source.some(p => !p?.node.isConnected)) return;
      const spans = [];
      for (const point of source) {
        const last = spans.at(-1);
        if (last?.node === point.node && point.start <= last.end) last.end = Math.max(last.end, point.end);
        else spans.push({...point});
      }
      const ranges = [];
      for (const span of spans) {
        if (span.end > span.node.length) return;
        const range = doc.createRange();
        range.setStart(span.node, span.start); range.setEnd(span.node, span.end);
        ranges.push(range);
      }
      registry.set('hearhear-word', new view.Highlight(...ranges));
      previous = key;
      const rect = ranges[0]?.getBoundingClientRect();
      const viewportHeight = view.innerHeight || doc.documentElement.clientHeight;
      if (rect && rect.bottom > rect.top && (rect.top < viewportHeight * .2 || rect.bottom > viewportHeight * .8)) {
        // Keep the word in a stable reading band without moving the viewport on every update.
        const behavior = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        view.scrollTo({top:view.scrollY + rect.top - viewportHeight / 2, behavior});
      }
    },
    destroy() { clear(); style.remove(); },
  };
}
