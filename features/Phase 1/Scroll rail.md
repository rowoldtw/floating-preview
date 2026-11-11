---
status: done
native: false
area: Window
parent: "[[Edge bars]]"
---

A scroll rail on the right edge with a mark for each section: properties, callouts and headings.

> [!use] Using it
> Hover a mark for its name, click to jump, drag or scroll to move through the page. It also opens on its own while the page scrolls.

> [!how] How it works
> The rail stands in for the page's scrollbar, so the page (and the switcher's list) scroll with none: `scrollbar-width: none` in `styles.css`. Obsidian on macOS keeps native scrollbars and sets `scrollbar-color` on the body, which makes Chromium ignore `::-webkit-scrollbar` rules, so those alone don't hide them.
