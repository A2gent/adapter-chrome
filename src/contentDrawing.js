(() => {
  if (window.__A2GENT_DRAWING_OVERLAY__) {
    return;
  }

  const { createStroke, summarizeDrawing } = window.__A2GENT_DRAWING_ANNOTATION__ || {};
  const ROOT_ID = 'a2gent-browser-adapter-drawing-root';
  const CHANGE_EVENT = 'A2GENT_DRAWING_CHANGED';
  const MAX_POINTS_PER_STROKE = 1400;

  let host = null;
  let shadow = null;
  let canvas = null;
  let context = null;
  let enabled = false;
  let drawing = false;
  let activeStroke = [];
  let strokes = [];
  let pointerId = null;
  let scrollRedrawFrame = null;

  const scrollPosition = () => ({
    x: window.scrollX || window.pageXOffset || document.documentElement?.scrollLeft || document.body?.scrollLeft || 0,
    y: window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0,
  });

  const pageSize = () => {
    const body = document.body;
    const doc = document.documentElement;
    return {
      width: Math.max(
        window.innerWidth,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
        doc?.scrollWidth || 0,
        doc?.offsetWidth || 0,
        doc?.clientWidth || 0,
      ),
      height: Math.max(
        window.innerHeight,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        doc?.scrollHeight || 0,
        doc?.offsetHeight || 0,
        doc?.clientHeight || 0,
      ),
    };
  };

  const viewport = () => {
    const size = pageSize();
    const scroll = scrollPosition();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      pageWidth: size.width,
      pageHeight: size.height,
      scrollX: scroll.x,
      scrollY: scroll.y,
    };
  };

  const emitChange = () => {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        enabled,
        hasStrokes: strokes.length > 0,
        strokeCount: strokes.length,
      },
    }));
  };

  // WHY: drawing should stay attached to page content, not to the current viewport.
  // WHAT: store pointer samples in document/page CSS pixels and translate them back when rendering.
  const pointFromEvent = (event) => {
    const scroll = scrollPosition();
    return { x: event.clientX + scroll.x, y: event.clientY + scroll.y };
  };
  const pointToCanvas = (point) => {
    const scroll = scrollPosition();
    return { x: point.x - scroll.x, y: point.y - scroll.y };
  };

  const drawStroke = (points, active = false) => {
    if (!context || points.length < 2) return;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = active ? '#ffd166' : '#ff3b30';
    context.lineWidth = active ? 5 : 6;
    context.shadowColor = 'rgba(0, 0, 0, 0.72)';
    context.shadowBlur = 7;
    const firstPoint = pointToCanvas(points[0]);
    context.beginPath();
    context.moveTo(firstPoint.x, firstPoint.y);
    for (const point of points.slice(1)) {
      const canvasPoint = pointToCanvas(point);
      context.lineTo(canvasPoint.x, canvasPoint.y);
    }
    context.stroke();
    context.restore();
  };

  const redraw = () => {
    if (!context || !canvas) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = window.devicePixelRatio || 1;
    context.save();
    context.scale(scale, scale);
    for (const stroke of strokes) {
      drawStroke(stroke, false);
    }
    drawStroke(activeStroke, true);
    context.restore();
  };

  const scheduleRedraw = () => {
    if (scrollRedrawFrame) return;
    scrollRedrawFrame = window.requestAnimationFrame(() => {
      scrollRedrawFrame = null;
      redraw();
    });
  };

  const resizeCanvas = () => {
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    redraw();
  };

  const applyVisibility = () => {
    if (!host) return;
    const visible = enabled || strokes.length > 0 || activeStroke.length > 0;
    host.style.display = visible ? 'block' : 'none';
    host.style.pointerEvents = enabled ? 'auto' : 'none';
    if (shadow) {
      const badge = shadow.querySelector('[data-role="hint"]');
      if (badge) {
        badge.hidden = !enabled;
      }
    }
  };

  const ensureOverlay = () => {
    if (host && shadow && canvas && context) return;

    host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.display = 'none';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';
    document.documentElement.appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; inset: 0; }
        canvas { position: absolute; inset: 0; width: 100vw; height: 100vh; cursor: crosshair; touch-action: none; }
        .hint {
          position: fixed;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1;
          padding: 7px 11px;
          border-radius: 999px;
          color: #111827;
          background: rgba(255, 209, 102, 0.95);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
          font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
          user-select: none;
        }
      </style>
      <div class="wrap">
        <canvas aria-label="A2gent focus drawing canvas"></canvas>
        <div class="hint" data-role="hint" hidden>Drag on the page to draw a focus highlight. Use Done or Cancel drawing in the A2gent panel.</div>
      </div>
    `;
    canvas = shadow.querySelector('canvas');
    context = canvas.getContext('2d');

    canvas.addEventListener('pointerdown', (event) => {
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      drawing = true;
      activeStroke = [pointFromEvent(event)];
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; drawing still works through normal pointer events.
      }
      redraw();
      emitChange();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!enabled || !drawing || event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const nextPoint = pointFromEvent(event);
      const previousPoint = activeStroke[activeStroke.length - 1];
      const distance = previousPoint ? Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) : 0;
      if (distance < 2 && activeStroke.length > 1) return;
      activeStroke.push(nextPoint);
      if (activeStroke.length > MAX_POINTS_PER_STROKE) {
        activeStroke = activeStroke.slice(-MAX_POINTS_PER_STROKE);
      }
      redraw();
    });

    const finishStroke = (event) => {
      if (!drawing || event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const finalized = typeof createStroke === 'function' ? createStroke(activeStroke, viewport()) : activeStroke;
      if (finalized && finalized.length >= 2) {
        strokes = [...strokes, finalized];
      }
      drawing = false;
      pointerId = null;
      activeStroke = [];
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures when the browser has already dropped capture.
      }
      redraw();
      applyVisibility();
      emitChange();
    };

    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('scroll', scheduleRedraw, { passive: true });
    resizeCanvas();
    applyVisibility();
  };

  const setEnabled = (nextEnabled) => {
    ensureOverlay();
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      drawing = false;
      pointerId = null;
      activeStroke = [];
    }
    resizeCanvas();
    applyVisibility();
    emitChange();
  };

  const clear = ({ exit = true } = {}) => {
    strokes = [];
    activeStroke = [];
    drawing = false;
    pointerId = null;
    if (exit) {
      enabled = false;
    }
    redraw();
    applyVisibility();
    emitChange();
  };

  window.__A2GENT_DRAWING_OVERLAY__ = {
    changeEvent: CHANGE_EVENT,
    setEnabled,
    toggle() {
      setEnabled(!enabled);
    },
    clear,
    isEnabled() {
      return enabled;
    },
    hasStrokes() {
      return strokes.length > 0;
    },
    getSummary() {
      if (typeof summarizeDrawing !== 'function' || strokes.length === 0) return null;
      return summarizeDrawing(strokes, viewport());
    },
  };
})();
