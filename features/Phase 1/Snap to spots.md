---
status: done
native: true
area: "Moving it"
---

Throw the window and it springs to the nearest of eight spots: the corners and the middle of each side.

> [!how] How it works
> `pip-main.js` follows the drag or swipe every frame and runs the spring on its own clock. `pip-helper.swift` reads the trackpad's own scroll events, including touch down and lift, which Electron's wheel events leave out. It needs no permissions.
