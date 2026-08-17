// tools-extra.js — tools that depend on browser rendering/rasterising.
// These are the historically fragile ones, so they live apart from the core set
// and are labelled "experimental" in the UI. A failure here cannot break the core.

import { registerTool } from './toolkit.js';
import {
  PDFDocument, savePdf, formatBytes, readBytes,
  loadForEdit, loadForView, wireFileInput, statusWriter, pdfjsLib,
} from './pdf-core.js';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------- COMPRESS
registerTool('compress', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  const modeSel = panel.querySelector('.cmp-mode');
  const qualityRow = panel.querySelector('.cmp-quality-row');
  let file = null;

  function syncMode() {
    const raster = modeSel.value === 'raster';
    qualityRow.style.display = raster ? '' : 'none';
    panel.querySelector('.cmp-raster-note').style.display = raster ? '' : 'none';
  }
  modeSel.addEventListener('change', syncMode); syncMode();

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    file = fl[0]; goBtn.disabled = false;
    say(`Loaded ${file.name} (${formatBytes(file.size)})`, 'ok');
  });

  goBtn.addEventListener('click', async () => {
    try {
      const src = await readBytes(file);
      if (modeSel.value === 'keep') {
        say('Optimising (keeping text selectable)…');
        const doc = await loadForEdit(src);
        const out = await doc.save({ useObjectStreams: true });
        report(src, out, 'Text is still selectable.');
        return;
      }
      // rasterise
      const q = parseFloat(panel.querySelector('.cmp-quality').value);
      const scale = q >= 0.8 ? 2 : q >= 0.6 ? 1.5 : 1;
      say('Rasterising pages…');
      const view = await loadForView(src);
      const out = await PDFDocument.create();
      for (let i = 1; i <= view.numPages; i++) {
        say(`Page ${i} of ${view.numPages}…`);
        const page = await view.getPage(i);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
        if (!blob) throw new Error(`page ${i}: could not create image (page may be too large)`);
        const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const base = page.getViewport({ scale: 1 });
        const p = out.addPage([base.width, base.height]);
        p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      }
      report(src, await out.save(), 'Note: text is now part of the image, so it is no longer selectable.');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });

  function report(src, out, note) {
    const saved = (1 - out.length / src.length) * 100;
    savePdf(out, file.name.replace(/\.pdf$/i, '_compressed.pdf'));
    if (out.length >= src.length * 0.98) {
      say(`Done, but this PDF was already compact (no real reduction). ${note}`, 'ok');
    } else {
      say(`Done — ${formatBytes(src.length)} → ${formatBytes(out.length)}, saved ${saved.toFixed(0)}%. ${note}`, 'ok');
    }
  }
});

// ---------------------------------------------------------------- SCANNED LOOK
registerTool('scanned', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  const previewWrap = panel.querySelector('.scan-preview-wrap');
  const previewCanvas = panel.querySelector('.scan-preview');
  let bytes = null, name = 'document.pdf', view = null;

  const ctrls = {
    grain: panel.querySelector('.sc-grain'),
    skew: panel.querySelector('.sc-skew'),
    bright: panel.querySelector('.sc-bright'),
    contrast: panel.querySelector('.sc-contrast'),
  };

  function settings() {
    return {
      grain: parseInt(ctrls.grain.value, 10) * 0.6,
      skew: parseFloat(ctrls.skew.value),
      brightness: 1 + parseInt(ctrls.bright.value, 10) / 100,
      contrast: parseInt(ctrls.contrast.value, 10) / 100,
    };
  }
  function labels() {
    panel.querySelector('.v-grain').textContent = ctrls.grain.value + '%';
    panel.querySelector('.v-skew').textContent = ctrls.skew.value + '°';
    const b = parseInt(ctrls.bright.value, 10);
    panel.querySelector('.v-bright').textContent = (b >= 0 ? '+' : '') + b + '%';
    panel.querySelector('.v-contrast').textContent = ctrls.contrast.value;
  }

  async function renderScanned(pageNum, scale, s, sign) {
    const page = await view.getPage(pageNum);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const rad = (s.skew || 0) * Math.PI / 180 * sign;
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rad); ctx.translate(-c.width / 2, -c.height / 2);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // grayscale + contrast + brightness + grain
    const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
    const cf = (259 * (s.contrast * 255 + 255)) / (255 * (259 - s.contrast * 255));
    for (let i = 0; i < px.length; i += 4) {
      let g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      g = cf * (g - 128) + 128;
      g *= s.brightness;
      g += (Math.random() - 0.5) * s.grain;
      px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, g));
    }
    ctx.putImageData(d, 0, 0);
    return { canvas: c, page };
  }

  let t = null;
  function schedulePreview(now) {
    if (!view) return;
    clearTimeout(t);
    const run = async () => {
      try {
        const { canvas } = await renderScanned(1, 1.5, settings(), 1);
        previewCanvas.width = canvas.width; previewCanvas.height = canvas.height;
        previewCanvas.getContext('2d').drawImage(canvas, 0, 0);
        previewWrap.style.display = 'block';
      } catch (e) { console.error('[scanned] preview', e); }
    };
    now ? run() : (t = setTimeout(run, 150));
  }

  Object.values(ctrls).forEach(c => c.addEventListener('input', () => { labels(); schedulePreview(false); }));
  labels();

  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), async fl => {
    try {
      bytes = await readBytes(fl[0]); name = fl[0].name;
      view = await loadForView(bytes);
      goBtn.disabled = false;
      say('Loaded — adjust the sliders, the preview updates live.', 'ok');
      schedulePreview(true);
    } catch (e) { console.error(e); say('Failed to load: ' + e.message, 'error'); }
  });

  goBtn.addEventListener('click', async () => {
    try {
      const s = settings();
      const out = await PDFDocument.create();
      for (let i = 1; i <= view.numPages; i++) {
        say(`Rendering page ${i} of ${view.numPages}…`);
        const { canvas, page } = await renderScanned(i, 2, s, i % 2 ? -1 : 1);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
        if (!blob) throw new Error(`page ${i}: could not create image`);
        const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const base = page.getViewport({ scale: 1 });
        const p = out.addPage([base.width, base.height]);
        p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      }
      savePdf(await out.save(), name.replace(/\.pdf$/i, '_scanned.pdf'));
      say('Done — scanned-look PDF downloaded. ✓', 'ok');
    } catch (e) { console.error(e); say('Failed: ' + e.message, 'error'); }
  });
});

