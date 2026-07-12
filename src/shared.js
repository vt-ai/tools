// shared.js — helpers reused across pages.

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'download';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function setStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = 'status: ' + text;
}

export function setProgress(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', pct > 0 && pct < 100);
  const fill = el.querySelector('.fill');
  if (fill) fill.style.width = pct + '%';
}

export function wireDropzone(dropzoneEl, inputEl, onFile) {
  if (!dropzoneEl || !inputEl) return;
  dropzoneEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onFile(f);
  });
  dropzoneEl.addEventListener('dragover', (e) => { e.preventDefault(); dropzoneEl.classList.add('drag'); });
  dropzoneEl.addEventListener('dragleave', () => dropzoneEl.classList.remove('drag'));
  dropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

export function checkSizeWarning(file, el, thresholdMB = 25) {
  if (!el) return;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const limit = thresholdMB * 1024 * 1024;
  if (file.size > limit) {
    el.textContent = isMobile
      ? `This file is ${formatBytes(file.size)} — large files can be slow or run out of memory on mobile browsers. Consider a desktop if it fails.`
      : `This file is ${formatBytes(file.size)} — processing may take a little longer.`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// Wires desktop sidebar buttons + mobile <select> to switch tool panels.
export function wireToolNav(sidebarSelector, mobileSelectId, panelPrefix, onChange) {
  const stools = Array.from(document.querySelectorAll(sidebarSelector));
  const select = document.getElementById(mobileSelectId);

  function activate(id) {
    stools.forEach(s => s.classList.toggle('active', s.dataset.tool === id));
    document.querySelectorAll('.tool-panel').forEach(p => {
      p.classList.toggle('active', p.id === panelPrefix + id);
    });
    if (select) select.value = id;
    if (onChange) onChange(id);
    window.scrollTo(0, 0);
  }

  stools.forEach(s => s.addEventListener('click', () => activate(s.dataset.tool)));
  if (select) select.addEventListener('change', () => activate(select.value));

  const initial = document.querySelector(sidebarSelector + '.active') || stools[0];
  if (initial) activate(initial.dataset.tool);
}
