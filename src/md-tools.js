// md-tools.js — Markdown tool logic (Vite build, bundled imports).

import { downloadBlob, wireDropzone, wireToolNav, setStatus } from './shared.js';
import { marked } from 'marked';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import TurndownService from 'turndown';
import { initPdf2Md } from './pdf2md.js';

async function getHtml2Pdf() { const mod = await import('html2pdf.js'); return mod.default || mod; }

wireToolNav('.sidebar .stool', 'mobileToolSelect', 'panel-');
initPdf2Md();

// TO MARKDOWN (Word / Excel)
(function toMarkdownTool() {
  const dz = document.getElementById('dz-tomd'), fi = document.getElementById('fi-tomd');
  const outputWrap = document.getElementById('tomd-output'), preview = document.getElementById('tomd-preview');
  if (!dz) return;
  let currentMd = '', outName = '';
  wireDropzone(dz, fi, async (file) => {
    outName = file.name.replace(/\.[^.]+$/, '') + '.md';
    setStatus('tomd-status', 'converting…');
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.docx')) {
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        currentMd = new TurndownService().turndown(result.value);
      } else if (/\.(xlsx?|csv)$/.test(name)) {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (!rows.length) currentMd = '';
        else {
          const toLine = (cells) => '| ' + cells.map(c => String(c ?? '')).join(' | ') + ' |';
          currentMd = `${toLine(rows[0])}\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(toLine).join('\n')}`;
        }
      } else { return setStatus('tomd-status', 'unsupported — use .docx/.xlsx/.xls/.csv (PDFs use the box above)'); }
      preview.textContent = currentMd;
      outputWrap.style.display = 'block';
      setStatus('tomd-status', 'done — preview below');
    } catch (e) { console.error(e); setStatus('tomd-status', 'error: ' + e.message); }
  });
  document.getElementById('tomd-download').onclick = () => { if (currentMd) downloadBlob(new Blob([currentMd], { type: 'text/markdown' }), outName || 'output.md'); };
})();

// FROM MARKDOWN
(function fromMarkdownTool() {
  const input = document.getElementById('frommd-input'), preview = document.getElementById('frommd-preview');
  if (!input) return;
  const baseName = 'converted-document';
  function render() { preview.innerHTML = marked.parse(input.value); }
  input.addEventListener('input', render); render();

  // Upload a .md file → load into the textarea
  const uploadEl = document.getElementById('frommd-upload');
  if (uploadEl) uploadEl.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { input.value = reader.result; render(); setStatus('frommd-status', `loaded ${f.name}`); };
    reader.readAsText(f);
  });

  document.getElementById('frommd-html').onclick = () => {
    const htmlString = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>Markdown Export</title>\n<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;}code{background:#f4f4f4;padding:2px 5px;border-radius:3px;}pre{background:#f4f4f4;padding:15px;border-radius:5px;overflow-x:auto;}</style>\n</head>\n<body>\n${marked.parse(input.value)}\n</body>\n</html>`;
    downloadBlob(new Blob([htmlString], { type: 'text/html' }), `${baseName}.html`);
    setStatus('frommd-status', 'HTML downloaded ✓');
  };

  document.getElementById('frommd-docx').onclick = async () => {
    setStatus('frommd-status', 'generating DOCX…');
    try {
      const tokens = marked.lexer(input.value);
      const children = [];
      const inline = (toks) => {
        if (!toks) return [new TextRun({ text: '' })];
        const runs = [];
        for (const t of toks) {
          if (t.type === 'text') runs.push(new TextRun({ text: t.text }));
          else if (t.type === 'strong') runs.push(new TextRun({ text: t.text, bold: true }));
          else if (t.type === 'em') runs.push(new TextRun({ text: t.text, italics: true }));
          else if (t.type === 'codespan') runs.push(new TextRun({ text: t.text, font: 'Courier New' }));
        }
        return runs.length ? runs : [new TextRun({ text: '' })];
      };
      for (const token of tokens) {
        if (token.type === 'heading') {
          const level = token.depth === 1 ? HeadingLevel.HEADING_1 : token.depth === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
          children.push(new Paragraph({ heading: level, children: inline(token.tokens) }));
        } else if (token.type === 'paragraph') {
          children.push(new Paragraph({ children: inline(token.tokens) }));
        } else if (token.type === 'list') {
          token.items.forEach((item, i) => {
            const prefix = token.ordered ? `${i + 1}. ` : '• ';
            const runs = [new TextRun({ text: prefix })];
            if (item.tokens) item.tokens.forEach(st => { if (st.type === 'text') runs.push(new TextRun({ text: st.text })); else if (st.type === 'paragraph') runs.push(...inline(st.tokens)); });
            children.push(new Paragraph({ children: runs }));
          });
        } else if (token.type === 'code') {
          children.push(new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: token.text, font: 'Courier New', size: 20 })] }));
        }
      }
      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, `${baseName}.docx`);
      setStatus('frommd-status', 'DOCX downloaded ✓');
    } catch (e) { console.error(e); setStatus('frommd-status', 'error: ' + e.message); }
  };

  document.getElementById('frommd-pdf').onclick = async () => {
    setStatus('frommd-status', 'rendering PDF…');
    try {
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;padding:20mm;font-family:Arial,sans-serif;font-size:12pt;line-height:1.6;color:#000;';
      container.innerHTML = marked.parse(input.value);
      const style = document.createElement('style');
      style.textContent = `h1{font-size:24pt;margin-bottom:8pt;font-weight:bold;}h2{font-size:18pt;margin-bottom:6pt;font-weight:bold;}h3{font-size:14pt;margin-bottom:4pt;font-weight:bold;}p{margin-bottom:8pt;}ul,ol{margin-left:20pt;margin-bottom:8pt;}pre{background:#f4f4f4;padding:10pt;border-radius:4pt;font-size:10pt;}code{font-family:'Courier New',monospace;}blockquote{border-left:3px solid #ccc;padding-left:10pt;color:#555;}`;
      container.prepend(style);
      document.body.appendChild(container);
      const html2pdf = await getHtml2Pdf();
      await html2pdf().set({ margin: 0, filename: `${baseName}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save();
      document.body.removeChild(container);
      setStatus('frommd-status', 'PDF downloaded ✓');
    } catch (e) { console.error(e); setStatus('frommd-status', 'error: ' + e.message); }
  };
})();
