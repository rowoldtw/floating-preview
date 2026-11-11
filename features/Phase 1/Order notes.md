---
status: done
native: false
area: Obsidian
---

The bottom bar steps through notes in the order of the link lists in your order notes.

> [!use] Using it
> Without settings it uses the note you hovered from. Set **Order notes** to glob patterns, one per line, to always use those notes, in path order. The test vault uses `features/Phase */Phase *.md`.

> [!how] How it works
> Links are read from list items that start with a link, `- [[Note]]` or `- [Note](Note.md)`, including inside callouts, grouped under the note's name and the heading or callout they're in. A nested link counts as a sub-item.
