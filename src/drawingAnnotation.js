((root) => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const numeric = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const positiveInt = (value, fallback = 1) => Math.max(1, Math.round(numeric(value, fallback)));

  const coordinateBounds = (viewport) => ({
    // WHY: focus strokes are now stored in page coordinates so they can scroll with content.
    // WHAT: prefer full page bounds when provided, while keeping the old viewport-only API working.
    width: positiveInt(viewport?.pageWidth ?? viewport?.documentWidth ?? viewport?.width, 1),
    height: positiveInt(viewport?.pageHeight ?? viewport?.documentHeight ?? viewport?.height, 1),
  });

  const viewportMetadata = (viewport) => ({
    width: positiveInt(viewport?.width, 1),
    height: positiveInt(viewport?.height, 1),
    device_pixel_ratio: numeric(viewport?.devicePixelRatio, 1) || 1,
  });

  const toPoint = (input, bounds) => ({
    x: clamp(Math.round(numeric(input?.x, 0)), 0, bounds.width),
    y: clamp(Math.round(numeric(input?.y, 0)), 0, bounds.height),
  });

  const samePoint = (left, right) => left && right && left.x === right.x && left.y === right.y;

  const createStroke = (rawPoints, viewport) => {
    const bounds = coordinateBounds(viewport);
    const points = [];
    for (const rawPoint of Array.isArray(rawPoints) ? rawPoints : []) {
      const point = toPoint(rawPoint, bounds);
      if (!samePoint(points[points.length - 1], point)) {
        points.push(point);
      }
    }
    return points.length < 2 ? null : points;
  };

  const summarizeDrawing = (strokes, viewport) => {
    const normalizedStrokes = (Array.isArray(strokes) ? strokes : [])
      .map((stroke) => createStroke(stroke, viewport))
      .filter(Boolean);

    return {
      schema: 'a2gent.browser.annotation.v1',
      type: 'freeform_curve',
      viewport: viewportMetadata(viewport),
      // WHY: screenshots already carry the visible focus curves.
      // WHAT: keep only compact metadata in default prompts instead of duplicating every stroke point.
      stroke_count: normalizedStrokes.length,
      point_count: normalizedStrokes.reduce((total, stroke) => total + stroke.length, 0),
    };
  };

  const api = {
    createStroke,
    summarizeDrawing,
  };

  if (root && typeof root === 'object') {
    root.__A2GENT_DRAWING_ANNOTATION__ = api;
  }

  if (typeof module !== 'undefined') {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
