(() => {
  if (window.__A2GENT_DRAWING_OVERLAY__) {
    return;
  }

  const { createAnnotation, summarizeAnnotations } = window.__A2GENT_DRAWING_ANNOTATION__ || {};
  const ROOT_ID = 'a2gent-browser-adapter-drawing-root';
  const CHANGE_EVENT = 'A2GENT_DRAWING_CHANGED';
  const DEFAULT_TOOL = 'region';

  let host = null;
  let shadow = null;
  let surface = null;
  let enabled = false;
  let activeTool = DEFAULT_TOOL;
  let drag = null;
  let annotations = [];
  let nextNumber = 1;
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

  // WHY: annotations must stay attached to page content, not the viewport.
  // WHAT: store geometry in document/page CSS pixels and translate for rendering.
  const pointFromEvent = (event) => {
    const scroll = scrollPosition();
    return { x: event.clientX + scroll.x, y: event.clientY + scroll.y };
  };

  const pointToViewport = (point) => {
    const scroll = scrollPosition();
    return { x: point.x - scroll.x, y: point.y - scroll.y };
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const sanitizeText = (value) => String(value || '').trim().slice(0, 500);

  const markerAnchor = (annotation) => {
    if (annotation.type === 'region') {
      return pointToViewport({ x: annotation.geometry.x, y: annotation.geometry.y });
    }
    return pointToViewport(annotation.geometry.end);
  };

  const markerText = (annotation) => `[${annotation.number}]`;

  const svgLine = (annotation) => {
    const start = pointToViewport(annotation.geometry.start);
    const end = pointToViewport(annotation.geometry.end);
    return `
      <line
        class="arrow-line"
        x1="${start.x}"
        y1="${start.y}"
        x2="${end.x}"
        y2="${end.y}"
      ></line>
      <circle
        class="arrow-dot"
        cx="${end.x}"
        cy="${end.y}"
        r="5"
      ></circle>
    `;
  };

  const svgRegion = (annotation) => {
    const topLeft = pointToViewport({ x: annotation.geometry.x, y: annotation.geometry.y });
    return `
      <rect
        class="region-rect"
        x="${topLeft.x}"
        y="${topLeft.y}"
        width="${annotation.geometry.width}"
        height="${annotation.geometry.height}"
        rx="8"
        ry="8"
      ></rect>
    `;
  };

  const previewMarkup = () => {
    if (!drag) return '';
    const draft = createDraftAnnotation({ number: nextNumber, text: '', ...drag });
    if (!draft) return '';
    return draft.type === 'arrow' ? svgLine(draft) : svgRegion(draft);
  };

  const createDraftAnnotation = ({ type, number, text, start, end }) => {
    if (typeof createAnnotation === 'function') {
      return createAnnotation({ type, number, text, start, end }, viewport());
    }
    return null;
  };

  const emitChange = (extra = {}) => {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        enabled,
        activeTool,
        hasAnnotations: annotations.length > 0,
        hasStrokes: annotations.length > 0,
        annotationCount: annotations.length,
        strokeCount: annotations.length,
        annotations: annotations.map((annotation) => ({
          number: annotation.number,
          type: annotation.type,
          text: annotation.text,
        })),
        ...extra,
      },
    }));
  };

  const renderMarkers = () => {
    const markerLayer = shadow?.querySelector('[data-role="marker-layer"]');
    if (!markerLayer) return;
    markerLayer.innerHTML = annotations.map((annotation) => {
      const anchor = markerAnchor(annotation);
      return `
        <button
          type="button"
          class="marker"
          data-role="annotation-marker"
          data-number="${annotation.number}"
          style="left:${Math.round(anchor.x)}px; top:${Math.round(anchor.y)}px;"
          aria-label="Annotation ${annotation.number}: ${escapeHtml(annotation.text || 'no note yet')}"
        >${markerText(annotation)}</button>
      `;
    }).join('');

    markerLayer.querySelectorAll('[data-role="annotation-marker"]').forEach((marker) => {
      const currentAnnotation = () => annotations.find((item) => item.number === Number(marker.getAttribute('data-number')));
      marker.addEventListener('mouseenter', () => {
        const annotation = currentAnnotation();
        if (annotation) showTooltip(annotation);
      });
      marker.addEventListener('focus', () => {
        const annotation = currentAnnotation();
        if (annotation) showTooltip(annotation);
      });
      marker.addEventListener('mouseleave', closeTooltip);
      marker.addEventListener('blur', closeTooltip);
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTooltip();
        const annotation = currentAnnotation();
        if (annotation) openEditor(annotation);
      });
    });
  };

  const renderShapes = () => {
    const shapeLayer = shadow?.querySelector('[data-role="shape-layer"]');
    if (!shapeLayer) return;
    shapeLayer.innerHTML = `
      <svg class="shape-svg" width="100%" height="100%" aria-hidden="true">
        ${annotations.map((annotation) => (annotation.type === 'arrow' ? svgLine(annotation) : svgRegion(annotation))).join('')}
        ${previewMarkup()}
      </svg>
    `;
  };

  const renderToolState = () => {
    if (!shadow) return;
    shadow.querySelectorAll('[data-tool]').forEach((button) => {
      const isActive = button.getAttribute('data-tool') === activeTool;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    const hint = shadow.querySelector('[data-role="hint"]');
    if (hint) {
      hint.textContent = activeTool === 'region'
        ? 'Drag to draw a numbered rectangle. Add text in the popup; only the number appears in screenshots.'
        : 'Drag an arrow toward the element. Add text in the popup; only the number appears in screenshots.';
    }
  };

  const redraw = () => {
    renderShapes();
    renderMarkers();
    renderToolState();
  };

  const scheduleRedraw = () => {
    if (scrollRedrawFrame) return;
    scrollRedrawFrame = window.requestAnimationFrame(() => {
      scrollRedrawFrame = null;
      redraw();
    });
  };

  const editorRole = '[data-role="annotation-editor"]';
  const tooltipRole = '[data-role="annotation-tooltip"]';

  const closeTooltip = () => {
    const tooltip = shadow?.querySelector(tooltipRole);
    if (tooltip) tooltip.remove();
  };

  const closeEditor = () => {
    const editor = shadow?.querySelector(editorRole);
    if (editor) editor.remove();
  };

  const floatingPanelPosition = (annotation, { width = 290, height = 180 } = {}) => {
    const anchor = markerAnchor(annotation);
    const left = Math.min(Math.max(anchor.x + 14, 10), Math.max(10, window.innerWidth - width));
    const top = Math.min(Math.max(anchor.y + 14, 10), Math.max(10, window.innerHeight - height));
    return { left, top };
  };

  const showTooltip = (annotation) => {
    closeTooltip();
    if (!shadow) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'annotation-tooltip';
    tooltip.setAttribute('data-role', 'annotation-tooltip');
    tooltip.textContent = annotation.text || 'Add note for this reference';
    const position = floatingPanelPosition(annotation, { width: 280, height: 90 });
    tooltip.style.left = `${Math.round(position.left)}px`;
    tooltip.style.top = `${Math.round(position.top)}px`;
    shadow.querySelector('.wrap')?.appendChild(tooltip);
  };

  const updateAnnotationText = (number, text, { emit = true } = {}) => {
    const nextText = sanitizeText(text);
    annotations = annotations.map((annotation) => (
      annotation.number === number ? { ...annotation, text: nextText } : annotation
    ));
    redraw();
    const annotation = annotations.find((item) => item.number === number);
    if (emit && annotation) {
      emitChange({ updatedReference: { number: annotation.number, type: annotation.type, text: annotation.text } });
    }
  };

  const openEditor = (annotation) => {
    closeTooltip();
    closeEditor();
    if (!shadow) return;
    const position = floatingPanelPosition(annotation);
    const editor = document.createElement('div');
    editor.className = 'annotation-editor';
    editor.setAttribute('data-role', 'annotation-editor');
    editor.style.left = `${Math.round(position.left)}px`;
    editor.style.top = `${Math.round(position.top)}px`;
    editor.innerHTML = `
      <label>
        <span>${markerText(annotation)} ${annotation.type === 'region' ? 'Rectangle' : 'Arrow'} note</span>
        <textarea data-role="annotation-text" rows="4" placeholder="Example: resize this button">${escapeHtml(annotation.text)}</textarea>
      </label>
      <div class="editor-actions">
        <button type="button" data-role="annotation-delete" class="danger">Delete</button>
        <button type="button" data-role="annotation-done" class="primary">Done</button>
      </div>
    `;
    shadow.querySelector('.wrap')?.appendChild(editor);
    const textarea = editor.querySelector('[data-role="annotation-text"]');
    textarea?.addEventListener('input', (event) => updateAnnotationText(annotation.number, event.target.value));
    editor.querySelector('[data-role="annotation-delete"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      annotations = annotations.filter((item) => item.number !== annotation.number);
      closeTooltip();
      closeEditor();
      redraw();
      emitChange({ removedReference: { number: annotation.number } });
      emitChange();
    });
    editor.querySelector('[data-role="annotation-done"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    });
    textarea?.focus({ preventScroll: true });
    textarea?.setSelectionRange(String(textarea.value || '').length, String(textarea.value || '').length);
  };

  const applyVisibility = () => {
    if (!host) return;
    const visible = enabled || annotations.length > 0 || Boolean(drag);
    host.style.display = visible ? 'block' : 'none';
    host.style.pointerEvents = visible ? 'auto' : 'none';
    if (surface) surface.style.pointerEvents = enabled ? 'auto' : 'none';
    if (shadow) {
      const toolbar = shadow.querySelector('[data-role="toolbar"]');
      const hint = shadow.querySelector('[data-role="hint"]');
      if (toolbar) toolbar.hidden = !enabled;
      if (hint) hint.hidden = !enabled;
    }
  };

  const setTool = (tool) => {
    if (tool !== 'arrow' && tool !== 'region') return;
    activeTool = tool;
    redraw();
    emitChange();
  };

  const ensureOverlay = () => {
    if (host && shadow && surface) return;

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
        .wrap { position: fixed; inset: 0; font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .surface { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
        .shape-layer, .marker-layer { position: absolute; inset: 0; pointer-events: none; }
        .shape-svg { position: absolute; inset: 0; overflow: visible; }
        .arrow-line {
          stroke: #ff3b30;
          stroke-width: 5;
          stroke-linecap: round;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,.72));
        }
        .arrow-dot {
          fill: #ff3b30;
          stroke: #fff;
          stroke-width: 2;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,.72));
        }
        .region-rect {
          fill: none;
          stroke: #ff3b30;
          stroke-width: 8;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,.62));
        }
        .marker-layer { z-index: 2; }
        .marker {
          position: absolute;
          transform: translate(-50%, -50%);
          min-width: 30px;
          height: 30px;
          padding: 0 7px;
          border: 2px solid #fff;
          border-radius: 999px;
          background: #ff3b30;
          color: #fff;
          box-shadow: 0 4px 14px rgba(0,0,0,.42);
          font: 800 13px/26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
          user-select: none;
        }
        .annotation-tooltip {
          position: fixed;
          z-index: 5;
          max-width: 280px;
          padding: 7px 9px;
          border-radius: 8px;
          background: rgba(17, 24, 39, .96);
          color: #f9fafb;
          box-shadow: 0 8px 28px rgba(0,0,0,.34);
          font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: normal;
          overflow-wrap: anywhere;
          pointer-events: none;
        }
        .toolbar {
          position: fixed;
          top: 12px;
          left: 50%;
          z-index: 4;
          display: flex;
          gap: 7px;
          align-items: center;
          transform: translateX(-50%);
          padding: 7px;
          border-radius: 999px;
          background: rgba(17, 24, 39, .92);
          box-shadow: 0 8px 24px rgba(0,0,0,.28);
          pointer-events: auto;
        }
        .toolbar button,
        .editor-actions button {
          border: 0;
          border-radius: 999px;
          padding: 7px 11px;
          color: #f7fbff;
          background: rgba(255,255,255,.12);
          cursor: pointer;
          font: inherit;
        }
        .toolbar button.active,
        .editor-actions button.primary { background: #ffd166; color: #111827; font-weight: 800; }
        .editor-actions button.danger { background: rgba(255, 95, 86, .22); color: #ffb4b4; }
        .hint {
          position: fixed;
          top: 62px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 3;
          max-width: min(620px, calc(100vw - 32px));
          padding: 7px 11px;
          border-radius: 999px;
          color: #111827;
          background: rgba(255, 209, 102, 0.95);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
          font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
          user-select: none;
        }
        .annotation-editor {
          position: fixed;
          z-index: 5;
          width: 280px;
          display: grid;
          gap: 8px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 12px;
          background: rgba(17, 24, 39, .96);
          color: #f9fafb;
          box-shadow: 0 14px 42px rgba(0,0,0,.38);
          pointer-events: auto;
        }
        .annotation-editor label { display: grid; gap: 6px; }
        .annotation-editor span { color: #cbd5e1; font-size: 12px; font-weight: 700; }
        .annotation-editor textarea {
          min-height: 96px;
          resize: vertical;
          border: 1px solid rgba(155, 181, 220, .35);
          border-radius: 9px;
          background: rgba(255,255,255,.08);
          color: #fff;
          padding: 8px;
          font: inherit;
          outline: none;
        }
        .annotation-editor textarea:focus { border-color: rgba(255, 209, 102, .95); }
        .editor-actions { display: flex; justify-content: flex-end; gap: 7px; }
      </style>
      <div class="wrap">
        <div class="surface" data-role="surface" aria-label="A2gent numbered annotation surface"></div>
        <div class="shape-layer" data-role="shape-layer"></div>
        <div class="marker-layer" data-role="marker-layer"></div>
        <div class="toolbar" data-role="toolbar" hidden>
          <button type="button" data-tool="arrow" aria-pressed="false">Arrow</button>
          <button type="button" data-tool="region" aria-pressed="true">Rectangle</button>
        </div>
        <div class="hint" data-role="hint" hidden></div>
      </div>
    `;
    surface = shadow.querySelector('[data-role="surface"]');

    shadow.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setTool(button.getAttribute('data-tool'));
      });
    });

    surface.addEventListener('pointerdown', (event) => {
      if (!enabled || event.button !== 0) return;
      if (event.target?.closest?.('[data-role="annotation-editor"], [data-role="toolbar"], [data-role="annotation-marker"]')) return;
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
      drag = {
        type: activeTool,
        pointerId: event.pointerId,
        start: pointFromEvent(event),
        end: pointFromEvent(event),
      };
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; annotation dragging still works through normal pointer events.
      }
      redraw();
      emitChange();
    });

    surface.addEventListener('pointermove', (event) => {
      if (!enabled || !drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      drag = { ...drag, end: pointFromEvent(event) };
      redraw();
    });

    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const finished = createDraftAnnotation({ ...drag, number: nextNumber, text: '' });
      drag = null;
      try {
        surface.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures when the browser has already dropped capture.
      }
      if (finished) {
        annotations = [...annotations, finished];
        nextNumber += 1;
        redraw();
        applyVisibility();
        emitChange();
        openEditor(finished);
      } else {
        redraw();
        applyVisibility();
        emitChange();
      }
    };

    surface.addEventListener('pointerup', finishDrag);
    surface.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', scheduleRedraw);
    window.addEventListener('scroll', scheduleRedraw, { passive: true });
    redraw();
    applyVisibility();
  };

  const setEnabled = (nextEnabled) => {
    ensureOverlay();
    enabled = Boolean(nextEnabled);
    if (enabled) {
      activeTool = DEFAULT_TOOL;
    } else {
      drag = null;
      closeTooltip();
      closeEditor();
    }
    redraw();
    applyVisibility();
    emitChange();
  };

  const clear = ({ exit = true } = {}) => {
    annotations = [];
    drag = null;
    nextNumber = 1;
    closeTooltip();
    closeEditor();
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
    setTool,
    isEnabled() {
      return enabled;
    },
    hasStrokes() {
      return annotations.length > 0;
    },
    hasAnnotations() {
      return annotations.length > 0;
    },
    getSummary() {
      if (typeof summarizeAnnotations !== 'function' || annotations.length === 0) return null;
      return summarizeAnnotations(annotations, viewport());
    },
  };
})();
