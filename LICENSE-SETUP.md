# How to add the GPL-3.0 license to this repo

You've chosen **GPL-3.0** (strong copyleft): people can use, study, modify, and
redistribute the code, but any redistributed version — modified or not — must also
be released under GPL-3.0 with source available. That matches your goal: "reuse
freely, but must keep it open-source if they redistribute."

There are two parts: (1) the LICENSE file containing the full legal text, and
(2) small notices you author. Do them in this order.

---

## Part 1 — The LICENSE file (let GitHub insert it — don't hand-type it)

The GPL-3.0 legal text is ~674 lines and must be **byte-for-byte identical** to the
official version — a stray typo can technically invalidate it. So don't paste it
from anywhere unofficial. Use GitHub's built-in inserter, which drops in the exact
FSF-published text:

1. On GitHub, go to your repo's main page.
2. Click **Add file → Create new file**.
3. Name the file exactly: `LICENSE` (no extension).
4. A button appears on the right: **Choose a license template**. Click it.
5. Select **GNU General Public License v3.0**.
6. On the right, fill in the year (2026) and your full name (or "VT" / your
   organization name, whatever you want on record as the copyright holder).
7. Click **Review and submit**, then **Commit changes**.

That's it — GitHub writes the complete, correct LICENSE file for you, and the repo
sidebar will now show a "GPL-3.0" badge.

> If you prefer to do it locally instead of on github.com: download the official
> text from https://www.gnu.org/licenses/gpl-3.0.txt , save it as a file named
> `LICENSE` in the repo root, and commit. Same result.

---

## Part 2 — Add the copyright + notice files you author

These two short files are yours to include — copy them from this folder into the
repo root:

- `COPYRIGHT` — the one-line copyright + license pointer.
- `NOTICE.md` — a plain-English summary of what the license means (courtesy, not
  legally required, but helpful for visitors).

Edit the placeholder name/year in `COPYRIGHT` before committing.

---

## Part 3 — (optional) per-file header

The FSF recommends a short header at the top of each source file. It's optional and
many projects skip it, but if you want it, add this comment block to the top of each
`.js` file (adjust the name):

    /*
     * My Tools — private, client-side PDF & Markdown utilities
     * Copyright (C) 2026  <your name>
     *
     * This program is free software: you can redistribute it and/or modify
     * it under the terms of the GNU General Public License as published by
     * the Free Software Foundation, either version 3 of the License, or
     * (at your option) any later version.
     *
     * This program is distributed in the hope that it will be useful,
     * but WITHOUT ANY WARRANTY; without even the implied warranty of
     * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
     * GNU General Public License for more details.
     *
     * You should have received a copy of the GNU General Public License
     * along with this program.  If not, see <https://www.gnu.org/licenses/>.
     */

---

## One caveat worth knowing (bundled dependencies)

Your site bundles other open-source libraries (pdf-lib, pdf.js, Tesseract.js,
mammoth, SheetJS, docx, etc.). Those keep their own licenses — GPL-3.0 covers *your*
code, not theirs. All the libraries you're using are permissively licensed (MIT /
Apache-2.0 / BSD), which are GPL-compatible, so there's no conflict. You don't need
to do anything about them beyond not stripping their own license headers, which the
build already preserves.

## If you ever reconsider: AGPL-3.0

Because your tool is a hosted web app, the one gap GPL-3.0 leaves is that someone
could host a *modified* version as a website without publishing their changes (GPL's
copyleft triggers on distributing code, not on running it as a service). AGPL-3.0
closes that gap. For a 100%-client-side tool it matters less (the full source is
already delivered to every visitor's browser), which is why GPL-3.0 is the sensible
default here — but if that gap bothers you, pick "GNU Affero General Public License
v3.0" in the same GitHub license picker instead.
