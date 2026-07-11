# My Tools

Free, 100% client-side PDF and Markdown tools. No build step, no npm, no server —
every file here is served as-is by GitHub Pages, and every library is loaded from
jsDelivr's CDN at runtime, directly in the visitor's browser.

## Files

```
my-tools/
├── index.html          Home page
├── pdf-tools.html       15 PDF tools (sidebar on desktop, dropdown on mobile)
├── pdf-tools.js         All PDF tool logic
├── md-tools.html        2 Markdown tools
├── md-tools.js          All Markdown tool logic
├── shared.js            Helpers used by both (download, dropzone wiring, etc.)
├── style.css            All styling for every page
├── litedoc.html          ⚠️ placeholder — see "One manual step" below
├── robots.txt
├── sitemap.xml
├── CNAME                Your custom domain (edit this)
└── README.md            This file
```

## One manual step: LiteDoc

Everything in this repo works out of the box **except** the PDF → Markdown engine
embedded on the PDF Tools and Markdown Tools pages. That one piece, LiteDoc, is a
single self-contained HTML file too large to hand-write here, and it must be
downloaded once from its own repo:

1. Go to https://github.com/0xovo/LiteDoc/releases
2. Download the `index.html` asset from the latest release
3. Rename it to `litedoc.html` and replace the placeholder at the root of this repo

It's 100% local/browser-based like everything else here — no server calls.

## Before you go live

- **CNAME**: edit the `CNAME` file to your actual domain.
- **Canonical URLs / sitemap / Open Graph**: every `.html` file has a
  `https://tools.yourdomain.com/...` URL hardcoded in its `<head>` — find-and-replace
  `tools.yourdomain.com` with your real domain across all files.
- **GoatCounter**: every page has `data-goatcounter="https://MYCODE.goatcounter.com/count"`
  — replace `MYCODE` with your actual GoatCounter site code across all files.

## Deploying

No build step needed. Push to GitHub, then in the repo:
**Settings → Pages → Source → Deploy from a branch → `main` / `(root)`**.

That's it — no GitHub Actions workflow, no `npm install`, no `dist` folder.

## Design decisions worth knowing about

A few places where I chose the more robust option over the more elaborate one,
given this needs to work reliably on both desktop and mobile with no build tooling
to catch bugs before they ship:

- **Placing a signature or an Edit PDF annotation** uses percentage-based sliders
  (X%, Y%, size%) with a live preview overlay, rather than freehand drag/resize/rotate
  on the canvas. This is deliberately simpler and works identically with mouse or touch —
  freehand drag-resize-rotate is one of the most bug-prone things to hand-build correctly
  across devices, and sliders are just as fast to use for one-off placements.
- **Remove Watermark** is genuinely best-effort: it detects an image stamp that repeats
  identically across every page and removes the resource reference to it. It can't
  reliably strip a watermark that's baked into a rasterized/scanned page, and pdf-lib
  doesn't expose a fully public API for rewriting content-stream operators, so the
  removal is closer to "hide the resource" than a guaranteed clean strip. Test on a
  few of your own real documents before relying on it.
- **Reordering pages/files** uses ▲▼ buttons rather than drag-and-drop — this is
  actually the more mobile-friendly choice, since native HTML5 drag-and-drop barely
  works on touchscreens.
- **PDF to Word (OCR)** checks each page for a real text layer first and only runs
  OCR (slow) on pages that are scanned images — this avoids the original design's
  mistake of OCR-ing every page regardless of whether it already had selectable text.

## A note on mobile performance

Every tool here runs in pure JavaScript/WebAssembly, so it works on mobile Safari
and Chrome with no special support needed. The one real caveat: OCR and large-file
processing are heavier on a phone's CPU/RAM than a laptop's, and iOS Safari in
particular has a stricter memory ceiling. Small-to-medium files (the vast majority
of real use) are fine; very large scanned PDFs run through OCR may be slow or fail
on older phones — there's a size warning built in on the heavier tools to flag this
before it happens silently.
