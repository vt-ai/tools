// pdf-core.js — shared PDF helpers. Deliberately small.

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

export { PDFDocument, StandardFonts, rgb, degrees, pdfjsLib };

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'download';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function savePdf(bytes, name) {
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
}

export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function loadForEdit(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function loadForView(bytes) {
  // pdf.js consumes the buffer, so always hand it a copy.
  return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
}

// Render one page into a fresh canvas at a given max width. Returns the canvas.
export async function renderPage(viewDoc, pageNum, maxWidth = 200) {
  const page = await viewDoc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Standard file-picker + drag/drop wiring. Returns nothing; calls onFiles(FileList).
export function wireFileInput(dropzone, input, onFiles) {
  if (!dropzone || !input) throw new Error('dropzone/input missing');
  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => { if (e.target.files?.length) onFiles(e.target.files); });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('drag');
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  });
}

// Per-tool status writer scoped to a panel (no global id collisions).
export function statusWriter(panel) {
  const el = panel.querySelector('.status-line');
  return (msg, kind) => {
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'error' ? '#8a3b3b' : kind === 'ok' ? 'var(--moss)' : 'var(--muted)';
  };
}
