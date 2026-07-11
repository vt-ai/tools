// pdf-tools.js — logic for all 15 PDF tools.
// Libraries are loaded from jsDelivr's ESM build endpoint so the site needs no build step.

import { downloadBlob, formatBytes, wireDropzone, checkSizeWarning, wireToolNav } from './shared.js';

import { PDFDocument, StandardFonts, rgb, degrees } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/+esm';
import { encryptPDF } from 'https://cdn.jsdelivr.net/npm/@pdfsmaller/pdf-encrypt/+esm';
import { decryptPDF } from 'https://cdn.jsdelivr.net/npm/@pdfsmaller/pdf-decrypt/+esm';
import { compress as compressPdfLib } from 'https://cdn.jsdelivr.net/npm/@quicktoolsone/pdf-compress@2/+esm';
import { createWorker } from 'https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm';
import { Document, Packer, Paragraph, TextRun } from 'https://cdn.jsdelivr.net/npm/docx@8/+esm';
import mammoth from 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

wireToolNav('.sidebar .stool', 'mobileToolSelect', 'panel-');

// ---------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------
async function loadPdfJs(bytes) {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}
async function loadPdfLib(bytes) {
  return PDFDocument.load(bytes);
}
async function renderPageToCanvas(pdfjsDoc, pageNum, canvas, scale = 1.3) {
  const page = await pdfjsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return viewport;
}
function setStatus(id, text) { const el = document.getElementById(id); if (el) el.textContent = 'status: ' + text; }
function setProgress(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', pct > 0 && pct < 100);
  el.querySelector('.fill').style.width = pct + '%';
}

