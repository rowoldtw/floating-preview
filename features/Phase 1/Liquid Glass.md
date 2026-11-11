---
status: done
native: true
area: Window
---

The desktop shows through the window, blurred, behind a slightly darker page panel (macOS 26 or later).

> [!use] Using it
> **Liquid Glass**, **Glass style** (regular or clear) and **Darkness** in settings. Off, or before macOS 26, the window is a plain tint.

> [!how] How it works
> `glass.m` puts an `NSGlassEffectView` behind the window. Electron's own blur materials are too dense to see through.
