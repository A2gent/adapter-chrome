((root) => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const numeric = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const positiveInt = (value, fallback = 1) => Math.max(1, Math.round(numeric(value, fallback)));

  const positiveAnnotationNumber = (value) => {
    const number = Math.round(numeric(value, NaN));
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  const coordinateBounds = (viewport) => ({
    // WHY: annotations are stored in page coordinates so they can scroll with content.
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

  const annotationType = (value) => {
    const type = String(value || '').toLowerCase();
    return type === 'arrow' || type === 'region' || type === 'element' ? type : '';
  };

  const annotationText = (value) => String(value || '').trim().slice(0, 500);

  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);

  const createAnnotation = (rawAnnotation, viewport) => {
    if (!rawAnnotation || typeof rawAnnotation !== 'object') return null;
    const type = annotationType(rawAnnotation.type);
    const number = positiveAnnotationNumber(rawAnnotation.number);
    if (!type || !number) return null;

    const bounds = coordinateBounds(viewport);
    const rawGeometry = rawAnnotation.geometry || {};
    const text = annotationText(rawAnnotation.text);

    if (type === 'arrow') {
      const start = toPoint(rawAnnotation.start || rawGeometry.start, bounds);
      const end = toPoint(rawAnnotation.end || rawGeometry.end, bounds);
      if (distance(start, end) < 8) return null;
      return {
        number,
        type,
        text,
        geometry: { start, end },
      };
    }

    const hasBoxGeometry = ['x', 'y', 'width', 'height'].every((key) => Object.prototype.hasOwnProperty.call(rawGeometry, key));
    const first = hasBoxGeometry
      ? toPoint(rawGeometry, bounds)
      : toPoint(rawAnnotation.start || rawGeometry.start, bounds);
    const second = hasBoxGeometry
      ? toPoint({ x: numeric(rawGeometry.x) + numeric(rawGeometry.width), y: numeric(rawGeometry.y) + numeric(rawGeometry.height) }, bounds)
      : toPoint(rawAnnotation.end || rawGeometry.end, bounds);
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    const minSize = type === 'element' ? 1 : 6;
    if (width < minSize || height < minSize) return null;
    const element = rawAnnotation.element && typeof rawAnnotation.element === 'object'
      ? {
        tag: String(rawAnnotation.element.tag || '').toLowerCase().slice(0, 80),
        id: String(rawAnnotation.element.id || '').slice(0, 120),
        className: String(rawAnnotation.element.className || '').slice(0, 240),
        text: annotationText(rawAnnotation.element.text),
      }
      : undefined;
    return {
      number,
      type,
      text,
      geometry: { x, y, width, height },
      ...(type === 'element' && element ? { element } : {}),
    };
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

  const summarizeAnnotations = (annotations, viewport) => {
    const normalizedAnnotations = (Array.isArray(annotations) ? annotations : [])
      .map((annotation) => createAnnotation(annotation, viewport))
      .filter(Boolean);

    return {
      schema: 'a2gent.browser.annotation.v2',
      type: 'numbered_references',
      viewport: viewportMetadata(viewport),
      // WHY: the screenshot shows the geometry and marker numbers.
      // WHAT: prompts get compact numbered references without duplicating coordinates.
      annotation_count: normalizedAnnotations.length,
      references: normalizedAnnotations.map((annotation) => ({
        number: annotation.number,
        type: annotation.type,
        text: annotation.text,
        // WHY: element selections target a specific DOM node — the prompt needs the
        // tag/id/class/text descriptor to know which element the number points at.
        ...(annotation.type === 'element' && annotation.element ? { element: annotation.element } : {}),
      })),
    };
  };

  const api = {
    createStroke,
    createAnnotation,
    summarizeDrawing,
    summarizeAnnotations,
  };

  if (root && typeof root === 'object') {
    root.__A2GENT_DRAWING_ANNOTATION__ = api;
  }

  if (typeof module !== 'undefined') {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
