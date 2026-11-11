---
status: done
native: false
area: Chrome
---

Menus opened from the preview (More options, a right-click) open at the button, over the preview window.

> [!how] How it works
> The preview never takes focus, so Obsidian can't tell a menu came from it and pops native menus up over its main window. `main.js` patches Obsidian's `Menu.showAtPosition` and `showAtMouseEvent`: a menu from a click in the preview, or one that doesn't say where it's from within a second of the last press being in the preview, opens there. For native menus (macOS default) it tells `pip-main.js`, whose patch of Electron's `Menu.popup` pops the next menu (within 0.5s) up over the preview window. Electron's `Menu.popup` is wrapped once per Obsidian run and calls whatever `pip-main.js` last set, so a reload takes over. With native menus off, the menu is drawn inside the preview.
>
> Ported from `backup-dev` (c4aa876), which took it from `backup-local-main` (a997150, 9e3b02d).
