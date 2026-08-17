// pdf-tools.js — entry point for the PDF Tools page.

import { initAllTools } from './toolkit.js';
import './tools-core.js';   // registers the reliable tools
import './tools-extra.js';  // registers the experimental tools

function wireNav() {
  const buttons = Array.from(document.querySelectorAll('.sidebar .stool'));
  const select = document.getElementById('toolSelect');
  const panels = Array.from(document.querySelectorAll('.tool-panel'));

  function activate(id) {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
    if (select && select.value !== id) select.value = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    window.scrollTo(0, 0);
  }

  buttons.forEach(b => b.addEventListener('click', () => activate(b.dataset.tool)));
  if (select) select.addEventListener('change', () => activate(select.value));

  const fromHash = location.hash.slice(1);
  const valid = buttons.some(b => b.dataset.tool === fromHash);
  activate(valid ? fromHash : (buttons[0] && buttons[0].dataset.tool));
}

function boot() {
  try { wireNav(); } catch (e) { console.error('[nav]', e); }
  initAllTools();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
