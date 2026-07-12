// pdf2md.js — native PDF → Markdown converter (no external app / iframe).
// Detects headings by relative font size; falls back to OCR on pages with no text layer.

import { downloadBlob, wireDropzone, checkSizeWarning, setStatus, setProgress } from './shared.js';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

// Group text items into lines by their y-position, then infer heading level from font height.
function itemsToMarkdown(textContent) {
  const items = textContent.items.filter(it => it.str !== undefined);
  if (!items.length) return '';

  // Build lines keyed by rounded y.
  const lines = new Map();
  let heights = [];
  for (const it of items) {
    const y = Math.round(it.transform[5]);
    const h = Math.abs(it.transform[3]) || Math.abs(it.height) || 10;
    heights.push(h);
    if (!lines.has(y)) lines.set(y, { y, h, parts: [] });
    lines.get(y).parts.push(it.str);
  }
  // Median font height = body text baseline.
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;

  // Sort lines top-to-bottom (PDF y grows upward, so descending y).
  const ordered = [...lines.values()].sort((a, b) => b.y - a.y);

  const out = [];
  for (const line of ordered) {
    const text = line.parts.join('').replace(/\s+/g, ' ').trim();
    if (!text) { out.push(''); continue; }
    const ratio = line.h / median;
    if (ratio >= 1.7) out.push('# ' + text);
    else if (ratio >= 1.4) out.push('## ' + text);
    else if (ratio >= 1.2) out.push('### ' + text);
    else out.push(text);
  }
  // Collapse 3+ blank lines to a single blank line.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Wires up the PDF→MD tool on whichever page it appears (ids are identical on both).
export function initPdf2Md() {
  const dz = document.getElementById('dz-pdf2md');
  const fi = document.getElementById('fi-pdf2md');
  if (!dz) return;
  const outputWrap = document.getElementById('pdf2md-output');
  const preview = document.getElementById('pdf2md-preview');
  let currentMd = '', outName = '';

  wireDropzone(dz, fi, async (file) => {
    checkSizeWarning(file, document.getElementById('sw-pdf2md'));
    outName = file.name.replace(/\.pdf$/i, '') + '.md';
    setStatus('pdf2md-status', 'reading document…');
    let worker = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      const chunks = [];
      for (let i = 1; i <= doc.numPages; i++) {
        setStatus('pdf2md-status', `processing page ${i} / ${doc.numPages}…`);
        setProgress('pdf2md-progress', Math.round((i - 1) / doc.numPages * 100));
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const hasText = tc.items.some(it => it.str && it.str.trim().length);
        if (hasText) {
          chunks.push(itemsToMarkdown(tc));
        } else {
          if (!worker) { const { createWorker } = await import('tesseract.js'); worker = await createWorker('eng'); }
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const { data: { text } } = await worker.recognize(canvas);
          chunks.push(text.trim());
        }
      }
      if (worker) await worker.terminate();
      currentMd = chunks.join('\n\n---\n\n');
      preview.textContent = currentMd;
      outputWrap.style.display = 'block';
      setProgress('pdf2md-progress', 100);
      setStatus('pdf2md-status', 'done — preview below ✓');
    } catch (e) {
      console.error(e);
      if (worker) { try { await worker.terminate(); } catch {} }
      setStatus('pdf2md-status', 'error: ' + e.message);
    } finally {
      setTimeout(() => setProgress('pdf2md-progress', 0), 800);
    }
  });

  const dl = document.getElementById('pdf2md-download');
  if (dl) dl.onclick = () => { if (currentMd) downloadBlob(new Blob([currentMd], { type: 'text/markdown' }), outName || 'output.md'); };
}