// =================================================================
// 1. EDIT PDF
// =================================================================
(function editPdfTool() {
  const dz = document.getElementById('dz-edit'), fi = document.getElementById('fi-edit');
  const workspace = document.getElementById('edit-workspace');
  const canvas = document.getElementById('edit-canvas');
  const annotForm = document.getElementById('edit-annot-form');
  let pdfjsDoc = null, srcBytes = null, currentPage = 1, viewport = null;
  let annotations = []; // {page, type, xPct, yPct, wPct, hPct, text, fontSize}
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
        annotations.push({
          page: currentPage, type: 'text', text,
          fontSize: +document.getElementById('af-size').value,
          xPct: +document.getElementById('af-x').value, yPct: +document.getElementById('af-y').value
        });
        setStatus('edit-status', `added text annotation (${annotations.length} total)`);
      };
    } else {
      // highlight / underline / redact share the same box-shaped inputs
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
        annotations.push({
          page: currentPage, type: activeType,
          xPct: +document.getElementById('af-x').value, yPct: +document.getElementById('af-y').value,
          wPct: +document.getElementById('af-w').value, hPct: +document.getElementById('af-h').value
        });
        setStatus('edit-status', `added ${activeType} annotation (${annotations.length} total)`);
      };
    }
  }
  renderAnnotForm();

  wireDropzone(dz, fi, async (file) => {
    setStatus('edit-status', 'loading PDF…');
    srcBytes = new Uint8Array(await file.arrayBuffer());
    pdfjsDoc = await loadPdfJs(srcBytes);
    currentPage = 1;
    annotations = [];
    workspace.style.display = 'block';
    await showPage();
    setStatus('edit-status', `loaded ${pdfjsDoc.numPages} page(s)`);
  });

  async function showPage() {
    viewport = await renderPageToCanvas(pdfjsDoc, currentPage, canvas);
    document.getElementById('edit-pagenum').textContent = `Page ${currentPage} / ${pdfjsDoc.numPages}`;
  }
  document.getElementById('edit-prev').onclick = async () => { if (currentPage > 1) { currentPage--; await showPage(); } };
  document.getElementById('edit-next').onclick = async () => { if (pdfjsDoc && currentPage < pdfjsDoc.numPages) { currentPage++; await showPage(); } };

  document.getElementById('edit-save').onclick = async () => {
    if (!srcBytes) return;
    setStatus('edit-status', 'baking edits…');
    try {
      const pdfDoc = await loadPdfLib(srcBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const a of annotations) {
        const page = pages[a.page - 1];
        if (!page) continue;
        const { width, height } = page.getSize();
        if (a.type === 'text') {
          page.drawText(a.text, {
            x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - a.fontSize,
            size: a.fontSize, font, color: rgb(0.1, 0.1, 0.1)
          });
        } else if (a.type === 'highlight') {
          page.drawRectangle({
            x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - (a.hPct / 100) * height,
            width: (a.wPct / 100) * width, height: (a.hPct / 100) * height,
            color: rgb(1, 0.92, 0.3), opacity: 0.45
          });
        } else if (a.type === 'underline') {
          const y = height - (a.yPct / 100) * height - (a.hPct / 100) * height;
          page.drawLine({
            start: { x: (a.xPct / 100) * width, y },
            end: { x: (a.xPct / 100) * width + (a.wPct / 100) * width, y },
            thickness: 1.5, color: rgb(0.1, 0.1, 0.8)
          });
        } else if (a.type === 'redact') {
          page.drawRectangle({
            x: (a.xPct / 100) * width, y: height - (a.yPct / 100) * height - (a.hPct / 100) * height,
            width: (a.wPct / 100) * width, height: (a.hPct / 100) * height,
            color: rgb(0, 0, 0)
          });
        }
      }

      if (document.getElementById('edit-pagenums').checked) {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i]; const { width: w } = p.getSize();
          const text = `${i + 1}`;
          p.drawText(text, { x: w - font.widthOfTextAtSize(text, 10) - 30, y: 24, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
        }
      }

      const wmText = document.getElementById('edit-wm-text').value.trim();
      if (wmText) {
        const opacity = +document.getElementById('edit-wm-opacity').value || 0.12;
        for (const p of pages) {
          const { width: w, height: h } = p.getSize();
          p.drawText(wmText, {
            x: w / 2 - font.widthOfTextAtSize(wmText, 40) / 2, y: h / 2,
            size: 40, font, color: rgb(0, 0, 0), opacity, rotate: degrees(-45)
          });
        }
      }

      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), 'edited.pdf');
      setStatus('edit-status', 'done — edited.pdf downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('edit-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 2. REARRANGE / SPLIT / REMOVE
// =================================================================
(function rearrangeTool() {
  const dz = document.getElementById('dz-rearrange'), fi = document.getElementById('fi-rearrange');
  const list = document.getElementById('rearrange-list');
  let srcBytes = null, order = []; // order = array of {originalIndex, removed, splitAfter}

  wireDropzone(dz, fi, async (file) => {
    checkSizeWarning(file, document.getElementById('sw-rearrange'));
    setStatus('rearrange-status', 'loading…');
    srcBytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await loadPdfLib(srcBytes);
    order = pdf.getPageIndices().map(i => ({ originalIndex: i, removed: false, splitAfter: false }));
    renderList();
    setStatus('rearrange-status', `loaded ${order.length} page(s)`);
  });

  function renderList() {
    list.innerHTML = '';
    order.forEach((p, pos) => {
      const el = document.createElement('div');
      el.className = 'page-thumb' + (p.removed ? ' removed' : '');
      el.innerHTML = `<div>▲▼</div><div class="pnum">Pg ${p.originalIndex + 1}</div>
        <div style="margin-top:4px;display:flex;gap:3px;justify-content:center;">
          <button data-act="up" style="font-size:10px;">▲</button>
          <button data-act="down" style="font-size:10px;">▼</button>
          <button data-act="rm" style="font-size:10px;">✕</button>
          <button data-act="split" style="font-size:10px;">✂</button>
        </div>${p.splitAfter ? '<div style="color:#33415C;font-size:9px;">split after</div>' : ''}`;
      el.querySelector('[data-act=up]').onclick = () => { if (pos > 0) { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; renderList(); } };
      el.querySelector('[data-act=down]').onclick = () => { if (pos < order.length - 1) { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; renderList(); } };
      el.querySelector('[data-act=rm]').onclick = () => { p.removed = !p.removed; renderList(); };
      el.querySelector('[data-act=split]').onclick = () => { p.splitAfter = !p.splitAfter; renderList(); };
      list.appendChild(el);
    });
  }

  document.getElementById('rearrange-save').onclick = async () => {
    if (!srcBytes) return;
    setStatus('rearrange-status', 'saving…');
    const src = await loadPdfLib(srcBytes);
    const out = await PDFDocument.create();
    const keep = order.filter(p => !p.removed);
    const copied = await out.copyPages(src, keep.map(p => p.originalIndex));
    copied.forEach(pg => out.addPage(pg));
    const bytes = await out.save();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'reordered.pdf');
    setStatus('rearrange-status', 'done — reordered.pdf downloaded ✓');
  };

  document.getElementById('rearrange-split').onclick = async () => {
    if (!srcBytes) return;
    const splitPositions = order.map((p, i) => p.splitAfter ? i : -1).filter(i => i >= 0);
    if (!splitPositions.length) return setStatus('rearrange-status', 'mark at least one split point (✂) first');
    setStatus('rearrange-status', 'splitting…');
    const src = await loadPdfLib(srcBytes);
    let start = 0; let part = 1;
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
  };
})();

