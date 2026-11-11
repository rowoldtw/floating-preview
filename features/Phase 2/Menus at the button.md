---
status: in-progress
priority: high
native: false
area: Chrome
---

Menus opened from the preview (More options, a right-click) open at the button, over the preview window.

> [!how] How it works
> The preview never takes focus, so Obsidian can't tell a menu came from it and pops native menus up over its main window. `main.js` patches Obsidian's `Menu.showAtPosition` and `showAtMouseEvent`: a menu shown within a second of a press in the preview opens there. For native menus (macOS default) it tells `pip-main.js`, whose patch of Electron's `Menu.popup` pops the next menu up over the preview window. With native menus off, the menu is drawn inside the preview.
>
> Ported from `backup-dev` (c4aa876), which took it from `backup-local-main` (a997150, 9e3b02d).

> [!todo] Left to do
> Confirm in Obsidian with native menus on and off.
