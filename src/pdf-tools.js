// pdf-tools.js — all PDF tool logic, using bundled npm imports (Vite build).

import { downloadBlob, formatBytes, wireDropzone, checkSizeWarning, wireToolNav, setStatus, setProgress } from './shared.js';

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this worker URL at build time:
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt';
import { decryptPDF } from '@pdfsmaller/pdf-decrypt';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { initPdf2Md } from './pdf2md.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

wireToolNav('.sidebar .stool', 'mobileToolSelect', 'panel-');
initPdf2Md();

// ---- small helpers ----
async function loadPdfJs(bytes) { return pdfjsLib.getDocument({ data: bytes }).promise; }
async function loadPdfLib(bytes) { return PDFDocument.load(bytes, { ignoreEncryption: true }); }
async function renderPageToCanvas(doc, pageNum, canvas, scale = 1.3) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return viewport;
}

// =================================================================
// 1. EDIT PDF
// =================================================================
(function editPdfTool() {
  const dz = document.getElementById('dz-edit'), fi = document.getElementById('fi-edit');
  const workspace = document.getElementById('edit-workspace');
  const canvas = document.getElementById('edit-canvas');
  const annotForm = document.getElementById('edit-annot-form');
  if (!dz) return;
  let pdfjsDoc = null, srcBytes = null, currentPage = 1;
  let annotations = [];
  let activeType = 'text';

  document.querySelectorAll('#panel-edit .mtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#panel-edit .mtab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    activeType = b.dataset.etype;
    renderAnnotForm();
  }));

  function renderAnnotForm() {
    if (activeType === 'text') {
      annotForm.innerHTML = `
        <div class="field-row">
          <label>Text <input type="text" id="af-text" placeholder="Enter text" style="width:200px;"></label>
          <label>Font size <input type="number" id="af-size" value="14" min="6" max="72" style="width:60px;"></label>
          <label>X% <input type="range" id="af-x" min="0" max="95" value="10"></label>
          <label>Y% <input type="range" id="af-y" min="0" max="95" value="10"></label>
        </div>
        <button class="btn secondary" id="af-add">Add Text</button>`;
      document.getElementById('af-add').onclick = () => {
        const text = document.getElementById('af-text').value.trim();
        if (!text) return;
        annotations.push({ page: currentPage, type: 'text', text, fontSize: +document.getElementById('af-size').value, xPct: +document.getElementById('af-x').value, yPct: +document.getElementById('af-y').value });
        setStatus('edit-status', `added text (${annotations.length} annotation(s) queued)`);
      };
    } else {
      const label = activeType === 'highlight' ? 'Highlight' : activeType === 'underline' ? 'Underline' : 'Redact box';
      annotForm.innerHTML = `
        <div class="field-row">
          <label>X% <input type="range" id="af-x" min="0" max="90" value="10"></label>
          <label>Y% <input type="range" id="af-y" min="0" max="90" value="10"></label>
          <label>Width% <input type="range" id="af-w" min="5" max="90" value="30"></label>
          <label>Height% <input type="range" id="af-h" min="2" max="30" value="5"></label>
        </div>
        <button class="btn secondary" id="af-add">Add ${label}</button>`;
      document.getElementById('af-add').onclick = () => {
        annotations.push({ page: currentPage, type: activeType, xPct: +document.getElementById('af-x').value, yPct: +document.getElementById('af-y').value, wPct: +document.getElementById('af-w').value, hPct: +document.getElementById('af-h').value });
        setStatus('edit-status', `added ${activeType} (${annotations.length} annotation(s) queued)`);
      };
    }
  }
  renderAnnotForm();

  wireDropzone(dz, fi, async (file) => {
    setStatus('edit-status', 'loading PDF…');
    try {
      srcBytes = new Uint8Array(await file.arrayBuffer());
      pdfjsDoc = await loadPdfJs(srcBytes.slice());
      currentPage = 1; annotations = [];
      workspace.style.display = 'block';
      await showPage();
      setStatus('edit-status', `loaded ${pdfjsDoc.numPages} page(s)`);
    } catch (e) { console.error(e); setStatus('edit-status', 'error loading PDF: ' + e.message); }
  });

  async function showPage() {
    await renderPageToCanvas(pdfjsDoc, currentPage, canvas);
    document.getElementById('edit-pagenum').textContent = `Page ${currentPage} / ${pdfjsDoc.numPages}`;
  }
  document.getElementById('edit-prev').onclick = async () => { if (currentPage > 1) { currentPage--; await showPage(); } };
  document.getElementById('edit-next').onclick = async () => { if (pdfjsDoc && currentPage < pdfjsDoc.numPages) { currentPage++; await showPage(); } };

  document.getElementById('edit-save').onclick = async () => {
    if (!srcBytes) return setStatus('edit-status', 'open a PDF first');
    setStatus('edit-status', 'saving edits…');
    try {
      const pdfDoc = await loadPdfLib(srcBytes.slice());
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      for (const a of annotations) {
        const page = pages[a.page - 1]; if (!page) continue;
        const { width, height } = page.getSize();
        if (a.type === 'text') {
          page.drawText(a.text, { x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - a.fontSize, size: a.fontSize, font, color: rgb(0.1, 0.1, 0.1) });
        } else if (a.type === 'highlight') {
          page.drawRectangle({ x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - (a.hPct / 100) * height, width: (a.wPct / 100) * width, height: (a.hPct / 100) * height, color: rgb(1, 0.92, 0.3), opacity: 0.45 });
        } else if (a.type === 'underline') {
          const y = height - (a.yPct / 100) * height - (a.hPct / 100) * height;
          page.drawLine({ start: { x: (a.xPct / 100) * width, y }, end: { x: (a.xPct / 100) * width + (a.wPct / 100) * width, y }, thickness: 1.5, color: rgb(0.1, 0.1, 0.8) });
        } else if (a.type === 'redact') {
          page.drawRectangle({ x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - (a.hPct / 100) * height, width: (a.wPct / 100) * width, height: (a.hPct / 100) * height, color: rgb(0, 0, 0) });
        }
      }
      if (document.getElementById('edit-pagenums').checked) {
        pages.forEach((p, i) => { const { width: w } = p.getSize(); const t = `${i + 1}`; p.drawText(t, { x: w - font.widthOfTextAtSize(t, 10) - 30, y: 24, size: 10, font, color: rgb(0.4, 0.4, 0.4) }); });
      }
      const wmText = document.getElementById('edit-wm-text').value.trim();
      if (wmText) {
        const opacity = +document.getElementById('edit-wm-opacity').value || 0.12;
        pages.forEach(p => { const { width: w, height: h } = p.getSize(); p.drawText(wmText, { x: w / 2 - font.widthOfTextAtSize(wmText, 40) / 2, y: h / 2, size: 40, font, color: rgb(0, 0, 0), opacity, rotate: degrees(-45) }); });
      }
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), 'edited.pdf');
      setStatus('edit-status', 'done — edited.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('edit-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 2. REARRANGE / SPLIT / REMOVE
// =================================================================
(function rearrangeTool() {
  const dz = document.getElementById('dz-rearrange'), fi = document.getElementById('fi-rearrange');
  const list = document.getElementById('rearrange-list');
  if (!dz) return;
  let srcBytes = null, order = [];

  wireDropzone(dz, fi, async (file) => {
    checkSizeWarning(file, document.getElementById('sw-rearrange'));
    setStatus('rearrange-status', 'loading…');
    try {
      srcBytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await loadPdfLib(srcBytes.slice());
      order = pdf.getPageIndices().map(i => ({ originalIndex: i, removed: false, splitAfter: false }));
      renderList();
      setStatus('rearrange-status', `loaded ${order.length} page(s)`);
    } catch (e) { console.error(e); setStatus('rearrange-status', 'error: ' + e.message); }
  });

  function renderList() {
    list.innerHTML = '';
    order.forEach((p, pos) => {
      const el = document.createElement('div');
      el.className = 'page-thumb' + (p.removed ? ' removed' : '');
      el.innerHTML = `<div class="pnum">Pg ${p.originalIndex + 1}</div>
        <div style="margin-top:4px;display:flex;gap:3px;justify-content:center;">
          <button data-act="up" style="font-size:10px;">▲</button><button data-act="down" style="font-size:10px;">▼</button>
          <button data-act="rm" style="font-size:10px;">✕</button><button data-act="split" style="font-size:10px;">✂</button>
        </div>${p.splitAfter ? '<div style="color:#33415C;font-size:9px;">split ✂</div>' : ''}`;
      el.querySelector('[data-act=up]').onclick = () => { if (pos > 0) { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; renderList(); } };
      el.querySelector('[data-act=down]').onclick = () => { if (pos < order.length - 1) { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; renderList(); } };
      el.querySelector('[data-act=rm]').onclick = () => { p.removed = !p.removed; renderList(); };
      el.querySelector('[data-act=split]').onclick = () => { p.splitAfter = !p.splitAfter; renderList(); };
      list.appendChild(el);
    });
  }

  document.getElementById('rearrange-save').onclick = async () => {
    if (!srcBytes) return setStatus('rearrange-status', 'open a PDF first');
    setStatus('rearrange-status', 'saving…');
    try {
      const src = await loadPdfLib(srcBytes.slice());
      const out = await PDFDocument.create();
      const keep = order.filter(p => !p.removed);
      const copied = await out.copyPages(src, keep.map(p => p.originalIndex));
      copied.forEach(pg => out.addPage(pg));
      const bytes = await out.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'reordered.pdf');
      setStatus('rearrange-status', 'done — reordered.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('rearrange-status', 'error: ' + e.message); }
  };

  document.getElementById('rearrange-split').onclick = async () => {
    if (!srcBytes) return setStatus('rearrange-status', 'open a PDF first');
    const splitPositions = order.map((p, i) => p.splitAfter ? i : -1).filter(i => i >= 0);
    if (!splitPositions.length) return setStatus('rearrange-status', 'mark at least one split point (✂) first');
    setStatus('rearrange-status', 'splitting…');
    try {
      const src = await loadPdfLib(srcBytes.slice());
      let start = 0, part = 1;
      const bounds = [...splitPositions, order.length - 1];
      for (const end of bounds) {
        const out = await PDFDocument.create();
        const slice = order.slice(start, end + 1).filter(p => !p.removed);
        const copied = await out.copyPages(src, slice.map(p => p.originalIndex));
        copied.forEach(pg => out.addPage(pg));
        const bytes = await out.save();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `split-part${part}.pdf`);
        start = end + 1; part++;
      }
      setStatus('rearrange-status', `done — ${part - 1} file(s) downloaded ✓`);
    } catch (e) { console.error(e); setStatus('rearrange-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 3. COMBINE / ADD
// =================================================================
(function combineTool() {
  const dz = document.getElementById('dz-combine'), fi = document.getElementById('fi-combine');
  const listEl = document.getElementById('combine-list'), saveBtn = document.getElementById('combine-save');
  if (!dz) return;
  let files = [];
  fi.addEventListener('change', e => addFiles(e.target.files));
  dz.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  dz.addEventListener('dragover', e => e.preventDefault());
  dz.addEventListener('click', () => fi.click());

  function addFiles(fl) { for (const f of fl) if (/pdf$/i.test(f.name)) files.push(f); render(); }
  function render() {
    listEl.innerHTML = '';
    files.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'filepill';
      row.innerHTML = `<span class="name">${f.name}</span><span class="size">${formatBytes(f.size)}</span>
        <button data-act="up" style="font-size:11px;">▲</button><button data-act="down" style="font-size:11px;">▼</button><button data-act="rm" style="font-size:11px;">✕</button>`;
      row.querySelector('[data-act=up]').onclick = () => { if (i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; render(); } };
      row.querySelector('[data-act=down]').onclick = () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; render(); } };
      row.querySelector('[data-act=rm]').onclick = () => { files.splice(i, 1); render(); };
      listEl.appendChild(row);
    });
    saveBtn.disabled = files.length < 2;
    setStatus('combine-status', files.length < 2 ? 'add at least two PDFs' : `${files.length} PDFs ready`);
  }
  saveBtn.onclick = async () => {
    setStatus('combine-status', 'merging…');
    try {
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await loadPdfLib(new Uint8Array(await f.arrayBuffer()));
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(pg => out.addPage(pg));
      }
      const bytes = await out.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
      setStatus('combine-status', 'done — merged.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('combine-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 4. ROTATE
// =================================================================
(function rotateTool() {
  const dz = document.getElementById('dz-rotate'), fi = document.getElementById('fi-rotate');
  const list = document.getElementById('rotate-list');
  if (!dz) return;
  let srcBytes = null, rotations = [];
  wireDropzone(dz, fi, async (file) => {
    setStatus('rotate-status', 'loading…');
    try {
      srcBytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await loadPdfLib(srcBytes.slice());
      rotations = pdf.getPages().map(() => 0);
      render();
      setStatus('rotate-status', `loaded ${rotations.length} page(s)`);
    } catch (e) { console.error(e); setStatus('rotate-status', 'error: ' + e.message); }
  });
  function render() {
    list.innerHTML = '';
    rotations.forEach((r, i) => {
      const el = document.createElement('div'); el.className = 'page-thumb';
      el.innerHTML = `<div class="pnum">Pg ${i + 1}</div><div style="font-size:10px;">${r}°</div>
        <div style="display:flex;gap:3px;justify-content:center;margin-top:4px;"><button data-act="l" style="font-size:10px;">⟲</button><button data-act="r" style="font-size:10px;">⟳</button></div>`;
      el.querySelector('[data-act=l]').onclick = () => { rotations[i] = (rotations[i] - 90 + 360) % 360; render(); };
      el.querySelector('[data-act=r]').onclick = () => { rotations[i] = (rotations[i] + 90) % 360; render(); };
      list.appendChild(el);
    });
  }
  document.getElementById('rotate-all-left').onclick = () => { rotations = rotations.map(r => (r - 90 + 360) % 360); render(); };
  document.getElementById('rotate-all-right').onclick = () => { rotations = rotations.map(r => (r + 90) % 360); render(); };
  document.getElementById('rotate-save').onclick = async () => {
    if (!srcBytes) return setStatus('rotate-status', 'open a PDF first');
    setStatus('rotate-status', 'saving…');
    try {
      const pdf = await loadPdfLib(srcBytes.slice());
      pdf.getPages().forEach((p, i) => p.setRotation(degrees(rotations[i])));
      const bytes = await pdf.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'rotated.pdf');
      setStatus('rotate-status', 'done — rotated.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('rotate-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 5. REMOVE PDF PASSWORD
// =================================================================
(function removePwTool() {
  const dz = document.getElementById('dz-removepw'), fi = document.getElementById('fi-removepw');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('removepw-status', `loaded ${f.name}`); });
  document.getElementById('removepw-go').onclick = async () => {
    if (!file) return setStatus('removepw-status', 'select a PDF first');
    const pw = document.getElementById('removepw-pw').value;
    setStatus('removepw-status', 'unlocking…');
    try {
      const decrypted = await decryptPDF(new Uint8Array(await file.arrayBuffer()), pw);
      downloadBlob(new Blob([decrypted], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_unlocked.pdf'));
      setStatus('removepw-status', 'done — unlocked file downloaded ✓');
    } catch (e) { console.error(e); setStatus('removepw-status', 'error: wrong password or unsupported encryption'); }
  };
})();

// =================================================================
// 6. ADD PDF PASSWORD
// =================================================================
(function addPwTool() {
  const dz = document.getElementById('dz-addpw'), fi = document.getElementById('fi-addpw');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('addpw-status', `loaded ${f.name}`); });
  document.getElementById('addpw-go').onclick = async () => {
    if (!file) return setStatus('addpw-status', 'select a PDF first');
    const userPw = document.getElementById('addpw-user').value;
    const ownerPw = document.getElementById('addpw-owner').value || undefined;
    if (!userPw) return setStatus('addpw-status', 'enter an open password first');
    setStatus('addpw-status', 'encrypting…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encrypted = ownerPw ? await encryptPDF(bytes, userPw, ownerPw) : await encryptPDF(bytes, userPw);
      downloadBlob(new Blob([encrypted], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_protected.pdf'));
      setStatus('addpw-status', 'done — protected file downloaded ✓');
    } catch (e) { console.error(e); setStatus('addpw-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 7. ADD SIGNATURE (draw / type / upload PNG or JPEG)
// =================================================================
(function signatureTool() {
  if (!document.getElementById('panel-signature')) return;
  let signatureDataUrl = null;

  document.querySelectorAll('#panel-signature .mtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#panel-signature .mtab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('#panel-signature .method-panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById('m-' + b.dataset.m).classList.add('active');
  }));

  // draw
  const pad = document.getElementById('sig-pad');
  const pctx = pad.getContext('2d');
  pctx.lineWidth = 2.4; pctx.lineCap = 'round'; pctx.strokeStyle = '#232821';
  let drawing = false, lastX = 0, lastY = 0;
  function pos(e) {
    const r = pad.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) * (pad.width / r.width), y: (cy - r.top) * (pad.height / r.height) };
  }
  pad.addEventListener('pointerdown', e => { drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; });
  pad.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); pctx.beginPath(); pctx.moveTo(lastX, lastY); pctx.lineTo(p.x, p.y); pctx.stroke(); lastX = p.x; lastY = p.y; });
  window.addEventListener('pointerup', () => drawing = false);
  document.getElementById('sig-clear').onclick = () => pctx.clearRect(0, 0, pad.width, pad.height);
  document.getElementById('sig-use-draw').onclick = () => { signatureDataUrl = pad.toDataURL('image/png'); ready(); };

  // type
  document.querySelectorAll('.font-swatches button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.font-swatches button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    document.getElementById('sig-type-input').style.fontFamily = b.dataset.font;
  }));
  document.getElementById('sig-use-type').onclick = () => {
    const text = document.getElementById('sig-type-input').value.trim() || 'Signature';
    const fontFamily = document.querySelector('.font-swatches button.sel').dataset.font;
    const c = document.createElement('canvas'); c.width = 420; c.height = 150;
    const cx = c.getContext('2d');
    cx.font = `56px ${fontFamily}`; cx.fillStyle = '#232821'; cx.textBaseline = 'middle'; cx.textAlign = 'center';
    cx.fillText(text, c.width / 2, c.height / 2);
    signatureDataUrl = c.toDataURL('image/png'); ready();
  };

  // upload (PNG or JPEG)
  wireDropzone(document.getElementById('dz-sig-upload'), document.getElementById('fi-sig-upload'), (file) => {
    const reader = new FileReader();
    reader.onload = () => { signatureDataUrl = reader.result; ready(); };
    reader.readAsDataURL(file);
  });

  function ready() { document.getElementById('sig-placement').style.display = 'block'; setStatus('sig-status', 'signature ready — open the PDF to place it'); }

  // placement
  let pdfjsDoc = null, srcBytes = null, currentPage = 1;
  const canvas = document.getElementById('sig-canvas-view'), overlay = document.getElementById('sig-overlay');
  wireDropzone(document.getElementById('dz-sig-pdf'), document.getElementById('fi-sig-pdf'), async (file) => {
    try {
      srcBytes = new Uint8Array(await file.arrayBuffer());
      pdfjsDoc = await loadPdfJs(srcBytes.slice());
      currentPage = 1;
      document.getElementById('sig-page-wrap').style.display = 'block';
      await showPage();
    } catch (e) { console.error(e); setStatus('sig-status', 'error loading PDF: ' + e.message); }
  });
  async function showPage() {
    await renderPageToCanvas(pdfjsDoc, currentPage, canvas);
    document.getElementById('sig-pagenum').textContent = `Page ${currentPage} / ${pdfjsDoc.numPages}`;
    updateOverlay();
  }
  document.getElementById('sig-prev').onclick = async () => { if (currentPage > 1) { currentPage--; await showPage(); } };
  document.getElementById('sig-next').onclick = async () => { if (pdfjsDoc && currentPage < pdfjsDoc.numPages) { currentPage++; await showPage(); } };
  function updateOverlay() {
    if (!signatureDataUrl) return;
    const xPct = +document.getElementById('sig-x').value, yPct = +document.getElementById('sig-y').value;
    const sizePct = +document.getElementById('sig-size').value, rot = +document.getElementById('sig-rotate').value;
    const w = canvas.width * (sizePct / 100), h = w * 0.35;
    overlay.style.left = (canvas.width * (xPct / 100)) + 'px';
    overlay.style.top = (canvas.height * (yPct / 100)) + 'px';
    overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
    overlay.style.transform = `rotate(${rot}deg)`;
    overlay.style.backgroundImage = `url(${signatureDataUrl})`;
    overlay.style.backgroundSize = 'contain'; overlay.style.backgroundRepeat = 'no-repeat'; overlay.style.backgroundPosition = 'center';
  }
  ['sig-x', 'sig-y', 'sig-size', 'sig-rotate'].forEach(id => document.getElementById(id).addEventListener('input', updateOverlay));
  document.getElementById('sig-save').onclick = async () => {
    if (!srcBytes || !signatureDataUrl) return setStatus('sig-status', 'need a signature and a PDF first');
    setStatus('sig-status', 'placing signature…');
    try {
      const pdfDoc = await loadPdfLib(srcBytes.slice());
      const b64 = signatureDataUrl.split(',')[1];
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const isJpeg = signatureDataUrl.startsWith('data:image/jpeg');
      const embedded = isJpeg ? await pdfDoc.embedJpg(bin) : await pdfDoc.embedPng(bin);
      const page = pdfDoc.getPages()[currentPage - 1];
      const { width, height } = page.getSize();
      const xPct = +document.getElementById('sig-x').value / 100, yPct = +document.getElementById('sig-y').value / 100;
      const sizePct = +document.getElementById('sig-size').value / 100, rot = +document.getElementById('sig-rotate').value;
      const w = width * sizePct, h = w * 0.35;
      page.drawImage(embedded, { x: xPct * width, y: height - yPct * height - h, width: w, height: h, rotate: degrees(rot) });
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), 'signed.pdf');
      setStatus('sig-status', 'done — signed.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('sig-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 8. REMOVE WATERMARK (best-effort: repeated image XObject)
// =================================================================
(function removeWatermarkTool() {
  const dz = document.getElementById('dz-removewm'), fi = document.getElementById('fi-removewm');
  const goBtn = document.getElementById('removewm-go');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; goBtn.disabled = false; setStatus('removewm-status', `loaded ${f.name}`); });
  goBtn.onclick = async () => {
    if (!file) return;
    setStatus('removewm-status', 'scanning for a repeated stamp…');
    try {
      const pdfDoc = await loadPdfLib(new Uint8Array(await file.arrayBuffer()));
      const pages = pdfDoc.getPages();
      if (pages.length < 2) return setStatus('removewm-status', 'need 2+ pages to detect a repeated watermark');
      const nameCounts = {};
      const dicts = pages.map(p => {
        try { const res = p.node.Resources(); return res && res.lookupMaybe ? res.lookup(res.context.obj('XObject')) : null; } catch { return null; }
      });
      dicts.forEach(d => { if (!d || !d.keys) return; for (const k of d.keys()) { const n = k.toString(); nameCounts[n] = (nameCounts[n] || 0) + 1; } });
      const cand = Object.entries(nameCounts).find(([, c]) => c === pages.length);
      if (!cand) return setStatus('removewm-status', 'no repeated stamp found — it may be baked into the page image');
      const target = cand[0];
      dicts.forEach(d => { if (d && d.delete) { try { d.delete(pdfDoc.context.obj(target.replace(/^\//, ''))); } catch {} } });
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_dewatermarked.pdf'));
      setStatus('removewm-status', 'done — best-effort result downloaded, please verify ✓');
    } catch (e) { console.error(e); setStatus('removewm-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 9. COMPRESS  (reliable: rasterize each page to a JPEG at preset quality/scale)
// =================================================================
(function compressTool() {
  const dz = document.getElementById('dz-compress'), fi = document.getElementById('fi-compress');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('compress-status', `loaded ${f.name} (${formatBytes(f.size)})`); });
  document.getElementById('compress-go').onclick = async () => {
    if (!file) return setStatus('compress-status', 'select a PDF first');
    const preset = document.getElementById('compress-preset').value;
    const cfg = preset === 'max' ? { scale: 1.0, quality: 0.5 }
      : preset === 'lossless' ? { scale: 2.0, quality: 0.85 }
      : { scale: 1.5, quality: 0.7 };
    setStatus('compress-status', 'compressing…'); setProgress('compress-progress', 10);
    try {
      const srcBytes = new Uint8Array(await file.arrayBuffer());
      const srcDoc = await loadPdfJs(srcBytes.slice());
      console.log('[compress] pages:', srcDoc.numPages);
      const outDoc = await PDFDocument.create();
      for (let i = 1; i <= srcDoc.numPages; i++) {
        setProgress('compress-progress', Math.round(i / srcDoc.numPages * 90) + 5);
        const page = await srcDoc.getPage(i);
        const viewport = page.getViewport({ scale: cfg.scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        console.log(`[compress] page ${i} rendered ${canvas.width}x${canvas.height}`);

        const jpg = await new Promise(res => canvas.toBlob(res, 'image/jpeg', cfg.quality));
        if (!jpg) { throw new Error(`page ${i}: canvas.toBlob returned null (canvas may be too large for this browser)`); }
        const jpgBytes = new Uint8Array(await jpg.arrayBuffer());
        if (jpgBytes.length < 100) { throw new Error(`page ${i}: rendered image was empty`); }
        const img = await outDoc.embedJpg(jpgBytes);
        const base = page.getViewport({ scale: 1 });
        const p = outDoc.addPage([base.width, base.height]);
        p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      }
      const outBytes = await outDoc.save();
      setProgress('compress-progress', 100);
      console.log('[compress] out bytes:', outBytes.length, 'vs src:', srcBytes.length);
      if (outBytes.length < 200) { setStatus('compress-status', 'error: output came out empty — please report this'); return; }
      const saved = (1 - outBytes.length / srcBytes.length) * 100;
      if (outBytes.length >= srcBytes.length) {
        setStatus('compress-status', `done, but this PDF was already efficient — output is not smaller. Try "Maximum". ✓`);
      } else {
        setStatus('compress-status', `done — ${formatBytes(srcBytes.length)} → ${formatBytes(outBytes.length)} (saved ${saved.toFixed(0)}%) ✓`);
      }
      downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '.compressed.pdf'));
    } catch (e) { console.error('[compress]', e); setStatus('compress-status', 'error: ' + e.message); }
    finally { setTimeout(() => setProgress('compress-progress', 0), 800); }
  };
})();

// =================================================================
// 10. PDF TO WORD (OCR) — text layer first, OCR fallback
// =================================================================
(function ocrTool() {
  const dz = document.getElementById('dz-ocr'), fi = document.getElementById('fi-ocr');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; checkSizeWarning(f, document.getElementById('sw-ocr')); setStatus('ocr-status', `loaded ${f.name}`); });
  document.getElementById('ocr-go').onclick = async () => {
    if (!file) return setStatus('ocr-status', 'select a PDF first');
    setStatus('ocr-status', 'reading document…');
    let worker = null;
    try {
      const pdfjsDoc = await loadPdfJs(new Uint8Array(await file.arrayBuffer()));
      const paragraphs = [];
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        setStatus('ocr-status', `processing page ${i} / ${pdfjsDoc.numPages}…`);
        setProgress('ocr-progress', Math.round((i - 1) / pdfjsDoc.numPages * 100));
        const page = await pdfjsDoc.getPage(i);
        const tc = await page.getTextContent();
        const hasText = tc.items.some(it => it.str && it.str.trim().length);
        if (hasText) {
          tc.items.map(it => it.str).join(' ').split(/\n\s*\n/).forEach(p => { if (p.trim()) paragraphs.push(new Paragraph({ children: [new TextRun({ text: p.trim() })] })); });
        } else {
          if (!worker) { const { createWorker } = await import('tesseract.js'); worker = await createWorker('eng'); }
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const { data: { text } } = await worker.recognize(canvas);
          text.split(/\n\s*\n/).forEach(p => { if (p.trim()) paragraphs.push(new Paragraph({ children: [new TextRun({ text: p.trim() })] })); });
        }
        if (i < pdfjsDoc.numPages) paragraphs.push(new Paragraph({ children: [] }));
      }
      if (worker) await worker.terminate();
      const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, file.name.replace(/\.pdf$/i, '.docx'));
      setProgress('ocr-progress', 100);
      setStatus('ocr-status', 'done — DOCX downloaded ✓');
    } catch (e) { console.error(e); if (worker) try { await worker.terminate(); } catch {} setStatus('ocr-status', 'error: ' + e.message); }
    finally { setTimeout(() => setProgress('ocr-progress', 0), 800); }
  };
})();

// =================================================================
// 11. PDF TO SCANNED  (new scales + live preview)
// =================================================================
(function scannedTool() {
  const dz = document.getElementById('dz-scanned'), fi = document.getElementById('fi-scanned');
  const dzSig = document.getElementById('dz-scanned-sig'), fiSig = document.getElementById('fi-scanned-sig');
  if (!dz) return;
  let file = null, sigFile = null, sigImg = null, srcPdf = null, srcBytes = null;

  // Read sliders and map the intuitive 0-based scales to internal effect values.
  function readSettings() {
    const grainPct = +document.getElementById('sc-grain').value;      // 0..100
    const skewDeg = +document.getElementById('sc-skew').value;         // 0..5
    const brightPct = +document.getElementById('sc-bright').value;     // -50..50
    const contrastPct = +document.getElementById('sc-contrast').value; // -50..50
    return {
      grain: grainPct * 0.6,                 // px noise amplitude
      skew: skewDeg,
      brightness: 1 + brightPct / 100,       // multiplier
      contrast: contrastPct / 100,           // -0.5..0.5 (0 = none)
      watermarkText: document.getElementById('sc-wm').value,
    };
  }
  function updateLabels() {
    document.getElementById('sc-grain-v').textContent = document.getElementById('sc-grain').value + '%';
    document.getElementById('sc-skew-v').textContent = document.getElementById('sc-skew').value + '°';
    const b = +document.getElementById('sc-bright').value;
    document.getElementById('sc-bright-v').textContent = (b >= 0 ? '+' : '') + b + '%';
    document.getElementById('sc-contrast-v').textContent = document.getElementById('sc-contrast').value;
  }

  function applyEffects(ctx, w, h, s, seededSkewSign) {
    const d = ctx.getImageData(0, 0, w, h); const px = d.data;
    const cf = (259 * (s.contrast * 255 + 255)) / (255 * (259 - s.contrast * 255));
    for (let i = 0; i < px.length; i += 4) {
      let g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      g = cf * (g - 128) + 128; g *= s.brightness; g += (Math.random() - 0.5) * s.grain;
      px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, g));
    }
    ctx.putImageData(d, 0, 0);
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  }

  // Render one page to a canvas with effects. skewSign fixed per page for determinism.
  async function renderScannedPage(page, scale, s, skewSign) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = viewport.width; canvas.height = viewport.height;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const skew = (s.skew || 0) * (Math.PI / 180) * skewSign;
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(skew); ctx.translate(-canvas.width / 2, -canvas.height / 2);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    applyEffects(ctx, canvas.width, canvas.height, s);
    if (sigImg) {
      const sw = canvas.width * 0.15, sh = (sigImg.height / sigImg.width) * sw;
      ctx.drawImage(sigImg, canvas.width - sw - 50, canvas.height - sh - 50, sw, sh);
    }
    if (s.watermarkText) {
      ctx.font = `bold ${Math.floor(canvas.width * 0.06)}px Arial`; ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.textAlign = 'center';
      ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-45 * Math.PI / 180); ctx.fillText(s.watermarkText, 0, 0); ctx.restore();
    }
    return { canvas, viewport };
  }

  let previewTimer = null;
  async function refreshPreview(immediate) {
    if (!srcPdf) return;
    clearTimeout(previewTimer);
    const run = async () => {
      try {
        const page = await srcPdf.getPage(1);
        const { canvas } = await renderScannedPage(page, 0.8, readSettings(), 1);
        const pv = document.getElementById('scanned-preview');
        pv.width = canvas.width; pv.height = canvas.height;
        pv.getContext('2d').drawImage(canvas, 0, 0);
        document.getElementById('scanned-preview-wrap').style.display = 'block';
        console.log('[scanned] preview drawn', canvas.width, canvas.height);
      } catch (e) { console.error('[scanned] preview error', e); }
    };
    if (immediate) return run();
    previewTimer = setTimeout(run, 120);
  }

  wireDropzone(dz, fi, async f => {
    file = f;
    setStatus('scanned-status', `loading ${f.name}…`);
    try {
      srcBytes = new Uint8Array(await f.arrayBuffer());
      srcPdf = await loadPdfJs(srcBytes.slice());
      console.log('[scanned] loaded, pages:', srcPdf.numPages);
      document.getElementById('scanned-preview-wrap').style.display = 'block';
      updateLabels();
      await refreshPreview(true);
      setStatus('scanned-status', `loaded — adjust sliders, preview updates live`);
    } catch (e) { console.error('[scanned]', e); setStatus('scanned-status', 'error loading PDF: ' + e.message); }
  });
  wireDropzone(dzSig, fiSig, async f => {
    sigFile = f;
    sigImg = new Image();
    await new Promise((res, rej) => { sigImg.onload = res; sigImg.onerror = rej; sigImg.src = URL.createObjectURL(f); });
    refreshPreview();
  });

  ['sc-grain', 'sc-skew', 'sc-bright', 'sc-contrast'].forEach(id =>
    document.getElementById(id).addEventListener('input', () => { updateLabels(); refreshPreview(); }));
  document.getElementById('sc-wm').addEventListener('input', refreshPreview);
  updateLabels();

  document.getElementById('scanned-go').onclick = async () => {
    if (!srcPdf) return setStatus('scanned-status', 'choose a base PDF first');
    setStatus('scanned-status', 'generating…');
    try {
      const s = readSettings();
      const outDoc = await PDFDocument.create();
      for (let i = 1; i <= srcPdf.numPages; i++) {
        setStatus('scanned-status', `rendering page ${i} / ${srcPdf.numPages}…`);
        const page = await srcPdf.getPage(i);
        const skewSign = (i % 2 === 0) ? 1 : -1;
        const { canvas } = await renderScannedPage(page, 2, s, skewSign);
        const jpg = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
        const img = await outDoc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        const base = page.getViewport({ scale: 1 });
        const np = outDoc.addPage([base.width, base.height]);
        np.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      }
      const bytes = await outDoc.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_scanned.pdf'));
      setStatus('scanned-status', 'done — scanned PDF downloaded ✓');
    } catch (e) { console.error(e); setStatus('scanned-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 12. IMAGE TO PDF
// =================================================================
(function imageToPdfTool() {
  const dz = document.getElementById('dz-img2pdf'), fi = document.getElementById('fi-img2pdf');
  const listEl = document.getElementById('img2pdf-list'), goBtn = document.getElementById('img2pdf-go');
  if (!dz) return;
  let images = [];
  fi.addEventListener('change', e => addFiles(e.target.files));
  dz.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  dz.addEventListener('dragover', e => e.preventDefault());
  dz.addEventListener('click', () => fi.click());
  function addFiles(fl) { for (const f of fl) if (/image\/(png|jpeg)/.test(f.type)) images.push(f); render(); }
  function render() {
    listEl.innerHTML = '';
    images.forEach((f, i) => {
      const el = document.createElement('div'); el.className = 'page-thumb';
      el.innerHTML = `<div class="pnum">${i + 1}</div><div style="font-size:9px;overflow:hidden;">${f.name}</div><button data-act="rm" style="font-size:10px;margin-top:4px;">✕</button>`;
      el.querySelector('[data-act=rm]').onclick = () => { images.splice(i, 1); render(); };
      listEl.appendChild(el);
    });
    goBtn.disabled = images.length === 0;
    setStatus('img2pdf-status', images.length ? `${images.length} image(s) ready` : 'add at least one image');
  }
  goBtn.onclick = async () => {
    setStatus('img2pdf-status', 'building PDF…');
    try {
      const pdfDoc = await PDFDocument.create();
      for (const f of images) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const embedded = f.type === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const pageW = 595.28, pageH = 841.89;
        const scale = Math.min(pageW / embedded.width, pageH / embedded.height, 1);
        const w = embedded.width * scale, h = embedded.height * scale;
        const page = pdfDoc.addPage([pageW, pageH]);
        page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
      }
      const bytes = await pdfDoc.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'images.pdf');
      setStatus('img2pdf-status', 'done — images.pdf downloaded ✓');
    } catch (e) { console.error(e); setStatus('img2pdf-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 13. WORD TO PDF  (robust: mammoth raw text → jsPDF, guards against blank)
// =================================================================
(function wordToPdfTool() {
  const dz = document.getElementById('dz-word2pdf'), fi = document.getElementById('fi-word2pdf');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('word2pdf-status', `loaded ${f.name}`); });
  document.getElementById('word2pdf-go').onclick = async () => {
    if (!file) return setStatus('word2pdf-status', 'select a .docx first');
    setStatus('word2pdf-status', 'reading document…');
    try {
      const buf = await file.arrayBuffer();

      // Primary: structured HTML (for headings/lists). Fallback: raw text.
      let htmlText = '', rawText = '';
      try { htmlText = (await mammoth.convertToHtml({ arrayBuffer: buf })).value || ''; } catch (e) { console.warn('convertToHtml failed', e); }
      try { rawText = (await mammoth.extractRawText({ arrayBuffer: buf })).value || ''; } catch (e) { console.warn('extractRawText failed', e); }

      // If BOTH are empty, do not produce a blank file — tell the user.
      if (!htmlText.trim() && !rawText.trim()) {
        setStatus('word2pdf-status', 'error: no readable text found in this .docx (is it empty, or an unusual format?)');
        return;
      }

      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 56;
      const maxW = pageW - margin * 2;
      let y = margin;

      function ensureSpace(lineH) { if (y + lineH > pageH - margin) { pdf.addPage(); y = margin; } }
      function writeBlock(text, { size = 11, bold = false, gapAfter = 6, indent = 0 } = {}) {
        if (!text || !text.trim()) { y += size * 0.5; return; }
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text.replace(/\s+/g, ' ').trim(), maxW - indent);
        const lineH = size * 1.4;
        for (const ln of lines) { ensureSpace(lineH); pdf.text(ln, margin + indent, y); y += lineH; }
        y += gapAfter;
      }

      let wroteSomething = false;
      // Try structured path first.
      if (htmlText.trim()) {
        const dom = new DOMParser().parseFromString(htmlText, 'text/html');
        const blocks = Array.from(dom.body.querySelectorAll('h1,h2,h3,h4,p,li,table'));
        if (blocks.length) {
          for (const el of blocks) {
            const tag = el.tagName.toLowerCase();
            const txt = (el.textContent || '').trim();
            if (!txt && tag !== 'table') continue;
            if (tag === 'h1') writeBlock(txt, { size: 20, bold: true, gapAfter: 10 });
            else if (tag === 'h2') writeBlock(txt, { size: 16, bold: true, gapAfter: 8 });
            else if (tag === 'h3' || tag === 'h4') writeBlock(txt, { size: 13, bold: true, gapAfter: 7 });
            else if (tag === 'li') writeBlock('•  ' + txt, { size: 11, gapAfter: 3, indent: 14 });
            else if (tag === 'table') {
              const rows = Array.from(el.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td,th')).map(c => c.textContent.trim()));
              if (rows.length) { autoTable(pdf, { startY: y, head: [rows[0]], body: rows.slice(1), margin: { left: margin, right: margin }, styles: { fontSize: 9 } }); y = pdf.lastAutoTable.finalY + 12; }
            } else writeBlock(txt, { size: 11, gapAfter: 6 });
            wroteSomething = true;
          }
        }
      }
      // Fallback: if structured path wrote nothing, dump raw text paragraphs.
      if (!wroteSomething) {
        const paras = rawText.split(/\n{2,}/);
        for (const p of paras) { if (p.trim()) { writeBlock(p, { size: 11, gapAfter: 6 }); wroteSomething = true; } }
        // last resort: single blob
        if (!wroteSomething && rawText.trim()) { writeBlock(rawText, { size: 11 }); wroteSomething = true; }
      }

      if (!wroteSomething) { setStatus('word2pdf-status', 'error: could not place any text on the page'); return; }

      pdf.save(file.name.replace(/\.docx$/i, '.pdf'));
      setStatus('word2pdf-status', 'done — PDF downloaded ✓');
    } catch (e) { console.error(e); setStatus('word2pdf-status', 'error: ' + e.message); }
  };
})();

// =================================================================
// 14. EXCEL TO PDF  (guarded + diagnostic)
// =================================================================
(function excelToPdfTool() {
  const dz = document.getElementById('dz-excel2pdf'), fi = document.getElementById('fi-excel2pdf');
  if (!dz) return;
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('excel2pdf-status', `loaded ${f.name}`); });
  document.getElementById('excel2pdf-go').onclick = async () => {
    if (!file) return setStatus('excel2pdf-status', 'select a spreadsheet first');
    setStatus('excel2pdf-status', 'reading spreadsheet…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      console.log('[excel2pdf] sheet names:', wb.SheetNames);

      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      let first = true, anyData = false;

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
        console.log(`[excel2pdf] sheet "${sheetName}" rows:`, rows.length);
        if (!rows.length) continue;

        if (!first) pdf.addPage();
        first = false;
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
        pdf.text(String(sheetName), 40, 40);

        const maxCols = Math.max(...rows.map(r => r.length), 1);
        const norm = rows.map(r => {
          const a = r.map(c => (c == null ? '' : String(c)));
          while (a.length < maxCols) a.push('');
          return a;
        });

        try {
          autoTable(pdf, {
            startY: 52,
            head: [norm[0]],
            body: norm.slice(1),
            margin: { left: 40, right: 40 },
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
            headStyles: { fillColor: [51, 65, 92] },
          });
          anyData = true;
        } catch (tblErr) {
          // Fallback if autotable misbehaves: write rows as plain text lines.
          console.warn('[excel2pdf] autoTable failed, using text fallback', tblErr);
          let y = 60;
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
          for (const row of norm) {
            const line = row.join('   |   ');
            const wrapped = pdf.splitTextToSize(line, pdf.internal.pageSize.getWidth() - 80);
            for (const ln of wrapped) { if (y > pdf.internal.pageSize.getHeight() - 40) { pdf.addPage(); y = 40; } pdf.text(ln, 40, y); y += 12; }
          }
          anyData = true;
        }
      }

      if (!anyData) { setStatus('excel2pdf-status', 'error: no data rows found in this file'); return; }
      pdf.save(file.name.replace(/\.(xlsx?|csv)$/i, '.pdf'));
      setStatus('excel2pdf-status', 'done — PDF downloaded ✓');
    } catch (e) { console.error('[excel2pdf]', e); setStatus('excel2pdf-status', 'error: ' + e.message); }
  };
})();
