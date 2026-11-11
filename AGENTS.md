# AGENTS.md

Guidance for coding agents working in this repo. The plugin is **Muta** (formerly Floating Preview); its plugin ID and repo are `muta`. Read [README.md](README.md) for what the plugin does and [ROADMAP.md](ROADMAP.md) for everything it does and will do.

## What's here

An Obsidian plugin for macOS, plain JavaScript with no build step, plus two native parts.

| File | What it does |
| --- | --- |
| `main.js` | The plugin. Takes over Obsidian's hover previews, opens the floating window and draws everything in it, and downloads and checks the native parts on a BRAT install. |
| `styles.css` | The window's look. |
| `pip-main.js` | Runs in Electron's main process, where the window lives: follows drags and swipes every frame and runs springs on its own clock. Loaded fresh each time by `pip-load.js`. |
| `pip-helper.swift` → `pip-helper` | A background helper that reads the trackpad's own scroll events (with touch down and lift, which Electron's wheel events leave out). Needs no permissions. |
| `glass.m` → `glass.node` | Puts Liquid Glass behind the window, and stops clicks in it from bringing Obsidian forward (AppKit's private `_setPreventsActivation:`). |
| `scripts/install.sh` | Builds the native parts for this Mac and links a vault's plugin folder to the repo. |
| `scripts/roadmap.ts` | Builds ROADMAP.md from `features/` (below). |

`pip-helper`, `glass.node` and `data.json` are built or written locally and ignored. It can't go in the community plugin store: the store only ships `main.js`, `manifest.json` and `styles.css`.

## Builds and vaults

- **Dev build:** the test vault, `~/Documents/Muta Vault`. Its `.obsidian/plugins/muta` links to this repo, and its `features/` and `ROADMAP.md` link to this repo's, so the plugin is tested on its own roadmap (Order notes: `features/Phase */Phase *.md`). After changing `pip-helper.swift` or `glass.m`, run `./scripts/install.sh "$HOME/Documents/Muta Vault"`; after JS or CSS changes, reload the plugin: `obsidian vault="Muta Vault" plugin:reload id=muta` (the Obsidian CLI; `dev:errors` and `eval` check it without touching the screen).
- **Public build:** other vaults (the Amarula desktop repo) run the latest GitHub release, not this checkout.
- Settings and window position live in each plugin folder's `data.json`, so every vault linked to the repo shares the repo's one.

## Working style

- Branches: work on `dev` (or a branch off it); `main` holds what's released. Before resetting a branch, save it as `backup-<name>`.
- Never take control of the user's screen (synthetic clicks or keys, focusing windows). When something needs touching, ask the user and say exactly what to try. Passive screenshots are fine.
- Respect macOS's Reduce motion: switch and move without animating.
- Commits use Conventional Commits (`feat:`, `fix:`, `chore:`, …), with subjects written for users: they become the release notes.

## Releasing

1. Bump `version` in `manifest.json` and add it to `versions.json`.
2. Merge `dev` into `main`, tag that commit with the same version (`git tag 0.2.0`) and push `main` and the tag.

`.github/workflows/release.yml` builds the native parts for Apple Silicon and Intel, writes their SHA-256s into `main.js` (replacing the `__…_SHA256__` placeholders) and publishes the release. Its notes are the `feat:` and `fix:` commits since the previous tag, with their bodies (`scripts/release-notes.sh <tag>` previews them). BRAT users get it on their next Obsidian start.

## Features

Every feature has one file in `features/`. That file is its roadmap entry and its documentation. [ROADMAP.md](ROADMAP.md) is generated from them: read it first, then open the files you need.

- **Phases:** `features/Phase N/Phase N.md` is the phase's outline: its `name` (frontmatter), goal, then each area as a callout (`> [!area] Name`, its lines starting `> `) holding `> - [[Feature]]` links in order. Nesting a link under another makes it a sub-feature. The outline is the only place hierarchy and order live.
- **Features:** `features/Phase N/<Feature>.md`. The filename is the title: short, sentence case, unique; none of `\ / : # ^ | [ ] ? * " < >`. Copy `features/_templates/Feature.md`:
  - Frontmatter, in this order, leaving out empty ones: `status` (`idea`, `planned`, `in-progress`, `done`); `priority` (`high`, `medium`, `low`; empty once done); `native` (`true` when it needs `pip-helper` or `glass.node`, else `false`; always there); `area`, `parent`, `subfeatures` (written by `bun run roadmap` from the outline; don't edit them).
  - First line: one plain sentence on what it does for the user, at most 140 characters.
  - Then its details, only as these callouts, each at most once and in this order (leave out any with nothing to say):
    - `> [!demo] Demo`: a recording, `![[Name.mp4]]` from `features/media/`.
    - `> [!use] Using it`: where it is and how you use it.
    - `> [!how] How it works`: how it's built and why. On an unbuilt feature, the plan (title it `Plan`).
    - `> [!todo] Left to do`: what's still missing.
    - `> [!out] Left out`: what it deliberately doesn't do.
  - Inside a callout, every line starts `> ` (`>` alone for a blank line).
- **Working on one:** set `status: in-progress` when you start and `done` when it ships. A change that extends a feature edits its file in the same commit. Bug fixes don't get files.
- **New work:** add the file and link it in its phase outline. Moving a feature to another phase moves its file and its link.
- `bun run roadmap` regenerates ROADMAP.md and the outline properties; the pre-commit hook (`scripts/git-hooks`, set up by `bun install`) runs it and stages what it rewrote. CI runs `bun run roadmap --check`.
- `features/Features.base` holds the kanban boards: dragging a card in Obsidian changes `status`.
