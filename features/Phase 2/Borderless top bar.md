---
status: in-progress
priority: high
native: false
area: Chrome
---

No traffic lights: the menu sits in the top bar's left corner and the close button in the right.

> [!use] Using it
> Move the cursor to the top of the preview: the bar grows in with More options (⋯) at its left corner and close (×) at its right.

> [!how] How it works
> `main.js` hides the window's traffic lights with `setWindowButtonVisibility(false)`, so this no longer depends on another plugin hiding every window's buttons. `addCloseButton` adds × at the end of the view's actions and moves Obsidian's More options button (always the last action) to the start of `.view-header-left`. With no traffic lights to clear, `styles.css` pads the bar 6px at each side.
>
> Ported from `backup-dev` (8ec9a05), with an earlier take on `backup-local-main` (ddfe049, 86bd27e).

> [!todo] Left to do
> Confirm in Obsidian.

> [!out] Left out
> Native traffic lights in the bar: minimise and zoom don't suit a floating preview, they can't grow with the bar, and they'd stay grey because the preview never takes focus.
