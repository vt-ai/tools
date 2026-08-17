// toolkit.js — the framework every PDF tool is built on.
//
// WHY THIS EXISTS: previously all tools were wired up in one long sequence, so if
// any single tool threw an error while setting up, every tool after it silently
// never got wired. Here each tool is registered and initialised inside its own
// try/catch, so a failure is contained to that one tool AND reported on screen.

const registry = [];
const failures = [];

export function registerTool(id, setupFn) {
  registry.push({ id, setupFn });
}

export function initAllTools() {
  for (const { id, setupFn } of registry) {
    const panel = document.getElementById('panel-' + id);
    if (!panel) { continue; } // tool's panel isn't on this page — skip quietly
    try {
      setupFn(panel);
    } catch (err) {
      console.error(`[tool:${id}] setup failed`, err);
      failures.push({ id, message: err && err.message ? err.message : String(err) });
      showToolBroken(panel, id, err);
    }
  }
  renderDiagnostics();
}

// Replace a broken tool's UI with an honest message instead of a dead panel.
function showToolBroken(panel, id, err) {
  const note = document.createElement('div');
  note.className = 'note-box amber';
  note.style.marginBottom = '14px';
  note.innerHTML = `<div><b>This tool failed to load.</b><br>
    <span style="font-family:var(--font-mono);font-size:11px;">${id}: ${(err && err.message) || err}</span><br>
    Other tools are unaffected. Please report this message.</div>`;
  panel.prepend(note);
}

// A small always-visible health line so problems are obvious without the console.
function renderDiagnostics() {
  const host = document.getElementById('tool-health');
  if (!host) return;
  if (!failures.length) {
    host.innerHTML = `<span style="color:var(--moss);">✓ All ${registry.length} tools loaded</span>`;
  } else {
    host.innerHTML = `<span style="color:#8a3b3b;">⚠ ${failures.length} of ${registry.length} tools failed to load: ` +
      failures.map(f => f.id).join(', ') + `</span>`;
  }
}

export function getFailures() { return failures.slice(); }