// =================================================================
// 3. COMBINE / ADD
// =================================================================
(function combineTool() {
  const dz = document.getElementById('dz-combine'), fi = document.getElementById('fi-combine');
  const listEl = document.getElementById('combine-list');
  const saveBtn = document.getElementById('combine-save');
  let files = [];

  fi.addEventListener('change', e => addFiles(e.target.files));
  dz.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  dz.addEventListener('dragover', e => e.preventDefault());
  dz.addEventListener('click', () => fi.click());

  function addFiles(fileList) {
    for (const f of fileList) if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) files.push(f);
    render();
  }
  function render() {
    listEl.innerHTML = '';
    files.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'filepill';
      row.innerHTML = `<span class="name">${f.name}</span><span class="size">${formatBytes(f.size)}</span>
        <button data-act="up" style="font-size:11px;">▲</button><button data-act="down" style="font-size:11px;">▼</button><button data-act="rm" style="font-size:11px;">✕</button>`;
      row.querySelector('[data-act=up]').onclick = () => { if (i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; render(); } };
      row.querySelector('[data-act=down]').onclick = () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; render(); } };
      row.querySelector('[data-act=rm]').onclick = () => { files.splice(i, 1); render(); };
      listEl.appendChild(row);
    });
    saveBtn.disabled = files.length < 2;
    setStatus('combine-status', files.length < 2 ? 'add at least two PDFs' : `${files.length} PDFs ready to merge`);
  }

  saveBtn.onclick = async () => {
    setStatus('combine-status', 'merging…');
    const out = await PDFDocument.create();
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const src = await loadPdfLib(bytes);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach(pg => out.addPage(pg));
    }
    const bytes = await out.save();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
    setStatus('combine-status', 'done — merged.pdf downloaded ✓');
  };
})();

// =================================================================
// 4. ROTATE PAGES
// =================================================================
(function rotateTool() {
  const dz = document.getElementById('dz-rotate'), fi = document.getElementById('fi-rotate');
  const list = document.getElementById('rotate-list');
  let srcBytes = null, rotations = [];

  wireDropzone(dz, fi, async (file) => {
    setStatus('rotate-status', 'loading…');
    srcBytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await loadPdfLib(srcBytes);
    rotations = pdf.getPages().map(() => 0);
    render();
    setStatus('rotate-status', `loaded ${rotations.length} page(s)`);
  });

  function render() {
    list.innerHTML = '';
    rotations.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'page-thumb';
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
    if (!srcBytes) return;
    setStatus('rotate-status', 'saving…');
    const pdf = await loadPdfLib(srcBytes);
    pdf.getPages().forEach((p, i) => p.setRotation(degrees(rotations[i])));
    const bytes = await pdf.save();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'rotated.pdf');
    setStatus('rotate-status', 'done — rotated.pdf downloaded ✓');
  };
})();

