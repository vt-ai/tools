// shared.js — helpers reused by pdf-tools.js and md-tools.js

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

// Wires a dropzone element + hidden file input together with drag/drop and click-to-browse.
// onFile receives the selected File.
export function wireDropzone(dropzoneEl, inputEl, onFile) {
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

// Shows a size warning note if the file exceeds thresholdMB (mobile devices especially).
export function checkSizeWarning(file, el, thresholdMB = 25) {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const limit = thresholdMB * 1024 * 1024;
  if (file.size > limit) {
    el.textContent = isMobile
      ? `This file is ${formatBytes(file.size)} — large files can be slow or run out of memory on mobile browsers. Consider trying on a desktop if this fails.`
      : `This file is ${formatBytes(file.size)} — processing may take a little longer.`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// Syncs the mobile <select> nav with the desktop sidebar buttons: clicking either
// activates the same tool panel.
export function wireToolNav(sidebarSelector, mobileSelectId, panelPrefix, onChange) {
  const stools = document.querySelectorAll(sidebarSelector);
  const select = document.getElementById(mobileSelectId);

  function activate(id) {
    stools.forEach(s => s.classList.toggle('active', s.dataset.tool === id));
    document.querySelectorAll('.tool-panel').forEach(p => {
      p.classList.toggle('active', p.id === panelPrefix + id);
    });
    if (select) select.value = id;
    if (onChange) onChange(id);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  stools.forEach(s => s.addEventListener('click', () => activate(s.dataset.tool)));
  if (select) select.addEventListener('change', () => activate(select.value));

  // activate whichever is marked active by default
  const initial = document.querySelector(sidebarSelector + '.active');
  if (initial) activate(initial.dataset.tool);
}
