/**
 * Click a Mermaid diagram to open it in a full-screen viewer: wheel or buttons zoom, drag pans,
 * Escape or a click on the backdrop closes. Mermaid renders after load, so the click is
 * delegated from the document.
 */
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

export function enableDiagramZoom(doc: Document): void {
  doc.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const diagram = target?.closest('.mermaid');
    const svg = diagram?.querySelector('svg');
    if (!diagram || !svg || doc.querySelector('.diagram-viewer')) return;
    openViewer(doc, svg);
  });
}

function openViewer(doc: Document, source: SVGSVGElement): void {
  const svg = source.cloneNode(true) as SVGSVGElement;
  const box = source.viewBox.baseVal;
  const width = box.width || source.getBoundingClientRect().width;
  const height = box.height || source.getBoundingClientRect().height;
  svg.removeAttribute('style');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const viewer = doc.createElement('div');
  viewer.className = 'diagram-viewer';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-label', 'Diagram viewer');
  const stage = doc.createElement('div');
  stage.className = 'diagram-viewer__stage';
  stage.append(svg);
  const toolbar = doc.createElement('div');
  toolbar.className = 'diagram-viewer__toolbar';
  viewer.append(stage, toolbar);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const fit = () => {
    const w = viewer.clientWidth;
    const h = viewer.clientHeight;
    scale = Math.min((w * 0.94) / width, (h * 0.88) / height, 3);
    x = (w - width * scale) / 2;
    y = (h - height * scale) / 2;
    apply();
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
    apply();
  };
  const centre = (factor: number) =>
    zoomAt(factor, viewer.clientWidth / 2, viewer.clientHeight / 2);
  const close = () => {
    doc.removeEventListener('keydown', onKey);
    viewer.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') centre(1.25);
    else if (e.key === '-') centre(0.8);
    else if (e.key === '0') fit();
  };

  for (const [label, title, run] of [
    ['+', 'Zoom in', () => centre(1.25)],
    ['−', 'Zoom out', () => centre(0.8)],
    ['Fit', 'Fit to screen', fit],
    ['✕', 'Close (Esc)', close],
  ] as const) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      run();
    });
    toolbar.append(button);
  }

  viewer.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    },
    { passive: false },
  );
  let drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;
  viewer.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.diagram-viewer__toolbar')) return;
    drag = { px: e.clientX, py: e.clientY, x, y, moved: false };
    viewer.setPointerCapture(e.pointerId);
    viewer.classList.add('diagram-viewer--dragging');
  });
  viewer.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    x = drag.x + dx;
    y = drag.y + dy;
    apply();
  });
  viewer.addEventListener('pointerup', (e) => {
    const moved = drag?.moved ?? false;
    drag = null;
    viewer.classList.remove('diagram-viewer--dragging');
    // A click on the backdrop (not on the diagram, not a drag) closes the viewer.
    if (!moved && !(e.target as Element).closest('svg')) close();
  });

  doc.addEventListener('keydown', onKey);
  doc.body.append(viewer);
  fit();
}