// ---------------------------------------------------------------- WORD → PDF
registerTool('word2pdf', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let file = null;
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    file = fl[0]; goBtn.disabled = false; say(`Loaded ${file.name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    let holder = null;
    try {
      say('Reading document…');
      const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const html = (res.value || '').trim();
      if (!html) return say('No readable content found in this .docx', 'error');

      say('Rendering…');
      // Must be rendered ON SCREEN — off-screen elements capture as blank.
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;';
      const page = document.createElement('div');
      page.style.cssText = 'width:794px;margin:0 auto;padding:64px 72px;box-sizing:border-box;background:#fff;color:#111;font-family:Georgia,serif;font-size:12pt;line-height:1.55;';
      page.innerHTML = html;
      page.querySelectorAll('h1').forEach(e => e.style.cssText = 'font-size:22pt;font-weight:700;margin:0 0 12px;');
      page.querySelectorAll('h2').forEach(e => e.style.cssText = 'font-size:17pt;font-weight:700;margin:18px 0 8px;');
      page.querySelectorAll('h3').forEach(e => e.style.cssText = 'font-size:14pt;font-weight:700;margin:14px 0 6px;');
      page.querySelectorAll('p').forEach(e => e.style.margin = '0 0 10px');
      page.querySelectorAll('ul,ol').forEach(e => { e.style.margin = '0 0 10px'; e.style.paddingLeft = '26px'; });
      page.querySelectorAll('table').forEach(e => { e.style.borderCollapse = 'collapse'; e.style.width = '100%'; e.style.margin = '10px 0 14px'; });
      page.querySelectorAll('td,th').forEach(e => { e.style.border = '1px solid #888'; e.style.padding = '5px 8px'; e.style.fontSize = '11pt'; });
      page.querySelectorAll('img').forEach(e => e.style.maxWidth = '100%');
      holder.appendChild(page);
      document.body.appendChild(holder);

      await new Promise(r => setTimeout(r, 80));
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} }

      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf().set({
        margin: [10, 10, 12, 10],
        filename: file.name.replace(/\.docx$/i, '.pdf'),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 794 },
        jsPDF: { unit: 'mm', format: 'a4' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(page).save();
      say('Done — PDF downloaded. ✓', 'ok');
    } catch (e) { console.error('[word2pdf]', e); say('Failed: ' + e.message, 'error'); }
    finally { if (holder?.parentNode) holder.parentNode.removeChild(holder); }
  });
});

// ---------------------------------------------------------------- EXCEL → PDF
registerTool('excel2pdf', (panel) => {
  const say = statusWriter(panel);
  const goBtn = panel.querySelector('.go');
  let file = null;
  wireFileInput(panel.querySelector('.dropzone'), panel.querySelector('input[type=file]'), fl => {
    file = fl[0]; goBtn.disabled = false; say(`Loaded ${file.name}`, 'ok');
  });
  goBtn.addEventListener('click', async () => {
    try {
      say('Reading spreadsheet…');
      const wb = XLSX.read(await readBytes(file), { type: 'array' });
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      let first = true, any = false;
      for (const sheet of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false, defval: '' });
        if (!rows.length) continue;
        if (!first) pdf.addPage();
        first = false;
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
        pdf.text(String(sheet), 40, 40);
        const cols = Math.max(...rows.map(r => r.length), 1);
        const norm = rows.map(r => { const a = r.map(c => c == null ? '' : String(c)); while (a.length < cols) a.push(''); return a; });
        autoTable(pdf, {
          startY: 54, head: [norm[0]], body: norm.slice(1),
          margin: { left: 40, right: 40 },
          styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
          headStyles: { fillColor: [51, 65, 92] },
        });
        any = true;
      }
      if (!any) return say('No data rows found in this file.', 'error');
      pdf.save(file.name.replace(/\.(xlsx?|csv)$/i, '.pdf'));
      say('Done — PDF downloaded. ✓', 'ok');
    } catch (e) { console.error('[excel2pdf]', e); say('Failed: ' + e.message, 'error'); }
  });
});
