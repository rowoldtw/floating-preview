---
status: done
native: true
area: Window
---

Link previews open in a small window that floats over every app, on every Space, instead of a popover.

> [!use] Using it
> Hover a link in Obsidian. The window stays up while you work in other apps, and **Show on every Space** keeps it on every Space and over full-screen apps.

> [!how] How it works
> An Electron window made from `pip-main.js` in Obsidian's main process, loaded fresh each time by `pip-load.js`. `glass.m` stops clicks in it from bringing Obsidian forward, using AppKit's private `_setPreventsActivation:`.

> [!out] Left out
> Focus: the window never takes it, so ⌘W and other shortcuts don't reach it. Use the close button.
