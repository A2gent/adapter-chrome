((root) => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const toPoint = (input, bounds) => ({
    x: clamp(Math.round(Number(input?.x) || 0), 0, bounds.width),
    y: clamp(Math.round(Number(input?.y) || 0), 0, bounds.height),
  });

  const samePoint = (left, right) => left && right && left.x === right.x && left.y === right.y;

  const createStroke = (rawPoints, viewport) => {
    const bounds = {
      width: Math.max(1, Math.round(Number(viewport?.width) || 1)),
      height: Math.max(1, Math.round(Number(viewport?.height) || 1)),
    };
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
      viewport: {
        width: Math.max(1, Math.round(Number(viewport?.width) || 1)),
        height: Math.max(1, Math.round(Number(viewport?.height) || 1)),
        device_pixel_ratio: Number(viewport?.devicePixelRatio) || 1,
      },
      strokes: normalizedStrokes,
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