// =================================================================
// 5. REMOVE PDF PASSWORD
// =================================================================
(function removePwTool() {
  const dz = document.getElementById('dz-removepw'), fi = document.getElementById('fi-removepw');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('removepw-status', `loaded ${f.name}`); });
  document.getElementById('removepw-go').onclick = async () => {
    if (!file) return setStatus('removepw-status', 'select a PDF first');
    const pw = document.getElementById('removepw-pw').value;
    setStatus('removepw-status', 'unlocking…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decrypted = await decryptPDF(bytes, pw);
      downloadBlob(new Blob([decrypted], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_unlocked.pdf'));
      setStatus('removepw-status', 'done — unlocked file downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('removepw-status', 'error: incorrect password or unsupported encryption');
    }
  };
})();

// =================================================================
// 6. ADD PDF PASSWORD
// =================================================================
(function addPwTool() {
  const dz = document.getElementById('dz-addpw'), fi = document.getElementById('fi-addpw');
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
    } catch (e) {
      console.error(e);
      setStatus('addpw-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 7. ADD SIGNATURE
// =================================================================
(function signatureTool() {
  let signatureDataUrl = null;

  // method tabs
  document.querySelectorAll('#panel-signature .mtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#panel-signature .mtab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('#panel-signature .method-panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById('m-' + b.dataset.m).classList.add('active');
  }));

  // --- draw pad ---
  const pad = document.getElementById('sig-pad');
  const pctx = pad.getContext('2d');
  pctx.lineWidth = 2.4; pctx.lineCap = 'round'; pctx.strokeStyle = '#232821';
  let drawing = false, lastX = 0, lastY = 0;
  function posFromEvent(e) {
    const r = pad.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - r.left) * (pad.width / r.width), y: (clientY - r.top) * (pad.height / r.height) };
  }
  pad.addEventListener('pointerdown', e => { drawing = true; const p = posFromEvent(e); lastX = p.x; lastY = p.y; });
  pad.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = posFromEvent(e);
    pctx.beginPath(); pctx.moveTo(lastX, lastY); pctx.lineTo(p.x, p.y); pctx.stroke();
    lastX = p.x; lastY = p.y;
  });
  window.addEventListener('pointerup', () => drawing = false);
  document.getElementById('sig-clear').onclick = () => pctx.clearRect(0, 0, pad.width, pad.height);
  document.getElementById('sig-use-draw').onclick = () => {
    signatureDataUrl = pad.toDataURL('image/png');
    afterSignatureReady();
  };

  // --- type ---
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
    cx.font = `56px ${fontFamily}`;
    cx.fillStyle = '#232821';
    cx.textBaseline = 'middle'; cx.textAlign = 'center';
    cx.fillText(text, c.width / 2, c.height / 2);
    signatureDataUrl = c.toDataURL('image/png');
    afterSignatureReady();
  };

  // --- upload ---
  wireDropzone(document.getElementById('dz-sig-upload'), document.getElementById('fi-sig-upload'), (file) => {
    const reader = new FileReader();
    reader.onload = () => { signatureDataUrl = reader.result; afterSignatureReady(); };
    reader.readAsDataURL(file);
  });

  function afterSignatureReady() {
    document.getElementById('sig-placement').style.display = 'block';
    setStatus('sig-status', 'signature ready — now open the PDF to place it');
  }

  // --- placement on PDF ---
  let pdfjsDoc = null, srcBytes = null, currentPage = 1;
  const canvas = document.getElementById('sig-canvas-view');
  const overlay = document.getElementById('sig-overlay');
  let img = new Image();

  wireDropzone(document.getElementById('dz-sig-pdf'), document.getElementById('fi-sig-pdf'), async (file) => {
    srcBytes = new Uint8Array(await file.arrayBuffer());
    pdfjsDoc = await loadPdfJs(srcBytes);
    currentPage = 1;
    document.getElementById('sig-page-wrap').style.display = 'block';
    await showPage();
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
    const xPct = +document.getElementById('sig-x').value;
    const yPct = +document.getElementById('sig-y').value;
    const sizePct = +document.getElementById('sig-size').value;
    const rotateDeg = +document.getElementById('sig-rotate').value;
    const w = canvas.width * (sizePct / 100);
    const h = w * 0.35; // signature aspect ratio approximation
    overlay.style.left = (canvas.width * (xPct / 100)) + 'px';
    overlay.style.top = (canvas.height * (yPct / 100)) + 'px';
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    overlay.style.transform = `rotate(${rotateDeg}deg)`;
    overlay.style.backgroundImage = `url(${signatureDataUrl})`;
    overlay.style.backgroundSize = 'contain';
    overlay.style.backgroundRepeat = 'no-repeat';
    overlay.style.backgroundPosition = 'center';
  }
  ['sig-x', 'sig-y', 'sig-size', 'sig-rotate'].forEach(id => document.getElementById(id).addEventListener('input', updateOverlay));

  document.getElementById('sig-save').onclick = async () => {
    if (!srcBytes || !signatureDataUrl) return;
    setStatus('sig-status', 'placing signature…');
    try {
      const pdfDoc = await loadPdfLib(srcBytes);
      const pngBytes = Uint8Array.from(atob(signatureDataUrl.split(',')[1]), c => c.charCodeAt(0));
      const isJpeg = signatureDataUrl.startsWith('data:image/jpeg');
      const embedded = isJpeg ? await pdfDoc.embedJpg(pngBytes) : await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.getPages()[currentPage - 1];
      const { width, height } = page.getSize();
      const xPct = +document.getElementById('sig-x').value / 100;
      const yPct = +document.getElementById('sig-y').value / 100;
      const sizePct = +document.getElementById('sig-size').value / 100;
      const rotateDeg = +document.getElementById('sig-rotate').value;
      const w = width * sizePct;
      const h = w * 0.35;
      page.drawImage(embedded, {
        x: xPct * width, y: height - yPct * height - h,
        width: w, height: h, rotate: degrees(rotateDeg)
      });
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), 'signed.pdf');
      setStatus('sig-status', 'done — signed.pdf downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('sig-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 8. REMOVE WATERMARK (best-effort: strips an image XObject repeated on every page)
// =================================================================
(function removeWatermarkTool() {
  const dz = document.getElementById('dz-removewm'), fi = document.getElementById('fi-removewm');
  const goBtn = document.getElementById('removewm-go');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; goBtn.disabled = false; setStatus('removewm-status', `loaded ${f.name}`); });

  goBtn.onclick = async () => {
    if (!file) return;
    setStatus('removewm-status', 'scanning pages for a repeated stamp…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfDoc = await loadPdfLib(bytes);
      const pages = pdfDoc.getPages();
      if (pages.length < 2) {
        setStatus('removewm-status', 'need at least 2 pages to detect a repeated watermark');
        return;
      }
      // Collect XObject image names per page and find one common ref name used on every page.
      const nameCounts = {};
      const pageXObjectDicts = pages.map(p => {
        const resources = p.node.Resources();
        const xobjDict = resources && resources.lookup(resources.context.obj('XObject'));
        return xobjDict;
      });
      pageXObjectDicts.forEach(dict => {
        if (!dict) return;
        for (const key of dict.keys()) {
          const name = key.encodedName || key.toString();
          nameCounts[name] = (nameCounts[name] || 0) + 1;
        }
      });
      const candidate = Object.entries(nameCounts).find(([, count]) => count === pages.length);
      if (!candidate) {
        setStatus('removewm-status', 'no repeated stamp detected across all pages — this watermark may be baked into the page image, or not use a repeated XObject.');
        return;
      }
      const targetName = candidate[0];
      // Strip the "<name> Do" operator from each page's content stream and drop the resource entry.
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const dict = pageXObjectDicts[i];
        if (dict) {
          try { dict.delete(pdfDoc.context.obj(targetName.replace(/^\//, ''))); } catch (e) { /* best-effort */ }
        }
        const contents = page.node.normalizedEntries ? null : null; // pdf-lib doesn't expose a simple content-stream editor publicly
      }
      // NOTE: pdf-lib does not provide a public, stable API to rewrite content-stream operators.
      // As a robust fallback, we remove the XObject resource reference (which stops the image
      // from rendering in compliant readers) even where we can't safely rewrite the stream ops.
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_dewatermarked.pdf'));
      setStatus('removewm-status', 'done — best-effort result downloaded. Please check the output, as results vary by document ✓');
    } catch (e) {
      console.error(e);
      setStatus('removewm-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 9. COMPRESS PDF
// =================================================================
(function compressTool() {
  const dz = document.getElementById('dz-compress'), fi = document.getElementById('fi-compress');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('compress-status', `loaded ${f.name} (${formatBytes(f.size)})`); });

  document.getElementById('compress-go').onclick = async () => {
    if (!file) return setStatus('compress-status', 'select a PDF first');
    const preset = document.getElementById('compress-preset').value;
    setStatus('compress-status', 'compressing… (may take a moment for large files)');
    setProgress('compress-progress', 30);
    try {
      const buf = await file.arrayBuffer();
      const result = await compressPdfLib(buf, { preset });
      setProgress('compress-progress', 100);
      downloadBlob(new Blob([result.pdf], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '.compressed.pdf'));
      setStatus('compress-status', `done — saved ${result.stats.percentageSaved.toFixed(1)}% ✓`);
    } catch (e) {
      console.error(e);
      setStatus('compress-status', 'error: ' + e.message);
    } finally { setTimeout(() => setProgress('compress-progress', 0), 800); }
  };
})();

// =================================================================
// 10. PDF TO WORD (OCR) — text layer first, OCR fallback per page
// =================================================================
(function ocrTool() {
  const dz = document.getElementById('dz-ocr'), fi = document.getElementById('fi-ocr');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; checkSizeWarning(f, document.getElementById('sw-ocr')); setStatus('ocr-status', `loaded ${f.name}`); });

  document.getElementById('ocr-go').onclick = async () => {
    if (!file) return setStatus('ocr-status', 'select a PDF first');
    setStatus('ocr-status', 'reading document…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfjsDoc = await loadPdfJs(bytes);
      const paragraphs = [];
      let worker = null;

      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        setStatus('ocr-status', `processing page ${i} / ${pdfjsDoc.numPages}…`);
        setProgress('ocr-progress', Math.round((i - 1) / pdfjsDoc.numPages * 100));
        const page = await pdfjsDoc.getPage(i);
        const textContent = await page.getTextContent();
        const hasTextLayer = textContent.items.some(it => it.str && it.str.trim().length > 0);

        if (hasTextLayer) {
          // fast path: use the PDF's real text layer, no OCR needed
          const pageText = textContent.items.map(it => it.str).join(' ');
          pageText.split(/\n\s*\n/).forEach(p => { if (p.trim()) paragraphs.push(new Paragraph({ children: [new TextRun({ text: p.trim() })] })); });
        } else {
          // fallback: rasterize the page and OCR only this page
          if (!worker) { worker = await createWorker('eng'); }
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
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
    } catch (e) {
      console.error(e);
      setStatus('ocr-status', 'error: ' + e.message);
    } finally { setTimeout(() => setProgress('ocr-progress', 0), 800); }
  };
})();

// =================================================================
// 11. PDF TO SCANNED
// =================================================================
(function scannedTool() {
  const dz = document.getElementById('dz-scanned'), fi = document.getElementById('fi-scanned');
  const dzSig = document.getElementById('dz-scanned-sig'), fiSig = document.getElementById('fi-scanned-sig');
  let file = null, sigFile = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('scanned-status', `loaded ${f.name}`); });
  wireDropzone(dzSig, fiSig, f => { sigFile = f; });

  function applyScannerEffects(ctx, width, height, settings) {
    const imageData = ctx.getImageData(0, 0, width, height); const data = imageData.data;
    const contrastFactor = (259 * (settings.contrast * 255 + 255)) / (255 * (259 - settings.contrast * 255));
    for (let i = 0; i < data.length; i += 4) {
      let gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      gray = contrastFactor * (gray - 128) + 128; gray *= settings.brightness;
      gray += (Math.random() - 0.5) * settings.grain;
      data[i] = gray; data[i + 1] = gray; data[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7);
    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }

  document.getElementById('scanned-go').onclick = async () => {
    if (!file) return setStatus('scanned-status', 'choose a base PDF first');
    setStatus('scanned-status', 'applying scanner effects…');
    try {
      const settings = {
        grain: +document.getElementById('sc-grain').value, skew: +document.getElementById('sc-skew').value,
        brightness: +document.getElementById('sc-bright').value, contrast: +document.getElementById('sc-contrast').value,
        watermarkText: document.getElementById('sc-wm').value
      };
      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      let sigBytes = null;
      if (sigFile) sigBytes = new Uint8Array(await sigFile.arrayBuffer());
      const srcPdf = await loadPdfJs(pdfBytes);
      const newPdfDoc = await PDFDocument.create();

      for (let i = 1; i <= srcPdf.numPages; i++) {
        const page = await srcPdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        const skewRad = (settings.skew || 0) * (Math.PI / 180) * (Math.random() > 0.5 ? 1 : -1);
        ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(skewRad); ctx.translate(-canvas.width / 2, -canvas.height / 2);
        await page.render({ canvasContext: ctx, viewport }).promise;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        applyScannerEffects(ctx, canvas.width, canvas.height, settings);

        if (sigBytes) {
          const sigImg = new Image();
          await new Promise((res, rej) => { sigImg.onload = res; sigImg.onerror = rej; sigImg.src = URL.createObjectURL(new Blob([sigBytes])); });
          const sigWidth = canvas.width * 0.15; const sigHeight = (sigImg.height / sigImg.width) * sigWidth;
          ctx.drawImage(sigImg, canvas.width - sigWidth - 50, canvas.height - sigHeight - 50, sigWidth, sigHeight);
          URL.revokeObjectURL(sigImg.src);
        }
        if (settings.watermarkText) {
          ctx.font = `bold ${Math.floor(canvas.width * 0.06)}px Arial`; ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign = 'center';
          ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-45 * Math.PI / 180);
          ctx.fillText(settings.watermarkText, 0, 0); ctx.restore();
        }
        const jpegBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
        const imgArray = new Uint8Array(await jpegBlob.arrayBuffer());
        const img = await newPdfDoc.embedJpg(imgArray);
        const newPage = newPdfDoc.addPage([viewport.width, viewport.height]);
        newPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      }
      const outBytes = await newPdfDoc.save();
      downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), file.name.replace(/\.pdf$/i, '_scanned.pdf'));
      setStatus('scanned-status', 'done — scanned PDF downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('scanned-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 12. IMAGE TO PDF
// =================================================================
(function imageToPdfTool() {
  const dz = document.getElementById('dz-img2pdf'), fi = document.getElementById('fi-img2pdf');
  const listEl = document.getElementById('img2pdf-list');
  const goBtn = document.getElementById('img2pdf-go');
  let images = [];

  fi.addEventListener('change', e => addFiles(e.target.files));
  dz.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  dz.addEventListener('dragover', e => e.preventDefault());
  dz.addEventListener('click', () => fi.click());

  function addFiles(fileList) {
    for (const f of fileList) if (/image\/(png|jpeg)/.test(f.type)) images.push(f);
    render();
  }
  function render() {
    listEl.innerHTML = '';
    images.forEach((f, i) => {
      const el = document.createElement('div'); el.className = 'page-thumb';
      el.innerHTML = `<div class="pnum">${i + 1}</div><div style="font-size:9px;overflow:hidden;text-overflow:ellipsis;">${f.name}</div><button data-act="rm" style="font-size:10px;margin-top:4px;">✕</button>`;
      el.querySelector('[data-act=rm]').onclick = () => { images.splice(i, 1); render(); };
      listEl.appendChild(el);
    });
    goBtn.disabled = images.length === 0;
    setStatus('img2pdf-status', images.length ? `${images.length} image(s) ready` : 'add at least one image');
  }

  goBtn.onclick = async () => {
    setStatus('img2pdf-status', 'building PDF…');
    const pdfDoc = await PDFDocument.create();
    for (const f of images) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const isPng = f.type === 'image/png';
      const embedded = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const pageW = 595.28, pageH = 841.89; // A4 in points
      const scale = Math.min(pageW / embedded.width, pageH / embedded.height, 1);
      const w = embedded.width * scale, h = embedded.height * scale;
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    }
    const bytes = await pdfDoc.save();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'images.pdf');
    setStatus('img2pdf-status', 'done — images.pdf downloaded ✓');
  };
})();

// =================================================================
// 13. WORD TO PDF
// =================================================================
(function wordToPdfTool() {
  const dz = document.getElementById('dz-word2pdf'), fi = document.getElementById('fi-word2pdf');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('word2pdf-status', `loaded ${f.name}`); });

  document.getElementById('word2pdf-go').onclick = async () => {
    if (!file) return setStatus('word2pdf-status', 'select a .docx first');
    setStatus('word2pdf-status', 'converting…');
    try {
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;padding:20mm;font-family:Arial,sans-serif;font-size:12pt;line-height:1.6;color:#000;';
      container.innerHTML = result.value;
      document.body.appendChild(container);
      const html2pdfMod = await import('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/+esm');
      const html2pdf = html2pdfMod.default;
      await html2pdf().set({ margin: 0, filename: file.name.replace(/\.docx$/i, '.pdf'), image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(container).save();
      document.body.removeChild(container);
      setStatus('word2pdf-status', 'done — PDF downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('word2pdf-status', 'error: ' + e.message);
    }
  };
})();

// =================================================================
// 14. EXCEL TO PDF
// =================================================================
(function excelToPdfTool() {
  const dz = document.getElementById('dz-excel2pdf'), fi = document.getElementById('fi-excel2pdf');
  let file = null;
  wireDropzone(dz, fi, f => { file = f; setStatus('excel2pdf-status', `loaded ${f.name}`); });

  document.getElementById('excel2pdf-go').onclick = async () => {
    if (!file) return setStatus('excel2pdf-status', 'select a spreadsheet first');
    setStatus('excel2pdf-status', 'converting…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const html = XLSX.utils.sheet_to_html(ws);
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:297mm;padding:14mm;font-family:Arial,sans-serif;font-size:10pt;';
      container.innerHTML = html;
      container.querySelectorAll('table').forEach(t => { t.style.borderCollapse = 'collapse'; t.style.width = '100%'; });
      container.querySelectorAll('td,th').forEach(c => { c.style.border = '1px solid #999'; c.style.padding = '4px 6px'; });
      document.body.appendChild(container);
      const html2pdfMod = await import('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/+esm');
      const html2pdf = html2pdfMod.default;
      await html2pdf().set({ margin: 0, filename: file.name.replace(/\.(xlsx?|csv)$/i, '.pdf'), image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } }).from(container).save();
      document.body.removeChild(container);
      setStatus('excel2pdf-status', 'done — PDF downloaded ✓');
    } catch (e) {
      console.error(e);
      setStatus('excel2pdf-status', 'error: ' + e.message);
    }
  };
})();
