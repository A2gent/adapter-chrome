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

  const syncDrawingState = (getState, setRawState) => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) return;
    setRawState({
      ...getState(),
      drawingEnabled: Boolean(drawingOverlay.isEnabled?.()),
      hasDrawing: Boolean(drawingOverlay.hasStrokes?.()),
      drawingStrokeCount: drawingOverlay.getSummary?.()?.stroke_count || 0,
    });
  };

  const toggleDrawing = (setState) => {
    const drawingOverlay = getDrawingOverlay();
    if (!drawingOverlay) {
      setState({ error: 'Drawing overlay is unavailable. Reload the page or extension.' });
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
    if (!drawingOverlay?.isEnabled?.()) return;
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
