# Muta

Muta is an Obsidian plugin for macOS. Hovering a link opens its page in a small Liquid Glass window that floats over every app, on every Space, and moves like picture in picture. You can keep reading it while you work somewhere else.

- **Edges grow into bars** when the cursor comes near: buttons and close on top, ‹ previous / next › at the bottom, a scroll rail with section marks on the right.
- **Throw it** and it springs to a corner or the middle of a side. Throw it past the left or right edge to tuck it behind a handle.
- **Step through notes** in the order of a list of links, like a roadmap's.

Everything it does, and what's next, is in [ROADMAP.md](ROADMAP.md).

## Install

macOS only. Liquid Glass needs macOS 26 or later; earlier, the window is a plain tint.

**With [BRAT](https://github.com/TfTHacker/obsidian42-brat):** install BRAT from Community plugins, run **BRAT: Add a beta plugin for testing** with `rowoldtw/muta`, then turn on **Muta**. The first preview downloads the plugin's native parts from the same release and checks their SHA-256s.

**From source** (needs `xcode-select --install`):

```sh
git clone https://github.com/rowoldtw/muta.git
cd muta
./scripts/install.sh "/path/to/your/vault"
```

Restart Obsidian and turn on **Muta**. To update, `git pull` and run the script again. Don't also add it through BRAT in that vault.

## Settings

Liquid Glass and its style, darkness, showing on every Space, swiping to move, overscroll, marking the previewed note, and **Order notes**: glob patterns (one per line) for the notes whose link lists set the bottom bar's order, for example `Roadmap/Phase */Phase *.md`. Without them it uses the note you hovered from.

"Toggle preview window" in the command palette switches back to Obsidian's own popovers.

## Notes

- Built against the Cupertino theme; other themes work but may look slightly different.
- The window never takes focus, so ⌘W doesn't reach it; use its close button.
- With Reduce motion on, it switches and moves without animating.
