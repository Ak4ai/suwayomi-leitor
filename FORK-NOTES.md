# IHC Manga Reader Prototype

This repository is a academic fork of the upstream Suwayomi-WebUI, intended as the starting point for the IHC project prototype.

## Project direction

The prototype will explore translated manga/comics with optional text-to-speech for readers who do not know the source language and, as a separate population or later phase, readers with low literacy.

## Upstream

- Repository: https://github.com/Suwayomi/Suwayomi-WebUI
- Upstream remote: `upstream`
- License: see `LICENSE`

## Planned first increment

1. Keep upstream reading/navigation behavior available.
2. Add an experimental reader panel for source text, Portuguese translation, and speech playback.
3. Start with a small, controlled page set and manually checked OCR/translation data.
4. Evaluate in browser first, then check Android and iOS browsers.

An English OCR experiment is now available in `public/ocr/`. Run `npm run ocr:dev` and see `OCR.md`. Translation and native-reader integration are available; see README.md for current capabilities and limitations.

A comparison lab is available through `npm run ocr:compare`. See `OCR-COMPARISON.md` for local pretrained detectors, cloud adapters, external imports and evaluation limits.

Published fork: https://github.com/Ak4ai/suwayomi-leitor . The `origin` remote points to this fork; the default development branch is `ihc-leitor-traducao`.
