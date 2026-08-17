// tools-core.js — the reliable tools, built only on pdf-lib + pdf.js rendering.
// Each registers itself; the framework isolates failures.

import { registerTool } from './toolkit.js';
import {
  PDFDocument, StandardFonts, rgb, degrees,
  savePdf, downloadBlob, formatBytes, readBytes,
  loadForEdit, loadForView, renderPage, wireFileInput, statusWriter,
} from './pdf-core.js';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt';
import { decryptPDF } from '@pdfsmaller/pdf-decrypt';

// ---------------------------------------------------------------- MERGE
registerTool('merge', (panel) => {
  const say = statusWriter(panel);
  const list = panel.querySelector('.file-list');
  const goBtn = panel.querySelector('.go');
  let files = [];

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), (fl) => {
    for (const f of fl) if (/\.pdf$/i.test(f.name)) files.push(f);
    render();
  });

  function render() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'filepill';
      row.innerHTML = `<span class="name">${i + 1}. ${f.name}</span><span class="size">${formatBytes(f.size)}</span>`;
      const up = mkBtn('↑', () => { if (i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; render(); } });
      const dn = mkBtn('↓', () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; render(); } });
      const rm = mkBtn('✕', () => { files.splice(i, 1); render(); });
      row.append(up, dn, rm);
      list.appendChild(row);
    });
    goBtn.disabled = files.length < 2;
    say(files.length < 2 ? 'Add at least two PDFs.' : `${files.length} PDFs ready to merge.`);
  }

  goBtn.addEventListener('click', async () => {
    try {
      say('Merging…');
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await loadForEdit(await readBytes(f));
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      }
      savePdf(await out.save(), 'merged.pdf');
      say(`Done — merged ${files.length} files. ✓`, 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- ORGANISE (reorder / delete / rotate)
registerTool('organise', (panel) => {
  const say = statusWriter(panel);
  const grid = panel.querySelector('.thumb-grid');
  const goBtn = panel.querySelector('.go');
  let bytes = null, viewDoc = null, pages = []; // {index, rotation, deleted}

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async (fl) => {
    try {
      say('Loading pages…');
      bytes = await readBytes(fl[0]);
      viewDoc = await loadForView(bytes);
      pages = Array.from({ length: viewDoc.numPages }, (_, i) => ({ index: i, rotation: 0, deleted: false }));
      await renderThumbs();
      goBtn.disabled = false;
      say(`${pages.length} pages loaded. Reorder, rotate or delete, then save.`, 'ok');
    } catch (e) { console.error(e); say('Failed to load: ' + e.message, 'error'); }
  });

  async function renderThumbs() {
    grid.innerHTML = '';
    for (let pos = 0; pos < pages.length; pos++) {
      const p = pages[pos];
      const cell = document.createElement('div');
      cell.className = 'thumb' + (p.deleted ? ' is-deleted' : '');
      const canvas = await renderPage(viewDoc, p.index + 1, 150);
      canvas.style.transform = `rotate(${p.rotation}deg)`;
      canvas.style.maxWidth = '100%';
      const holder = document.createElement('div');
      holder.className = 'thumb-img';
      holder.appendChild(canvas);
      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = `p${p.index + 1}${p.rotation ? ' · ' + p.rotation + '°' : ''}`;
      const bar = document.createElement('div');
      bar.className = 'thumb-bar';
      bar.append(
        mkBtn('←', () => { if (pos > 0) { swap(pos, pos - 1); } }),
        mkBtn('⟲', () => { p.rotation = (p.rotation - 90 + 360) % 360; renderThumbs(); }),
        mkBtn('⟳', () => { p.rotation = (p.rotation + 90) % 360; renderThumbs(); }),
        mkBtn(p.deleted ? '↺' : '✕', () => { p.deleted = !p.deleted; renderThumbs(); }),
        mkBtn('→', () => { if (pos < pages.length - 1) { swap(pos, pos + 1); } }),
      );
      cell.append(holder, label, bar);
      grid.appendChild(cell);
    }
  }
  function swap(a, b) { [pages[a], pages[b]] = [pages[b], pages[a]]; renderThumbs(); }

  goBtn.addEventListener('click', async () => {
    try {
      say('Saving…');
      const src = await loadForEdit(bytes);
      const out = await PDFDocument.create();
      const keep = pages.filter(p => !p.deleted);
      if (!keep.length) return say('Every page is deleted — nothing to save.', 'error');
      const copied = await out.copyPages(src, keep.map(p => p.index));
      copied.forEach((pg, i) => {
        const rot = keep[i].rotation;
        if (rot) pg.setRotation(degrees(rot));
        out.addPage(pg);
      });
      savePdf(await out.save(), 'organised.pdf');
      say(`Done — saved ${keep.length} pages. ✓`, 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- SPLIT
registerTool('split', (panel) => {
  const say = statusWriter(panel);
  const rangeInput = panel.querySelector('.ranges');
  const goBtn = panel.querySelector('.go');
  let bytes = null, pageCount = 0;

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async (fl) => {
    try {
      bytes = await readBytes(fl[0]);
      const doc = await loadForEdit(bytes);
      pageCount = doc.getPageCount();
      goBtn.disabled = false;
      say(`${pageCount} pages. Enter ranges like 1-3, 5, 8-10`, 'ok');
    } catch (e) { console.error(e); say('Failed to load: ' + e.message, 'error'); }
  });

  goBtn.addEventListener('click', async () => {
    try {
      const spec = (rangeInput.value || '').trim();
      if (!spec) return say('Enter at least one range, e.g. 1-3', 'error');
      const groups = spec.split(',').map(s => s.trim()).filter(Boolean);
      const src = await loadForEdit(bytes);
      let n = 0;
      for (const g of groups) {
        const m = g.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!m) { say(`Could not understand "${g}"`, 'error'); return; }
        const from = parseInt(m[1], 10), to = m[2] ? parseInt(m[2], 10) : from;
        if (from < 1 || to > pageCount || from > to) { say(`Range "${g}" is outside 1-${pageCount}`, 'error'); return; }
        const idx = [];
        for (let i = from; i <= to; i++) idx.push(i - 1);
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, idx);
        copied.forEach(p => out.addPage(p));
        savePdf(await out.save(), `split-${from}${to !== from ? '-' + to : ''}.pdf`);
        n++;
      }
      say(`Done — ${n} file(s) downloaded. ✓`, 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- ADD PASSWORD
registerTool('protect', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let file = null;
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    file = fl[0]; goBtn.disabled = false; say(`Loaded ${file.name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    try {
      const pw = panel.querySelector('.pw-user').value;
      if (!pw) return say('Enter a password first.', 'error');
      const owner = panel.querySelector('.pw-owner').value || undefined;
      say('Encrypting…');
      const bytes = await readBytes(file);
      const enc = owner ? await encryptPDF(bytes, pw, owner) : await encryptPDF(bytes, pw);
      savePdf(enc, file.name.replace(/\.pdf$/i, '_protected.pdf'));
      say('Done — protected file downloaded. Keep the password safe. ✓', 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- REMOVE PASSWORD
registerTool('unlock', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let file = null;
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    file = fl[0]; goBtn.disabled = false; say(`Loaded ${file.name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    try {
      const pw = panel.querySelector('.pw-current').value;
      say('Unlocking…');
      const dec = await decryptPDF(await readBytes(file), pw);
      savePdf(dec, file.name.replace(/\.pdf$/i, '_unlocked.pdf'));
      say('Done — unlocked file downloaded. ✓', 'ok');
    } catch (e) {
      console.error(e);
      say('Failed — wrong password, or this PDF uses encryption we cannot open.', 'error');
    }
  });
});

// ---------------------------------------------------------------- WATERMARK
registerTool('watermark', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let bytes = null, name = 'document.pdf';
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async fl => {
    bytes = await readBytes(fl[0]); name = fl[0].name; goBtn.disabled = false;
    say(`Loaded ${name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    try {
      const text = panel.querySelector('.wm-text').value.trim();
      if (!text) return say('Enter watermark text first.', 'error');
      const opacity = parseFloat(panel.querySelector('.wm-opacity').value) || 0.15;
      const size = parseInt(panel.querySelector('.wm-size').value, 10) || 48;
      say('Applying watermark…');
      const doc = await loadForEdit(bytes);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width / 2 - w / 2, y: height / 2,
          size, font, color: rgb(0.2, 0.2, 0.2), opacity, rotate: degrees(-45),
        });
      }
      savePdf(await doc.save(), name.replace(/\.pdf$/i, '_watermarked.pdf'));
      say('Done — watermarked PDF downloaded. ✓', 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- PAGE NUMBERS
registerTool('pagenumbers', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let bytes = null, name = 'document.pdf';
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async fl => {
    bytes = await readBytes(fl[0]); name = fl[0].name; goBtn.disabled = false;
    say(`Loaded ${name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    try {
      say('Numbering pages…');
      const pos = panel.querySelector('.pn-pos').value;
      const start = parseInt(panel.querySelector('.pn-start').value, 10) || 1;
      const doc = await loadForEdit(bytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.getPages().forEach((page, i) => {
        const label = String(start + i);
        const { width } = page.getSize();
        const w = font.widthOfTextAtSize(label, 10);
        const x = pos === 'left' ? 40 : pos === 'centre' ? width / 2 - w / 2 : width - w - 40;
        page.drawText(label, { x, y: 24, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
      });
      savePdf(await doc.save(), name.replace(/\.pdf$/i, '_numbered.pdf'));
      say('Done — numbered PDF downloaded. ✓', 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- SIGNATURE
registerTool('sign', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  const stage = panel.querySelector('.sign-stage');
  const pageHolder = panel.querySelector('.sign-page');
  const overlay = panel.querySelector('.sign-overlay');
  const pad = panel.querySelector('canvas.sig-pad');
  let bytes = null, name = 'document.pdf', viewDoc = null, pageNum = 1, sigDataUrl = null;
  let placed = { xFrac: 0.6, yFrac: 0.75, wFrac: 0.25 };

  // --- signature sources: draw / type / upload
  const pctx = pad.getContext('2d');
  pctx.lineWidth = 2.4; pctx.lineCap = 'round'; pctx.strokeStyle = '#1a1a1a';
  let drawing = false, lx = 0, ly = 0;
  const padPos = e => {
    const r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) };
  };
  pad.addEventListener('pointerdown', e => { drawing = true; pad.setPointerCapture(e.pointerId); const p = padPos(e); lx = p.x; ly = p.y; });
  pad.addEventListener('pointermove', e => {
    if (!drawing) return; const p = padPos(e);
    pctx.beginPath(); pctx.moveTo(lx, ly); pctx.lineTo(p.x, p.y); pctx.stroke(); lx = p.x; ly = p.y;
  });
  pad.addEventListener('pointerup', () => { drawing = false; });
  panel.querySelector('.sig-clear').addEventListener('click', () => pctx.clearRect(0, 0, pad.width, pad.height));
  panel.querySelector('.sig-use-draw').addEventListener('click', () => { sigDataUrl = pad.toDataURL('image/png'); afterSig(); });

  panel.querySelector('.sig-use-type').addEventListener('click', () => {
    const txt = panel.querySelector('.sig-type-text').value.trim() || 'Signature';
    const fam = panel.querySelector('.sig-font').value;
    const c = document.createElement('canvas'); c.width = 600; c.height = 200;
    const cx = c.getContext('2d');
    cx.fillStyle = '#1a1a1a'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = `72px ${fam}`;
    cx.fillText(txt, c.width / 2, c.height / 2);
    sigDataUrl = c.toDataURL('image/png'); afterSig();
  });

  wireFileInput(panel.querySelector('.dz-sig'), panel.querySelector('.fi-sig'), fl => {
    const r = new FileReader();
    r.onload = () => { sigDataUrl = r.result; afterSig(); };
    r.readAsDataURL(fl[0]);
  });

  function afterSig() {
    panel.querySelector('.sign-step2').style.display = 'block';
    say('Signature ready — now open the PDF you want to sign.', 'ok');
    paintOverlay();
  }

  // --- open the PDF and show a large page view
  wireFileInput(panel.querySelector('.dz-pdf'), panel.querySelector('.fi-pdf'), async fl => {
    try {
      bytes = await readBytes(fl[0]); name = fl[0].name;
      viewDoc = await loadForView(bytes);
      pageNum = 1;
      stage.style.display = 'block';
      await showPage();
      goBtn.disabled = false;
      say(`${viewDoc.numPages} pages. Drag the signature into place, then save.`, 'ok');
    } catch (e) { console.error(e); say('Failed to open PDF: ' + e.message, 'error'); }
  });

  async function showPage() {
    pageHolder.innerHTML = '';
    const canvas = await renderPage(viewDoc, pageNum, 640); // large, full-page view
    canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = 'auto';
    pageHolder.appendChild(canvas);
    panel.querySelector('.sign-pageinfo').textContent = `Page ${pageNum} / ${viewDoc.numPages}`;
    paintOverlay();
  }
  panel.querySelector('.sign-prev').addEventListener('click', async () => { if (pageNum > 1) { pageNum--; await showPage(); } });
  panel.querySelector('.sign-next').addEventListener('click', async () => { if (viewDoc && pageNum < viewDoc.numPages) { pageNum++; await showPage(); } });

  // --- draggable + resizable signature overlay
  function paintOverlay() {
    if (!sigDataUrl) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    overlay.style.backgroundImage = `url(${sigDataUrl})`;
    const host = pageHolder.getBoundingClientRect();
    const w = (host.width || 400) * placed.wFrac;
    overlay.style.width = w + 'px';
    overlay.style.height = (w * 0.33) + 'px';
    overlay.style.left = (host.width * placed.xFrac) + 'px';
    overlay.style.top = (host.height * placed.yFrac) + 'px';
  }
  let odrag = false, ox = 0, oy = 0, ol = 0, ot = 0;
  overlay.addEventListener('pointerdown', e => {
    odrag = true; overlay.setPointerCapture(e.pointerId);
    ox = e.clientX; oy = e.clientY; ol = overlay.offsetLeft; ot = overlay.offsetTop; e.preventDefault();
  });
  overlay.addEventListener('pointermove', e => {
    if (!odrag) return;
    const host = pageHolder.getBoundingClientRect();
    let nl = Math.max(0, Math.min(ol + (e.clientX - ox), host.width - overlay.offsetWidth));
    let nt = Math.max(0, Math.min(ot + (e.clientY - oy), host.height - overlay.offsetHeight));
    overlay.style.left = nl + 'px'; overlay.style.top = nt + 'px';
    placed.xFrac = nl / host.width; placed.yFrac = nt / host.height;
  });
  overlay.addEventListener('pointerup', () => { odrag = false; });

  const sizeSlider = panel.querySelector('.sig-size');
  sizeSlider.addEventListener('input', () => { placed.wFrac = parseInt(sizeSlider.value, 10) / 100; paintOverlay(); });

  goBtn.addEventListener('click', async () => {
    try {
      if (!sigDataUrl) return say('Create a signature first.', 'error');
      if (!bytes) return say('Open a PDF first.', 'error');
      say('Placing signature…');
      const doc = await loadForEdit(bytes);
      const raw = Uint8Array.from(atob(sigDataUrl.split(',')[1]), c => c.charCodeAt(0));
      const img = sigDataUrl.startsWith('data:image/jpeg') ? await doc.embedJpg(raw) : await doc.embedPng(raw);
      const page = doc.getPages()[pageNum - 1];
      const { width, height } = page.getSize();
      const w = width * placed.wFrac;
      const h = w * (img.height / img.width);
      page.drawImage(img, { x: placed.xFrac * width, y: height - placed.yFrac * height - h, width: w, height: h });
      savePdf(await doc.save(), name.replace(/\.pdf$/i, '_signed.pdf'));
      say('Done — signed PDF downloaded. ✓', 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- IMAGES → PDF
registerTool('img2pdf', (panel) => {
  const say = statusWriter(panel);
  const list = panel.querySelector('.file-list');
  const goBtn = panel.querySelector('.go');
  let imgs = [];
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    for (const f of fl) if (/^image\/(png|jpeg)$/.test(f.type)) imgs.push(f);
    render();
  });
  function render() {
    list.innerHTML = '';
    imgs.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'filepill';
      row.innerHTML = `<span class="name">${i + 1}. ${f.name}</span>`;
      row.append(
        mkBtn('↑', () => { if (i > 0) { [imgs[i - 1], imgs[i]] = [imgs[i], imgs[i - 1]]; render(); } }),
        mkBtn('↓', () => { if (i < imgs.length - 1) { [imgs[i + 1], imgs[i]] = [imgs[i], imgs[i + 1]]; render(); } }),
        mkBtn('✕', () => { imgs.splice(i, 1); render(); }),
      );
      list.appendChild(row);
    });
    goBtn.disabled = !imgs.length;
    say(imgs.length ? `${imgs.length} image(s) ready.` : 'Add one or more JPEG/PNG images.');
  }
  goBtn.addEventListener('click', async () => {
    try {
      say('Building PDF…');
      const doc = await PDFDocument.create();
      const fit = panel.querySelector('.img-fit').value; // a4 | actual
      for (const f of imgs) {
        const raw = await readBytes(f);
        const img = f.type === 'image/png' ? await doc.embedPng(raw) : await doc.embedJpg(raw);
        if (fit === 'actual') {
          const p = doc.addPage([img.width, img.height]);
          p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        } else {
          const PW = 595.28, PH = 841.89;
          const s = Math.min(PW / img.width, PH / img.height);
          const w = img.width * s, h = img.height * s;
          const p = doc.addPage([PW, PH]);
          p.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
        }
      }
      savePdf(await doc.save(), 'images.pdf');
      say(`Done — PDF with ${imgs.length} page(s). ✓`, 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- EXTRACT TEXT / MARKDOWN
registerTool('extract', (panel) => {
  const say = statusWriter(panel);
  const out = panel.querySelector('.extract-out');
  const pre = panel.querySelector('.extract-pre');
  let text = '', name = 'document';

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async fl => {
    try {
      name = fl[0].name.replace(/\.pdf$/i, '');
      say('Extracting text…');
      const doc = await loadForView(await readBytes(fl[0]));
      const asMd = panel.querySelector('.ex-md').checked;
      const parts = [];
      let emptyPages = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        say(`Reading page ${i} of ${doc.numPages}…`);
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        if (!tc.items.length) { emptyPages++; continue; }
        parts.push(asMd ? toMarkdown(tc) : tc.items.map(t => t.str).join(' '));
      }
      text = parts.join('\n\n');
      pre.textContent = text || '(no text found)';
      out.style.display = 'block';
      if (!text) say('No text layer found — this PDF is likely a scan (images only).', 'error');
      else say(`Done — extracted ${doc.numPages - emptyPages} of ${doc.numPages} pages. ✓`, 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });

  function toMarkdown(tc) {
    const lines = new Map(); const heights = [];
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      const h = Math.abs(it.transform[3]) || 10;
      heights.push(h);
      if (!lines.has(y)) lines.set(y, { h, parts: [] });
      lines.get(y).parts.push(it.str);
    }
    heights.sort((a, b) => a - b);
    const med = heights[Math.floor(heights.length / 2)] || 10;
    return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => {
      const t = l.parts.join('').replace(/\s+/g, ' ').trim();
      if (!t) return '';
      const r = l.h / med;
      return r >= 1.6 ? '# ' + t : r >= 1.3 ? '## ' + t : t;
    }).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  panel.querySelector('.extract-dl').addEventListener('click', () => {
    if (!text) return;
    const md = panel.querySelector('.ex-md').checked;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${name}.${md ? 'md' : 'txt'}`);
  });
});

// small helper
function mkBtn(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'mini'; b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
