---
status: done
native: false
area: Shipping
---

BRAT installs the plugin from GitHub releases and keeps it updated.

> [!how] How it works
> BRAT only installs `main.js`, `manifest.json` and `styles.css`. The first preview downloads the rest from the same release (the trackpad helper, the glass module, the main-process code) and checks each against a SHA-256 built into `main.js`.
>
> Installed where Floating Preview (its old name, plugin ID `floating-preview`) was, Muta takes over its settings and window position the first time it runs and turns it off, so the two don't both open windows.
