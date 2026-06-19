((root, factory) => {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_DRAWING_BRIDGE__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const getDrawingOverlay = () => window.__A2GENT_DRAWING_OVERLAY__ || null;

  const annotationCountFromSummary = (summary) => Number(summary?.annotation_count ?? summary?.stroke_count) || 0;

  const syncDrawingState = (getState, setRawState) => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    const summary = drawingOverlay.getSummary?.();
    setRawState({
      ...getState(),
      drawingEnabled: Boolean(drawingOverlay.isEnabled?.()),
      hasDrawing: Boolean(drawingOverlay.hasAnnotations?.() ?? drawingOverlay.hasStrokes?.()),
      drawingStrokeCount: annotationCountFromSummary(summary),
    });
  };

  const toggleDrawing = (setState) => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) {
      setState({ error: 'Annotation overlay is unavailable. Reload the page or extension.' });
      return;
    }
    drawingOverlay.toggle();
  };

  const cancelDrawing = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    drawingOverlay.clear({ exit: true });
  };

  const disableDrawingInput = () => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    drawingOverlay.setEnabled(false);
  };

  const getDrawingSummary = () => getDrawingOverlay()?.getSummary?.() || null;

  return {
    getDrawingOverlay,
    syncDrawingState,
    toggleDrawing,
    cancelDrawing,
    disableDrawingInput,
    getDrawingSummary,
  };
});
