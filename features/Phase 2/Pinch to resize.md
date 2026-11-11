---
status: planned
priority: medium
native: true
area: "Moving it"
---

Pinch on the window to resize it like macOS picture in picture, keeping its shape and docked corner.

> [!how] Plan
> Prototype on `backup-local-main` (7ba9a71, 2d85148). Chromium drops pinches when the page can't zoom, so `glass.node` watches for them natively on the top bar.

> [!todo] Left to do
> It was reverted from main once (cbb2031); find out why before bringing it back.
