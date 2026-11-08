# Floating Preview

An Obsidian plugin for macOS. Hovering a link shows its page in a small window that floats over every app, in the same place on every Space, instead of a popover. You can keep reading it while you work somewhere else.

## What it does

- **The window:** Liquid Glass behind a slightly darker page panel. At rest the page sits in a thin border.
- **Edges that grow into bars:** when the cursor comes near an edge, that edge grows into a slim bar:
  - **Top:** the page's buttons and a close button. Drag or two-finger swipe here to move the window.
  - **Bottom:** ‹ the note's name and position ›. The arrows, or a sideways two-finger swipe, step to the previous or next note in order. Click the name to pick from the whole list.
  - **Right:** a scroll rail with a mark for each section (properties, callouts, headings). Hover a mark for its name, click to jump, drag or scroll to move through the page. It also opens on its own while the page scrolls.
- **Moving it, like picture in picture:**
  - Throw it and it springs to the nearest of eight spots (the corners and the middle of each side).
  - Throw it past the left or right edge to tuck it away behind a thin handle, then click, drag or swipe the handle to bring it back.
  - It stops at the menu bar, gives a little like a rubber band past the bottom of the screen, and remembers where you left it.
- **Changing pages:** the page changes the moment you hover a link. Pages slide up or down depending on whether the link is below or above the last one, and sideways when stepping through the order.
- **The page itself:**
  - **Properties:** they start as a small "› Properties" pill and morph open when clicked.
  - **Overscroll:** scrolling past the top or bottom rubber-bands, and flicks bounce off the ends.
- **Marking the previewed note:** links to the previewed note turn yellow in Obsidian's other windows and in the file list.
- **Turning it off:** "Toggle preview window" in the command palette switches back to Obsidian's own popovers.

## Order notes

The bottom bar steps through notes in an order. It takes that order from the lists of links in some of your notes:

- **Without settings:** it uses the note you hovered from. For example, hover links on a roadmap note and the bar steps through that note's list.
- **With settings:** set **Settings → Floating Preview → Order notes** to glob patterns, one per line. The bar then always uses those notes, taken in path order, for example `Roadmap/Phase */Phase *.md`.

Links are read from list items that start with a link, `- [[Note]]` or `- [Note](Note.md)`, including inside callouts. They're grouped under the note's name and the heading or callout they're in. A link nested under another counts as a sub-item.

## Settings

| Setting | What it does |
| --- | --- |
| **Liquid Glass** | The desktop shows through the window, blurred (macOS 26 or later). Off, the window is a plain tint. |
| **Glass style** | Regular blurs what's behind the window; clear barely does. |
| **Darkness** | How dark the window is over the glass. |
| **Mark the previewed note** | Links to the previewed note turn yellow in Obsidian's other windows and the file list. |
| **Show on every Space** | The window stays put on every Space and over full-screen apps. |
| **Swipe to move** | Two-finger swipes on the top bar move the window. |
| **Overscroll** | Pages pull past their ends and spring back. |
| **Order notes** | See [Order notes](#order-notes). |

## Install

It's for macOS. Liquid Glass needs macOS 26 or later; on earlier versions the window is a plain tint.

### With BRAT (recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins that aren't in the community store, straight from GitHub, and keeps them updated.

1. In Obsidian, install **BRAT** from **Settings → Community plugins**.
2. Run **BRAT: Add a beta plugin for testing** from the command palette and enter `rowoldtw/floating-preview`.
3. Turn on **Floating Preview** under **Settings → Community plugins**.

The first time it opens a preview, it downloads the rest of itself from the same GitHub release and checks each file against a SHA-256 built into the plugin. That's the trackpad helper, the glass module and the code that moves the window. BRAT checks for new versions when Obsidian starts.

### From source

Building from source needs the Xcode command line tools (`xcode-select --install`).

```sh
git clone https://github.com/rowoldtw/floating-preview.git
cd floating-preview
./scripts/install.sh "/path/to/your/vault"
```

1. The script builds the native parts for your Mac and links the vault's `.obsidian/plugins/floating-preview` folder back to this one.
2. Restart Obsidian, then turn on **Floating Preview** under **Settings → Community plugins**.
3. To update, run `git pull`, run the script again, and restart Obsidian.

Because the plugin folder is a link, every vault you install it into shares one `data.json`, which holds the settings and where the window was left. Don't add the plugin through BRAT in a vault where it's linked like this: BRAT would replace the link with its own copy.

## Releasing

1. Bump `version` in `manifest.json`, and add it to `versions.json`.
2. Commit, then tag the commit with the same version (for example `git tag 1.2.0`) and push the tag.

`.github/workflows/release.yml` then:
- builds the native parts for Apple Silicon and Intel Macs;
- writes their SHA-256s into `main.js`;
- publishes the GitHub release.

BRAT users get the new version on their next Obsidian start.

## How it's built

| File | What it does |
| --- | --- |
| `main.js` | The plugin. Takes over Obsidian's hover previews, opens the floating window and draws everything in it. |
| `styles.css` | The window's look. |
| `pip-main.js` | Runs in Electron's main process, where the window lives, so the window follows a drag or swipe every frame and springs on its own clock. Loaded fresh each time by `pip-load.js`. |
| `pip-helper.swift` | A small background helper that reads the trackpad's own scroll events, including when fingers touch down and lift, which Electron's wheel events leave out. It needs no permissions; it only watches. |
| `glass.m` | A native module that puts Liquid Glass behind the window, or takes it away (Electron's own blur materials are too dense to see through). It also stops clicks in the window from bringing Obsidian forward, using AppKit's private `_setPreventsActivation:`. |

It can't go in Obsidian's community plugin store: the store only ships `main.js`, `manifest.json` and `styles.css`, and this plugin needs the two native parts.

## Notes

- **Theme:** it was built against the Cupertino theme; a few rules (the properties panel) undo that theme's spacing. Other themes should work, but may look slightly different.
- **Focus:** the window never takes focus, so keyboard shortcuts like ⌘W don't reach it. Use the close button in the top bar.
- **Reduce motion:** with macOS's "Reduce motion" on, it switches and moves without animating.
