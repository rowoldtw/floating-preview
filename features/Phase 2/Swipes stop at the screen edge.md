---
status: planned
priority: high
native: false
area: "Moving it"
---

Swiping the window to a screen's edge stops it there instead of losing it.

> [!how] Plan
> Prototype on `backup-local-main` (919b77a). The cursor rides on the window during a swipe but can't leave the screens, so the window stops where the cursor would. The window's clock also survives a failed step.
