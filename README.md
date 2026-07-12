# My Tools (v2 — Vite build)

Free, 100% client-side PDF and Markdown tools. Every tool runs in the visitor's
browser; no file is ever uploaded to a server. This version uses a **Vite build
step**, which is what makes all the libraries (encryption, OCR, DOCX generation,
etc.) load reliably — the previous no-build version failed because those libraries
can't be loaded straight from a CDN in the browser.

## What's in here

```
mytools-vite/
├── index.html            Home page
├── pdf-tools.html         PDF tools page (15 tools)
├── md-tools.html          Markdown tools page
├── src/
│   ├── style.css          All styling
│   ├── shared.js          Shared helpers
│   ├── pdf-tools.js       PDF tool logic
│   ├── md-tools.js        Markdown tool logic
│   └── pdf2md.js          Native PDF→Markdown converter (no more LiteDoc iframe)
├── public/
│   ├── CNAME              Your domain (already set to tools.mymf.in)
│   ├── robots.txt
│   └── sitemap.xml
├── .github/workflows/deploy.yml   Auto-build-and-deploy on push
├── vite.config.js
└── package.json
```

## The ONE thing you must do before it works: fix deployment

GitHub Pages cannot run `npm run build` on its own from a plain branch — that's why
this version ships with a GitHub Actions workflow that builds the site for you. You
need to switch your repo from "deploy from a branch" to "deploy via Actions":

1. Push all these files to your repo (replacing the old ones).
2. In your repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**
   (change it from "Deploy from a branch").
3. That's it. Every `git push` to `main` now auto-builds and deploys.
   The first deploy takes ~2 minutes; watch it under the repo's **Actions** tab.

If you skip step 2, the site will still show the OLD version (or break), because the
raw source files here are not directly servable — they must be built first.

## The other thing: GoatCounter code

Every page still has the placeholder `data-goatcounter="https://MYCODE.goatcounter.com/count"`.
Replace `MYCODE` with your real GoatCounter site code across all three HTML files.

## What changed from the broken version

- **The whole JS layer now actually loads.** The old version imported npm packages
  directly from a CDN (`.../+esm`); several of those packages assume a bundler and
  broke on the first import, which took down every tool at once (that's why "nothing
  responded"). Everything is now bundled by Vite, verified with a real production build.
- **Header nav** is now bold + serif (Source Serif 4), with the current page underlined.
- **PDF → Markdown no longer uses a LiteDoc iframe.** It's a native converter built on
  pdf.js text extraction: it detects headings by font size and automatically runs OCR
  on scanned pages that have no text layer. Same look and feel as every other tool.
- **Sidebar / mobile dropdown** tool switching is wired up and working; clicking a tool
  now actually swaps the panel.

## Local development

```
npm install
npm run dev      # live preview at localhost:5173
npm run build    # production build into dist/
npm run preview  # preview the production build locally
```

## Honest notes / limitations

- **Remove Watermark** is best-effort: it detects an image stamp repeated identically
  on every page and removes the reference to it. It can't strip a watermark baked into
  a scanned/rasterized page. Test on your own documents.
- **Signature / annotation placement** uses percentage sliders with a live preview
  overlay rather than freehand drag-resize-rotate — this is deliberately more robust
  across mouse and touch.
- **OCR and very large PDFs** are heavier on phones than laptops; there's a size warning
  built into the heavier tools. Small/medium files are fine on mobile.
- I was not able to run a full click-through browser test in my build environment
  (headless Chromium download was blocked), so while the production build compiles
  cleanly and all DOM references are verified to exist, please do a quick pass through
  the tools after the first deploy and flag anything that errors — the browser console
  will show a clear message for anything that needs a fix.
```
