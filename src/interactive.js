// interactive.js — shared canvas interaction helpers for Edit / Signature / Watermark.
// Desktop-first (mouse), with pointer events so touch also works.

import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

export async function openPdfForViewing(bytes) {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

// Renders a page into a canvas, scaled to fit maxWidth. Returns {viewport, scale}.
export async function renderPageFit(doc, pageNum, canvas, maxWidth = 640) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 2.2);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { viewport, scale, pageWidth: base.width, pageHeight: base.height };
}

// Makes an absolutely-positioned element draggable within its offsetParent.
// Calls onMove(xFrac, yFrac) with position as a fraction of the container (0..1).
export function makeDraggable(el, container, onMove) {
  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  el.style.cursor = 'move';
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    origLeft = el.offsetLeft; origTop = el.offsetTop;
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let nl = origLeft + (e.clientX - startX);
    let nt = origTop + (e.clientY - startY);
    const maxL = container.clientWidth - el.offsetWidth;
    const maxT = container.clientHeight - el.offsetHeight;
    nl = Math.max(0, Math.min(nl, maxL));
    nt = Math.max(0, Math.min(nt, maxT));
    el.style.left = nl + 'px';
    el.style.top = nt + 'px';
    if (onMove) onMove(nl / container.clientWidth, nt / container.clientHeight);
  });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointercancel', () => { dragging = false; });
}

// Lets the user draw a rectangle on an overlay by click-dragging.
// Calls onRect({xFrac,yFrac,wFrac,hFrac}) when a rectangle is completed.
export function enableRectSelect(overlay, container, onRect) {
  let drawing = false, startX = 0, startY = 0, box = null;

  overlay.addEventListener('pointerdown', (e) => {
    drawing = true;
    const r = container.getBoundingClientRect();
    startX = e.clientX - r.left; startY = e.clientY - r.top;
    box = document.createElement('div');
    box.style.cssText = 'position:absolute;border:2px solid #33415C;background:rgba(51,65,92,0.15);pointer-events:none;';
    box.style.left = startX + 'px'; box.style.top = startY + 'px';
    overlay.appendChild(box);
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!drawing || !box) return;
    const r = container.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const x = Math.min(startX, cx), y = Math.min(startY, cy);
    const w = Math.abs(cx - startX), h = Math.abs(cy - startY);
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
  });
  overlay.addEventListener('pointerup', () => {
    if (!drawing || !box) return;
    drawing = false;
    const x = parseFloat(box.style.left), y = parseFloat(box.style.top);
    const w = parseFloat(box.style.width) || 0, h = parseFloat(box.style.height) || 0;
    if (w > 4 && h > 4 && onRect) {
      onRect({
        xFrac: x / container.clientWidth, yFrac: y / container.clientHeight,
        wFrac: w / container.clientWidth, hFrac: h / container.clientHeight
      });
    }
    // leave the box visible as a marker
  });
}
