# Paper

This directory contains the LaTeX sources for the Proactive AI paper and a vendored copy of the ACM `acmart` class required to build it reproducibly.

[中文说明](README.zh.md)

The manuscript and its illustrations have separate [licensing terms](LICENSE.md); the repository's Apache-2.0 software license does not automatically apply to them. Third-party ACM template files retain their original licenses.

## Manuscript

- `main.tex`: authoritative English paper source.
- `main_zh.tex`: complete Chinese LaTeX working manuscript, structurally aligned with `main.tex` for author revision and later synchronization back to English.
- `references.bib`: bibliography.

The working title is:

> Proactive AI: From Turns to Replannable Dialogue Timelines

The manuscript is maintained as a non-anonymous arXiv working preprint with Zijie Yang, Airalogy, Hangzhou, China, as the author and affiliation. Verify the final author list, ordering, ORCID information, and publication metadata before upload.

Build the English manuscript from the repository root with:

```bash
pnpm paper:build
```

Build the standalone Chinese manuscript with:

```bash
pnpm paper:build:zh
```

Build both local preview PDFs with:

```bash
pnpm paper:build:all
```

Figure 3 is rendered by the dedicated paper-figure route rather than captured from the general demo interface. Regenerate its vector PDF with:

```bash
pnpm paper:figure
```

Supplementary Figure 1 uses the same chat component and color palette. Export its four dialogue examples with:

```bash
pnpm paper:figure dialogue-patterns
```

Edit the examples in `apps/demo/app/figure/dialogue-patterns/examples.ts`; message rendering and common styles live in `apps/demo/app/figure/_components/`. The two manuscripts include the same English vector PDF, `paper/figures/dialogue-patterns.pdf`, with separate English and Chinese captions. After changing shared chat styles, regenerate both figures and rebuild the papers. The supplementary layout has a fixed width and content-driven height. The exporter waits for page content and fonts, measures the figure in print layout, and sets the PDF page to that size. Do not shorten dialogue or shrink its type to fit a fixed export height.

The command reuses the demo's existing React application and a locally installed Chrome or Chromium browser; it does not require an additional screenshot library. The rendering route is an internal authoring surface rather than part of the user-facing demo.

These daily build commands update only `paper/main.pdf` and `paper/main_zh.pdf`. Both targets run LaTeX and BibTeX through `latexmk`, verify that the bibliography exists, and fail if citations or cross-references remain unresolved. Running a single LaTeX pass is insufficient for a clean build with bibliography references. Both language targets compile isolated copies under `tmp/latex/`, so editor-generated `.aux` and `.bbl` files beside the sources cannot contaminate a build.

Create the stable, externally shareable filenames only when preparing an arXiv upload or another formal release:

```bash
pnpm paper:export
```

The export command first rebuilds both manuscripts, then writes `output/pdf/proactive-ai-from-turns-to-timelines.pdf` and `output/pdf/proactive-ai-from-turns-to-timelines-zh.pdf`. These release PDFs are ignored by Git and can be reproduced from the LaTeX sources.

## Figure style

The TikZ paper figures share `figures/figure-style.tex`. Use its semantic styles instead of defining fonts, colors, line widths, or message nodes inside an individual TikZ figure. The style deliberately uses `\sffamily` rather than naming a specific font, so those figures follow the active publication template. Under the current ACM template this resolves to Linux Biolinum, the sans-serif companion to the paper's Linux Libertine text face. Figure 3 and Supplementary Figure 1 use dedicated HTML/CSS routes, a shared message component, and a shared scoped chat stylesheet. Each route controls its page layout and print dimensions; both manuscript languages use the same exported figure assets.

The final-size typography hierarchy is 9 pt bold for panel titles, 8.25 pt for essential labels and content, 7.5 pt for secondary annotations, and 7 pt bold for compact avatars. Do not use `\tiny`, and do not shrink informative text to make a dense figure fit; simplify the figure or allocate more space instead. Mathematical notation should remain LaTeX math. Preserve the shared semantic palette and pair color with shape, line style, or symbols so meaning remains available in grayscale and to readers with color-vision differences. Keep final figures vector-based and verify that all fonts are embedded in the compiled PDF.

## ACM template

- Package: `acmart`
- Version: 2.19 (2026-06-27)
- Downloaded: 2026-07-31
- Production source: [CTAN](https://ctan.org/pkg/acmart)
- ACM template page: [ACM Primary Article Templates](https://www.acm.org/publications/proceedings-template)
- Download archive SHA-256: `5011d4a698b993ffd4c9a6a24cf4cde7dc9deb4a7ec2dc357dbbe4ec15085618`
- License: LaTeX Project Public License 1.3

The package README states that the production release is distributed through CTAN and ACM. The development repository is not used here.

The files used directly when compiling the paper are:

- `acmart.cls`
- `ACM-Reference-Format.bst`

The corresponding upstream sources are retained in `vendor/acm/` to preserve the original distribution and license terms. Do not modify the vendored files.

The English submission manuscript uses:

```tex
\documentclass[manuscript,nonacm]{acmart}
```

The manuscript is intentionally non-anonymous for public arXiv submission. `nonacm` keeps the preprint free of invented ACM publication metadata. Add `anonymous,review` only when preparing a later double-blind venue submission. For an accepted ACM proceedings paper, remove `nonacm` and switch to the format required by the venue, commonly `sigconf`.

The Chinese manuscript uses the same non-anonymous author identity and affiliation. The English source remains the authoritative arXiv submission manuscript.
