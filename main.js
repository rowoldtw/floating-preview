/*
 * Picture-in-picture previews: hovering a link shows its page in a small
 * Obsidian window (default preview size) that floats above every app, in the
 * same place on every Space, instead of a popover. It changes the moment a
 * link is hovered, and the new page fades in.
 *
 * Look: the window is Liquid Glass (GLASS), added by a
 * small native module (glass.m), since Electron's own blur materials are too
 * heavy to see through. At rest the page sits in a thin frame;
 * with the cursor near the top, the frame's top grows into a bar with the
 * page's buttons (styles.css).
 *
 * Moving it works like macOS picture in picture, from the top bar only: drag
 * it, or swipe two fingers on it, in any direction, and let go; it carries on
 * with your momentum and springs to the nearest of eight spots (the corners
 * and the middle of each side). Throw it past the left or right edge and it
 * tucks away there, leaving a thin handle; click, drag or swipe the handle to
 * bring it back. It keeps where you put it, tucked or not. The movement runs
 * in Electron's main process (pip-main.js), with the trackpad's own swipe
 * events from a small native helper (pip-helper.swift). Build both:
 *   swiftc -O pip-helper.swift -o pip-helper
 *   clang -bundle -undefined dynamic_lookup -fobjc-arc -O2 -framework AppKit \
 *     -framework QuartzCore glass.m -o glass.node
 * "Toggle preview window" turns it off and back to Obsidian's own previews.
 *
 * Around the page: links to the previewed note are marked in Obsidian's
 * other windows. Like the top, the frame's bottom and right edges grow into
 * bars when the cursor comes near: the bottom steps to the previous or next
 * note in order (the order notes in Settings, or the note you hovered from),
 * and clicking its name pops out the whole list to pick from; the right is a
 * thin rail showing where you are on the page, with a mark per section, each
 * section's name popping out beside its mark as the cursor nears it.
 */
const { Menu, Notice, Plugin, PluginSettingTab, SettingGroup, TFile, requestUrl, setIcon } = require("obsidian")

const SIZE = { width: 450, height: 400 }
/** Switching pages: the new one rises this far (px) and sharpens from this blur, over these times (ms). */
const SWITCH = {
  in: 320,
  out: 200,
  shift: 10,
  blur: 4,
  ease: "cubic-bezier(0.2, 0, 0, 1)",
  /** Stepping through the roadmap: a longer, gentler sideways slide. */
  sideways: { in: 420, out: 420, shift: 36, ease: "cubic-bezier(0.32, 0.72, 0, 1)" },
}
/** The top bar drags the window; its buttons still click. */
const HANDLE = ".view-header"
const INTERACTIVE = "a, button, input, .clickable-icon"
/**
 * The glass behind the page (pip-main.js → glass.m): Liquid Glass, regular
 * style (clear: true is clearer but hard to read over busy windows), with
 * corners of this radius. tint (0–1) darkens it for legibility; alpha below
 * 1 lets the sharp desktop show through.
 */
const GLASS = { tint: 0.3, alpha: 1, radius: 16 }
/** Movement before a press becomes a drag, so clicks stay clicks. */
const DRAG_THRESHOLD = 4
/** A menu shown this soon (ms) after a press in the preview opens in the preview. */
const MENU_PRESS_MS = 1000
/**
 * The frame's edges grow into bars when the cursor comes this close to them
 * (px), and shrink back once it's this far: [opens, closes].
 */
const EDGES = { top: [28, 52], bottom: [24, 48], right: [22, 34] }
/** The page's sections, as the rail marks them. */
const SECTIONS = ".metadata-container, .callout, h1, h2, h3, h4"
/** The rail names the section whose mark is within this distance of the cursor (px); a press within the second jumps to it. */
const SECTION_REACH = 24
const SECTION_HIT = 7
/** Stepping through the roadmap, the switcher's name blurs this much (px) as it changes. */
const NAME_BLUR = 4
/** Properties opening or closing (ms). */
const PROPERTIES_MORPH_MS = 300
/** The furthest a page pulls past its end (px). */
const OVERSCROLL_MAX = 90
/** How quickly an overscrolled page glides to where the pull says (ms, time constant). */
const OVERSCROLL_FOLLOW_MS = 28
/** Scrolling that stops this long (ms) has ended its gesture. */
const HELD_GAP_MS = 160
/** A flick into the end bounces this far per px of its scroll speed, over this long (ms). */
const BOUNCE_PER_PX = 2.2
const BOUNCE_MS = 520
/** The rail stays open this long after the page stops scrolling (ms). */
const RAIL_LINGER_MS = 900

/** How far a pull of d goes against a rubber band that stops at max (iOS's formula). */
const rubberBand = (d, max) => (1 - 1 / ((d * 0.55) / max + 1)) * max
/** A sideways swipe on the bottom bar steps once it has moved this far (px of scrolling); a pause this long (ms) ends it. */
const NAME_SWIPE_STEP = 45
const NAME_SWIPE_END_MS = 180
/** Settings, and their defaults. */
const DEFAULTS = {
  enabled: true,
  bounds: null,
  tucked: null,
  /**
   * Notes whose lists of links set the order the switcher steps through
   * (glob patterns, one per line, like "Roadmap/*.md"). Empty:
   * the links on the note you hovered from.
   */
  orderNotes: "",
  /** Liquid Glass behind the window (macOS 26 on); off, the window is a plain tint. */
  glass: true,
  /** "regular" blurs what's behind; "clear" barely does. */
  glassStyle: "regular",
  /** How dark the layer over the glass is, 0–1. */
  darkness: 0.55,
  /** The window stays in place on every Space (and over full-screen apps). */
  allSpaces: true,
  /** Two-finger swipes on the top bar move the window (needs the trackpad helper). */
  swipeToMove: true,
  /** Pages pull past their ends and spring back. */
  overscroll: true,
  /** Links to the previewed note turn yellow in Obsidian's other windows. */
  markPreviewed: true,
}

/**
 * The files BRAT doesn't install (it takes only main.js, manifest.json and
 * styles.css): the native parts and the code that runs in Electron's main
 * process. Their SHA-256s are written in by the release build (see
 * .github/workflows/release.yml); a release downloads them from its own
 * GitHub release and checks them against these. A build from source
 * (scripts/install.sh) has them already, and these stay unset.
 */
const RELEASE_FILES = {
  "pip-helper": "__PIP_HELPER_SHA256__",
  "glass.node": "__GLASS_NODE_SHA256__",
  "pip-main.js": "__PIP_MAIN_SHA256__",
  "pip-load.js": "__PIP_LOAD_SHA256__",
}
const REPO = "rowoldtw/muta"

/** A glob ("*" within a folder, "**" across folders) as a RegExp over vault paths. */
const globToRegExp = (glob) =>
  new RegExp(
    "^" +
      glob
        .trim()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, ".*") +
      "$"
  )

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const remote = () => require("@electron/remote")
const alive = (w) => !!(w && !w.isDestroyed())

module.exports = class extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, (await this.loadData()) || (await this.fromFloatingPreview()))
    this.addSettingTab(new MutaSettings(this.app, this))
    this.patchMenus()
    this.leaf = null
    this.win = null
    this.next = null
    this.busy = false
    this.pip = null
    this.updateFades = null
    this.items = null
    this.itemsFor = null
    this.sourcePath = null
    this.ui = null

    // The order changes when a note it comes from does.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.isOrderNote(file.path) || file.path === this.sourcePath) this.items = null
      })
    )

    const preview = this.app.internalPlugins.getPluginById("page-preview")
    const instance = preview && preview.instance
    if (!instance) return
    const original = instance.onLinkHover
    const plugin = this
    instance.onLinkHover = function (parent, targetEl, linktext, sourcePath) {
      if (!plugin.settings.enabled) return original.apply(this, arguments)
      const file = plugin.app.metadataCache.getFirstLinkpathDest(
        linktext.split("#")[0],
        sourcePath
      )
      if (!(file instanceof TFile) || file.extension !== "md")
        return original.apply(this, arguments)
      // The note you hovered from (not links inside the preview itself) gives the switcher its order when no order notes are set.
      const fromPreview = targetEl && targetEl.ownerDocument.body.classList.contains("fp-window")
      if (!fromPreview && sourcePath) plugin.sourcePath = sourcePath
      plugin.schedule(file, plugin.direction(targetEl))
    }
    this.register(() => {
      instance.onLinkHover = original
    })

    this.addCommand({
      id: "toggle-preview-window",
      name: "Toggle preview window",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled
        if (!this.settings.enabled) this.closeWindow()
        await this.saveData(this.settings)
      },
    })
  }

  onunload() {
    this.closeWindow()
  }

  /** Shows the hovered file at once; while one is loading, only the latest hover is kept. */
  schedule(file, direction = 1, axis = "y") {
    this.next = file
    this.nextDirection = direction
    this.nextAxis = axis
    if (!this.busy) this.drain()
  }

  async drain() {
    this.busy = true
    try {
      while (this.next) {
        const file = this.next
        const direction = this.nextDirection || 1
        const axis = this.nextAxis || "y"
        this.next = null
        await this.show(file, direction, axis)
      }
    } finally {
      this.busy = false
    }
  }

  isOpen() {
    return !!(
      this.leaf &&
      this.leaf.view &&
      this.leaf.view.containerEl.isConnected &&
      alive(this.win)
    )
  }

  async show(file, direction = 1, axis = "y") {
    if (!this.isOpen()) {
      this.closeWindow()
      await this.openWindow()
    }
    const { leaf } = this
    if (!leaf || (leaf.view.file && leaf.view.file.path === file.path)) return
    const old = this.snapshot()
    await leaf.openFile(file, { active: false, state: { mode: "preview" } })
    this.attach()
    this.addCloseButton()
    const raf = leaf.view.containerEl.win || window
    if (this.updateFades) raf.setTimeout(this.updateFades, 50)
    this.collapsePending = true
    this.collapseProperties()
    this.crossfade(old, direction, axis)
    this.markCurrent(file)
    this.updateSwitcher(file)
    // The page renders over a few frames; place the rail's marks once it has.
    for (const ms of [30, 60, 150, 400])
      raf.setTimeout(() => {
        this.collapseProperties()
        this.updateRail()
      }, ms)
  }

  /** Properties start collapsed to their heading; clicking it opens them (Obsidian's own toggle). */
  collapseProperties() {
    if (!this.collapsePending) return
    const page = this.page()
    const container = page && page.querySelector(".metadata-container")
    const heading = container && container.querySelector(".metadata-properties-heading")
    if (!heading) return // not rendered yet: tried again shortly (show)
    // Once per page shown, so opening them yourself sticks.
    this.collapsePending = false
    this.toggleProperties(container, true, false)
  }

  // ── The roadmap ───────────────────────────────────────────────────────

  orderPatterns() {
    return this.settings.orderNotes
      .split(/[\n,]/)
      .map((g) => g.trim())
      .filter(Boolean)
      .map(globToRegExp)
  }

  isOrderNote(path) {
    return this.orderPatterns().some((re) => re.test(path))
  }

  /**
   * The notes the switcher steps through, in order: { file, group, depth }.
   * They come from the lists of links in the order notes (Settings), taken
   * in path order, or without those, from the note you hovered from. Each
   * is grouped under the note's name (its frontmatter "name" too, if it has
   * one) and the heading or callout it's under; a link nested under another
   * is a sub-item (depth 1).
   */
  async roadmap() {
    const patterns = this.orderPatterns()
    const key = patterns.length ? "order" : this.sourcePath
    if (this.items && this.itemsFor === key) return this.items
    const { vault, metadataCache } = this.app
    let notes
    if (patterns.length)
      notes = vault
        .getMarkdownFiles()
        .filter((f) => patterns.some((re) => re.test(f.path)))
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
    else {
      const source = this.sourcePath && vault.getAbstractFileByPath(this.sourcePath)
      notes = source instanceof TFile ? [source] : []
    }
    const items = []
    const seen = new Set()
    for (const note of notes) {
      const fm = (metadataCache.getFileCache(note) || {}).frontmatter || {}
      const name = fm.name ? `${note.basename}: ${fm.name}` : note.basename
      let section = ""
      for (const line of (await vault.cachedRead(note)).split("\n")) {
        const callout = line.match(/^>\s*\[![^\]]+\][+-]?\s*(.*)$/)
        const heading = line.match(/^(?:>\s*)?#{1,6}\s+(.+)$/)
        if (callout || heading) {
          section = (callout ? callout[1] : heading[1]).trim()
          continue
        }
        // A list item that starts with a link: "- [[Note]]" or "- [Note](Note.md)", in a callout or not.
        const item = line.match(
          /^(?:>\s?)?([ \t]*)[-*+]\s+(?:\[.\]\s+)?(?:\[\[([^\]|#]+)|\[[^\]]*\]\(([^)#]+)\))/
        )
        if (!item) continue
        const target = item[2] || decodeURI(item[3])
        const file = metadataCache.getFirstLinkpathDest(target, note.path)
        if (!file || file.extension !== "md" || seen.has(file)) continue
        seen.add(file)
        const indent = item[1].replace(/\t/g, "    ").length
        items.push({ file, group: section ? `${name} · ${section}` : name, depth: indent >= 2 ? 1 : 0 })
      }
    }
    this.items = items
    this.itemsFor = key
    return items
  }

  /**
   * Marks the previewed feature wherever it's linked in Obsidian's other
   * windows (ROADMAP.md, outlines, the file list), and keeps it in view.
   */
  markCurrent(file) {
    const docs = new Set()
    this.app.workspace.iterateAllLeaves((leaf) => {
      const doc = leaf.view.containerEl.ownerDocument
      if (!doc.body.classList.contains("fp-window")) docs.add(doc)
    })
    docs.add(document)
    let css = ""
    if (file && this.settings.markPreviewed) {
      const hrefs = [file.path, file.path.replace(/\.md$/, ""), file.basename]
        .map((h) => `a.internal-link[data-href=${JSON.stringify(h)}]`)
        .join(", ")
      // Its own colour, unlike any other link's, with a soft highlight behind
      // it: colour and background only, so nothing moves.
      const mark = `color: var(--color-yellow) !important;
        background: color-mix(in srgb, var(--color-yellow) 16%, transparent);
        border-radius: 3px; box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-yellow) 16%, transparent);
        text-decoration-color: currentColor !important;`
      css = `
        :is(${hrefs}) { ${mark} }
        .nav-file-title[data-path=${JSON.stringify(file.path)}] .nav-file-title-content { ${mark} }`
    }
    for (const doc of docs) {
      let style = doc.getElementById("muta-current")
      if (!css) {
        if (style) style.remove()
        continue
      }
      if (!style) {
        style = doc.createElement("style")
        style.id = "muta-current"
        doc.head.appendChild(style)
      }
      style.textContent = css
      const link = doc.querySelector(
        `.markdown-preview-view a.internal-link[data-href=${JSON.stringify(file.path)}]`
      )
      if (link) link.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }

  // ── The switcher: a pill at the bottom that opens into the roadmap ────

  buildSwitcher(doc) {
    const el = doc.body.createDiv({ cls: "fp-switcher" })
    // The roadmap list pops out above the bar, over the page.
    const popout = doc.body.createDiv({ cls: "fp-switcher-popout" })
    const list = popout.createDiv({ cls: "fp-switcher-list" })
    const bar = el.createDiv({ cls: "fp-switcher-bar" })
    const prev = bar.createEl("button", { cls: "fp-switcher-step", attr: { "aria-label": "Previous feature", "data-tooltip-position": "top" } })
    setIcon(prev, "chevron-left")
    const title = bar.createEl("button", {
      cls: "fp-switcher-title",
      attr: { "aria-haspopup": "listbox" },
    })
    // The text slides as you step through the roadmap; the button stays put.
    const label = title.createSpan({ cls: "fp-switcher-label" })
    const name = label.createSpan({ cls: "fp-switcher-name" })
    const where = label.createSpan({ cls: "fp-switcher-where" })
    const next = bar.createEl("button", { cls: "fp-switcher-step", attr: { "aria-label": "Next feature", "data-tooltip-position": "top" } })
    setIcon(next, "chevron-right")
    prev.addEventListener("click", () => this.step(-1))
    next.addEventListener("click", () => this.step(1))
    this.attachNameSwipe(el, label)


    // The name opens the list; picking a feature or clicking elsewhere closes it.
    const body = doc.body
    title.addEventListener("click", () => {
      const open = !body.classList.contains("is-switcher-open")
      body.classList.toggle("is-switcher-open", open)
      if (open) this.fillSwitcher()
    })
    doc.addEventListener(
      "pointerdown",
      (event) => {
        if (popout.contains(event.target) || title.contains(event.target)) return
        body.classList.remove("is-switcher-open")
      },
      true
    )
    return { el, popout, list, title, label, name, where }
  }

  async updateSwitcher(file) {
    if (!this.ui) return
    const items = await this.roadmap()
    const index = items.findIndex((i) => i.file === file)
    const item = items[index]
    this.ui.switcher.name.setText(file.basename)
    this.ui.switcher.where.setText(item ? `${index + 1}/${items.length}` : "")
    this.ui.switcher.el.toggleClass("is-orphan", !item)
    if (this.ui.switcher.el.ownerDocument.body.classList.contains("is-switcher-open"))
      this.fillSwitcher()
  }

  /** The whole roadmap, grouped by phase and area, scrolled to the current feature. */
  async fillSwitcher() {
    const { list } = this.ui.switcher
    const items = await this.roadmap()
    const current = this.leaf && this.leaf.view.file
    list.empty()
    let group = ""
    let currentEl = null
    items.forEach((item, index) => {
      const heading = item.group
      if (heading !== group) {
        group = heading
        list.createDiv({ cls: "fp-switcher-group", text: heading })
      }
      const row = list.createDiv({
        cls: "fp-switcher-item",
        text: item.file.basename,
      })
      if (item.depth) row.addClass("is-sub")
      if (item.file === current) {
        row.addClass("is-current")
        currentEl = row
      }
      row.addEventListener("click", () => {
        list.ownerDocument.body.classList.remove("is-switcher-open")
        this.go(index)
      })
    })
    // Centred once the list has grown to its full height.
    const center = () => {
      if (currentEl) list.scrollTop = currentEl.offsetTop - (list.clientHeight - currentEl.offsetHeight) / 2
    }
    center()
    list.ownerDocument.defaultView.setTimeout(center, 360)
  }

  /** The previous (-1) or next (1) feature in roadmap order; its name and page slide in from that side. */
  async step(delta) {
    const items = await this.roadmap()
    const current = this.leaf && this.leaf.view.file
    const index = items.findIndex((i) => i.file === current)
    if (index < 0) return items.length && this.go(0)
    const target = (index + delta + items.length) % items.length
    this.slideName(delta, () => this.setName(items[target].file, target, items.length))
    this.go(target, delta, "x")
  }

  async go(index, direction, axis = "y") {
    const items = await this.roadmap()
    const current = this.leaf && this.leaf.view.file
    const from = items.findIndex((i) => i.file === current)
    this.schedule(items[index].file, direction || (index >= from ? 1 : -1), axis)
  }

  setName(file, index, total) {
    if (!this.ui) return
    this.ui.switcher.name.setText(file.basename)
    this.ui.switcher.where.setText(index >= 0 ? `${index + 1}/${total}` : "")
  }

  /**
   * The switcher's text changes in place: the old name blurs and fades out,
   * the new one fades in sharp, straight away (the page follows as soon as
   * it has loaded).
   */
  slideName(direction, change) {
    const label = this.ui && this.ui.switcher.label
    if (!label || reduceMotion()) return change()
    const opacity = label.style.opacity || "1"
    const filter = label.style.filter || "blur(0px)"
    label.getAnimations().forEach((a) => a.cancel())
    label.style.opacity = ""
    label.style.filter = ""
    const out = label.animate(
      [
        { opacity, filter },
        { opacity: 0, filter: `blur(${NAME_BLUR}px)` },
      ],
      { duration: 90, easing: "ease-in", fill: "forwards" }
    )
    out.finished.then(() => {
      change()
      label.animate(
        [
          { opacity: 0, filter: `blur(${NAME_BLUR}px)` },
          { opacity: 1, filter: "blur(0px)" },
        ],
        { duration: 220, easing: SWITCH.ease }
      )
      out.cancel()
    }, () => {})
  }

  /**
   * Swiping two fingers sideways on the bottom bar steps through the
   * roadmap: the name fades as your fingers move, and once they've gone far enough
   * it moves on to the previous or next feature (one per swipe). Let go
   * short of that and it springs back.
   */
  attachNameSwipe(bar, title) {
    const win = bar.ownerDocument.defaultView
    let swipe = null
    // Touch-down and lift, from the trackpad itself (pip-main.js): a new
    // swipe starts fresh even while the last one's momentum is still
    // coming in, and lifting short of a step springs back at once.
    this.onGesture((phase) => {
      if (phase === "began") {
        if (swipe) win.clearTimeout(swipe.timer)
        if (swipe && !swipe.done) settle()
        swipe = null
      } else if (phase === "ended" && swipe && !swipe.done) {
        settle()
        swipe.done = true // ignore the momentum that follows
      }
    })
    const settle = () => {
      if (reduceMotion()) {
        title.style.opacity = ""
        title.style.filter = ""
        return
      }
      const opacity = title.style.opacity || "1"
      const filter = title.style.filter || "blur(0px)"
      title.style.opacity = ""
      title.style.filter = ""
      title.animate([{ opacity, filter }, { opacity: 1, filter: "blur(0px)" }], {
        duration: 220,
        easing: SWITCH.ease,
      })
    }
    bar.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) return
        event.preventDefault()
        if (!swipe && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
        if (!swipe) swipe = { dx: 0, done: false, timer: 0 }
        win.clearTimeout(swipe.timer)
        swipe.timer = win.setTimeout(() => {
          if (!swipe.done) settle()
          swipe = null
        }, NAME_SWIPE_END_MS)
        if (swipe.done) return // the rest of this swipe, and its momentum
        swipe.dx += event.deltaX
        const progress = Math.min(Math.abs(swipe.dx) / NAME_SWIPE_STEP, 1)
        title.getAnimations().forEach((a) => a.cancel())
        // Fingers to the left (content scrolls right) go forward, as in a browser.
        // The name stays put and fades as the swipe builds.
        title.style.opacity = `${1 - progress * 0.6}`
        title.style.filter = `blur(${progress * NAME_BLUR * 0.5}px)`
        if (progress >= 1) {
          swipe.done = true
          this.step(Math.sign(swipe.dx))
        }
      },
      { passive: false }
    )
  }

  // ── The rail: where you are on the page, and its sections ─────────────

  buildRail(doc) {
    const el = doc.body.createDiv({ cls: "fp-rail" })
    const track = el.createDiv({ cls: "fp-rail-track" })
    const thumb = track.createDiv({ cls: "fp-rail-thumb" })
    const ticks = track.createDiv({ cls: "fp-rail-ticks" })
    // Section names pop out beside the rail, over the page, while it's hovered.
    const labels = doc.body.createDiv({ cls: "fp-rail-labels" })
    this.hoverOpen([el, labels], "is-rail-open", () => this.updateRail())
    // Scrolling over the rail (or a section name) scrolls the page.
    for (const target of [el, labels])
      target.addEventListener(
        "wheel",
        (event) => {
          const page = this.page()
          if (!page || event.ctrlKey) return
          event.preventDefault()
          page.scrollTop += event.deltaY
        },
        { passive: false }
      )
    // Only the section nearest the cursor names itself.
    const nearest = (y) => {
      const r = track.getBoundingClientRect()
      let best = null
      let bestDistance = SECTION_REACH
      for (const s of this.ui.rail.sections) {
        const d = Math.abs(r.top + (parseFloat(s.tick.style.top) / 100) * r.height - y)
        if (d < bestDistance) {
          best = s
          bestDistance = d
        }
      }
      return best
    }
    const showLabel = (section) => {
      for (const s of this.ui.rail.sections) s.label.toggleClass("is-shown", s === section)
    }
    el.addEventListener("mousemove", (event) => showLabel(nearest(event.clientY)))
    el.addEventListener("mouseleave", (event) => {
      if (!labels.contains(event.relatedTarget)) showLabel(null)
    })
    labels.addEventListener("mouseleave", () => showLabel(null))
    // Dragging along the track scrolls the page there.
    el.addEventListener("pointerdown", (event) => {
      const page = this.page()
      if (!page) return
      event.preventDefault()
      // A press on a section's mark jumps to it; anywhere else scrubs.
      const section = nearest(event.clientY)
      if (section && section.label.classList.contains("is-shown")) {
        const r = track.getBoundingClientRect()
        const y = r.top + (parseFloat(section.tick.style.top) / 100) * r.height
        if (Math.abs(y - event.clientY) <= SECTION_HIT) return section.label.click()
      }
      el.setPointerCapture(event.pointerId)
      el.classList.add("is-scrubbing")
      const scrub = (e) => {
        const r = track.getBoundingClientRect()
        const f = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
        page.scrollTop = f * page.scrollHeight - page.clientHeight / 2
      }
      scrub(event)
      const up = () => {
        el.classList.remove("is-scrubbing")
        el.removeEventListener("pointermove", scrub)
        el.removeEventListener("pointerup", up)
        el.removeEventListener("pointercancel", up)
      }
      el.addEventListener("pointermove", scrub)
      el.addEventListener("pointerup", up)
      el.addEventListener("pointercancel", up)
    })
    let frame = 0
    let scrollTimer = 0
    doc.addEventListener(
      "scroll",
      (event) => {
        if (event.target !== this.page()) return
        // The rail opens while the page scrolls, and closes a moment after.
        doc.body.classList.add("is-scrolling")
        doc.defaultView.clearTimeout(scrollTimer)
        scrollTimer = doc.defaultView.setTimeout(
          () => doc.body.classList.remove("is-scrolling"),
          RAIL_LINGER_MS
        )
        if (frame) return
        frame = doc.defaultView.requestAnimationFrame(() => {
          frame = 0
          this.updateRail(true)
        })
      },
      { capture: true, passive: true }
    )
    doc.defaultView.addEventListener("resize", () => this.updateRail())
    return { el, track, thumb, ticks, labels, sections: [] }
  }

  page() {
    return (
      this.leaf &&
      this.leaf.view.containerEl.querySelector(
        ".view-content .markdown-preview-view:not(.fp-old)"
      )
    )
  }

  /** Places the rail's marks and labels (or, scrolling, only the thumb and current section). */
  updateRail(scrollOnly = false) {
    const rail = this.ui && this.ui.rail
    const page = this.page()
    if (!rail || !page) return
    const height = rail.track.clientHeight
    const total = page.scrollHeight
    const scrolls = total > page.clientHeight + 4
    rail.el.toggleClass("is-hidden", !scrolls)
    // A page that doesn't scroll has no rail to open.
    rail.el.ownerDocument.body.classList.toggle("has-scroll", scrolls)
    if (!scrolls) {
      rail.labels.empty()
      rail.sections = []
    }
    if (!scrolls || !height) return

    if (!scrollOnly) {
      const origin = page.getBoundingClientRect().top - page.scrollTop
      const found = [...page.querySelectorAll(SECTIONS)].filter(
        (s) => !s.parentElement.closest(".callout, .metadata-container")
      )
      rail.sections = found.map((s) => {
        const top = s.getBoundingClientRect().top - origin
        const name = s.classList.contains("metadata-container")
          ? "Properties"
          : s.classList.contains("callout")
            ? (s.querySelector(".callout-title-inner") || s).textContent.trim()
            : s.textContent.trim()
        return { el: s, top, name }
      })
      rail.ticks.empty()
      rail.labels.empty()
      rail.sections.forEach((section) => {
        section.tick = rail.ticks.createDiv({ cls: "fp-rail-tick" })
        // Marks and thumb in %, so they stay put as the rail's height follows the top bar.
        section.tick.style.top = `${(section.top / total) * 100}%`
        section.label = rail.labels.createDiv({ cls: "fp-rail-label", text: section.name })
        section.label.style.top = `${(section.top / total) * 100}%`
        section.label.addEventListener("click", () =>
          page.scrollTo({
            top: Math.max(section.top - 8, 0),
            behavior: reduceMotion() ? "auto" : "smooth",
          })
        )
      })
    }

    rail.thumb.style.top = `${(page.scrollTop / total) * 100}%`
    rail.thumb.style.height = `${(page.clientHeight / total) * 100}%`
    // The current section: the last one starting above the top quarter of the view.
    const line = page.scrollTop + page.clientHeight / 4
    const atEnd = page.scrollTop + page.clientHeight >= total - 2
    let current = -1
    rail.sections.forEach((s, i) => {
      if (s.top <= line) current = i
    })
    if (atEnd) current = rail.sections.length - 1
    rail.sections.forEach((s, i) => {
      s.tick.toggleClass("is-current", i === current)
      s.label.toggleClass("is-current", i === current)
    })
  }

  /**
   * Which way the pages move: hovering a link lower on screen than the last
   * one (1) brings the new page up from below, a higher one (-1) down from
   * above, like scrolling through them.
   */
  direction(targetEl) {
    const y =
      targetEl && targetEl.getBoundingClientRect
        ? targetEl.getBoundingClientRect().top
        : null
    if (y === null) return 1
    const last = this.lastHoverY
    this.lastHoverY = y
    return last === undefined || y >= last ? 1 : -1
  }

  /**
   * A still copy of the page on screen, laid over it, so the old page can
   * fade out while the new one comes in under it.
   */
  snapshot() {
    const content = this.leaf && this.leaf.view.containerEl.querySelector(".view-content")
    const page = content && content.querySelector(".markdown-preview-view:not(.fp-old)")
    if (!page || reduceMotion()) return null
    content.querySelectorAll(".fp-old").forEach((el) => el.remove())
    const copy = page.cloneNode(true)
    copy.classList.add("fp-old")
    copy.setAttribute("aria-hidden", "true")
    content.appendChild(copy)
    copy.scrollTop = page.scrollTop
    return copy
  }

  /**
   * Switching pages: the old one drifts away and fades out with a slight
   * blur while the new one slides into place and sharpens: upward for a link
   * below the last one and downward for one above, sideways when stepping
   * through the roadmap (opacity, transform and
   * filter only, on the compositor).
   */
  crossfade(old, direction = 1, axis = "y") {
    const page = this.leaf && this.leaf.view.containerEl.querySelector(
      ".view-content .markdown-preview-view:not(.fp-old)"
    )
    if (!page || reduceMotion()) {
      if (old) old.remove()
      return
    }
    // Stepping through the roadmap (arrows, swipes): the pages slide sideways
    // together, like turning pages, on transform and opacity alone so it
    // stays smooth. Hovering: up and down, with a soft blur.
    const sideways = axis === "x"
    const t = sideways ? SWITCH.sideways : SWITCH
    const move = (px) => (sideways ? `translateX(${px}px)` : `translateY(${px}px)`)
    const shift = t.shift * direction
    const blur = (px) => (sideways ? "none" : `blur(${px}px)`)
    const raf = this.leaf.view.containerEl.win || window
    raf.requestAnimationFrame(() => {
      page.getAnimations().forEach((a) => a.cancel())
      page.animate(
        [
          { opacity: 0, transform: move(shift), filter: blur(SWITCH.blur) },
          { opacity: 1, transform: "none", filter: blur(0) },
        ],
        { duration: t.in, easing: t.ease }
      )
      if (!old) return
      old
        .animate(
          [
            { opacity: 1, transform: "none", filter: blur(0) },
            { opacity: 0, transform: move(-shift), filter: blur(SWITCH.blur) },
          ],
          { duration: t.out, easing: t.ease, fill: "forwards" }
        )
        .finished.then(() => old.remove(), () => old.remove())
    })
  }

  async openWindow() {
    const { BrowserWindow, getCurrentWindow } = remote()
    const main = getCurrentWindow()
    const before = new Set(BrowserWindow.getAllWindows().map((w) => w.id))
    this.leaf = this.app.workspace.openPopoutLeaf({ size: SIZE })
    let win = null
    for (let i = 0; i < 20 && !win; i++) {
      win = BrowserWindow.getAllWindows().find((w) => !before.has(w.id))
      if (!win) await sleep(25)
    }
    if (!win) return
    const dir = this.pluginDir()
    await this.ensureNatives()
    const pipMain = remote().require(`${dir}/pip-load.js`).load(`${dir}/pip-main.js`)

    const start = pipMain.placement({
      bounds: this.settings.bounds,
      tucked: this.settings.tucked,
      size: SIZE,
    })
    win.setAlwaysOnTop(true, "floating")
    win.setVisibleOnAllWorkspaces(this.settings.allSpaces, {
      visibleOnFullScreen: this.settings.allSpaces,
      skipTransformProcessType: true,
    })
    win.setBackgroundColor("#00000000")
    // No close, minimise and zoom buttons: it's closed from its own bar.
    win.setWindowButtonVisibility(false)
    // Clicking it never makes it the focused window: glass looks different
    // on the focused window, and the preview would flip between the two.
    win.setFocusable(false)
    win.setBounds(start)
    this.pip = pipMain.create({
      windowId: win.id,
      dir,
      glass: this.glassOptions(),
      swipes: this.settings.swipeToMove,
      state: { bounds: this.settings.bounds, tucked: this.settings.tucked },
      // Where it was put: keep it, and show the handle if it's tucked.
      onSettle: (state) => {
        this.settings.bounds = state.bounds
        this.settings.tucked = state.tucked
        this.showTucked()
        this.saveData(this.settings)
      },
    })
    win.once("closed", () => {
      pipMain.dispose()
      if (this.win === win) this.pip = null
    })
    this.win = win
    // Keep working where you were: the new windows don't take focus.
    main.focus()
  }

  pluginDir() {
    return `${this.app.vault.adapter.getBasePath()}/${this.manifest.dir}`
  }

  glassOptions() {
    return this.settings.glass ? { ...GLASS, clear: this.settings.glassStyle === "clear" } : null
  }

  /** Puts changed settings into effect on an open window. */
  applySettings() {
    const doc = this.leaf && this.leaf.view.containerEl.ownerDocument
    if (doc && doc !== document) doc.body.style.setProperty("--fp-darkness", String(this.settings.darkness))
    if (this.isOpen()) {
      this.win.setVisibleOnAllWorkspaces(this.settings.allSpaces, {
        visibleOnFullScreen: this.settings.allSpaces,
        skipTransformProcessType: true,
      })
      if (this.pip) {
        this.pip.setGlass(this.glassOptions())
        this.pip.setSwipes(this.settings.swipeToMove)
      }
    }
    this.markCurrent(this.isOpen() ? this.leaf.view.file : null)
  }

  /**
   * A release installed by BRAT comes without its native parts (the
   * trackpad helper and the glass module) and its main-process code:
   * they're downloaded once per version from the same GitHub release and
   * checked against the SHA-256s this file was built with.
   */
  async ensureNatives() {
    const pending = Object.entries(RELEASE_FILES).filter(([, sha]) => !sha.startsWith("__"))
    if (!pending.length) return // built from source
    const fs = require("fs")
    const crypto = require("crypto")
    const dir = this.pluginDir()
    const marker = `${dir}/natives-version`
    const version = this.manifest.version
    const ready = () => {
      try {
        return fs.readFileSync(marker, "utf8").trim() === version
      } catch {
        return false
      }
    }
    if (ready()) return
    if (this.downloading) return this.downloading
    this.downloading = (async () => {
      try {
        for (const [name, sha] of pending) {
          const res = await requestUrl({
            url: `https://github.com/${REPO}/releases/download/${version}/${name}`,
          })
          const data = Buffer.from(res.arrayBuffer)
          const got = crypto.createHash("sha256").update(data).digest("hex")
          if (got !== sha) throw new Error(`${name} didn't match its checksum`)
          fs.writeFileSync(`${dir}/${name}`, data)
          fs.chmodSync(`${dir}/${name}`, 0o755)
        }
        fs.writeFileSync(marker, version)
      } catch (error) {
        console.error("Muta: couldn't get its native parts", error)
        new Notice("Muta couldn't download the rest of itself from GitHub. Check your connection and hover a link again.")
      } finally {
        this.downloading = null
      }
    })()
    return this.downloading
  }

  /**
   * Muta was Floating Preview (plugin ID floating-preview). Its settings and
   * window position come over the first time, and it's turned off: both
   * would take over hover previews and open two windows.
   */
  async fromFloatingPreview() {
    const old = "floating-preview"
    let saved = null
    try {
      saved = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/${old}/data.json`))
      await this.saveData(saved)
    } catch {}
    const plugins = this.app.plugins
    if (plugins && plugins.enabledPlugins && plugins.enabledPlugins.has(old)) {
      await plugins.disablePluginAndSave(old)
      new Notice("Floating Preview is now Muta, so it's been turned off. You can uninstall it in Community plugins.")
    }
    return saved
  }

  /**
   * Menus opened from the preview window ("More options", a right-click)
   * open at what was clicked. Otherwise Obsidian pops its native macOS
   * menus up over its main window, nowhere near the button.
   * The preview never takes focus, so Obsidian doesn't know a click came
   * from it (it passes the main window's document): when a menu doesn't
   * say where it's from, the last press, if it was in the preview just
   * before, tells.
   */
  patchMenus() {
    const proto = Menu.prototype
    if (!proto.setUseNativeMenu) return
    const plugin = this
    const previewDoc = () => {
      const doc = plugin.leaf && plugin.leaf.view.containerEl.ownerDocument
      return doc && doc !== document ? doc : null
    }
    const fromPreview = (event, doc) => {
      const pip = previewDoc()
      if (!pip) return null
      const from = event && event.target && event.target.ownerDocument
      if (from) return from === pip ? pip : null
      if (doc === pip) return pip
      const press = plugin.lastPress
      return press && press.doc === pip && performance.now() - press.at < MENU_PRESS_MS ? pip : null
    }
    // Presses in the main window count too, so a menu opened there right
    // after a press in the preview stays there.
    this.registerDomEvent(document, "pointerdown", () => (this.lastPress = { doc: document, at: performance.now() }), true)
    // Native menus (Obsidian's default on macOS) pop up over the preview window
    // at the button (pip-main.js); otherwise the menu is drawn inside the preview.
    const native = (menu) =>
      menu.useNativeMenu !== undefined ? !!menu.useNativeMenu : plugin.app.vault.getConfig("nativeMenus") !== false
    const showAtPosition = proto.showAtPosition
    const show = (menu, position, pip) => {
      if (native(menu) && plugin.pip) plugin.pip.menuFromPreview()
      else menu.setUseNativeMenu(false)
      return showAtPosition.call(menu, position, pip)
    }
    const atPosition = function (position, doc) {
      const pip = fromPreview(null, doc)
      return pip ? show(this, position, pip) : showAtPosition.apply(this, arguments)
    }
    const showAtMouseEvent = proto.showAtMouseEvent
    const atMouseEvent = function (event) {
      const pip = fromPreview(event)
      return pip ? show(this, { x: event.clientX, y: event.clientY }, pip) : showAtMouseEvent.apply(this, arguments)
    }
    proto.showAtPosition = atPosition
    proto.showAtMouseEvent = atMouseEvent
    // Put back only if nothing else has wrapped them since.
    this.register(() => {
      if (proto.showAtPosition === atPosition) proto.showAtPosition = showAtPosition
      if (proto.showAtMouseEvent === atMouseEvent) proto.showAtMouseEvent = showAtMouseEvent
    })
  }

  /**
   * A close button in the top bar's right corner (the next hovered link opens
   * the window again), and the page's menu moved to its left corner.
   */
  addCloseButton() {
    const view = this.leaf && this.leaf.view
    if (!view || !view.addAction || view.fpClose) return
    const more = view.moreOptionsButtonEl
    view.fpClose = view.addAction("x", "Close preview", () => this.closeWindow())
    view.fpClose.addClass("fp-close")
    if (view.actionsEl) view.actionsEl.appendChild(view.fpClose)
    const left = view.headerEl && view.headerEl.querySelector(".view-header-left")
    if (more && left) {
      more.addClass("fp-more")
      left.prepend(more)
    }
  }

  /** Wires up the window, once per window. */
  attach() {
    const doc = this.leaf && this.leaf.view.containerEl.ownerDocument
    if (!doc || doc === document || doc.body.classList.contains("fp-window"))
      return
    doc.body.classList.add("fp-window")
    doc.body.style.setProperty("--fp-darkness", String(this.settings.darkness))
    doc.documentElement.classList.add("fp-root")
    this.showTucked()
    // Touch-down and lift on the trackpad, from pip-main.js, for whatever needs them.
    const gestures = new Set()
    this.onGesture = (handler) => gestures.add(handler)
    doc.defaultView.mutaGesture = (phase) => gestures.forEach((handler) => handler(phase))
    this.attachEdges(doc)
    this.attachOverscroll(doc)
    this.attachDrag(doc)
    this.attachSwipe(doc)
    this.attachScrollFades(doc)
    // Which press opened a menu (patchMenus).
    doc.addEventListener("pointerdown", () => (this.lastPress = { doc, at: performance.now() }), true)
    this.attachPropertiesMorph(doc)
    this.ui = { switcher: this.buildSwitcher(doc), rail: this.buildRail(doc) }
  }

  /**
   * Scrolling past the top or bottom of a page pulls it a little further,
   * harder the further you go, and it springs back when you let go; a flick
   * that runs into the end carries a little past it and springs back, as
   * macOS pages do.
   *
   * The page doesn't jump with each scroll event (they come less often than
   * frames, and unevenly): every frame it glides toward where the pull
   * says, so it moves smoothly.
   */
  attachOverscroll(doc) {
    const win = doc.defaultView
    let raw = 0 // how far you've scrolled past the end (+ above the top, - below the bottom)
    let shown = 0 // where the page is drawn, gliding toward the pull
    let lifted = false // fingers up: what's still coming is a flick's momentum
    let phases = false // the trackpad helper reports touch-down and lift
    let settled = false // let go of a pull: the momentum that follows mustn't pull again
    let held = false // this gesture was cancelled for a pull, so it can't scroll the page natively
    let lastWheel = 0
    let timer = 0
    let frame = 0
    let last = 0
    let el = null
    const sizer = () => {
      const page = this.page()
      return page && page.querySelector(".markdown-preview-sizer")
    }
    const target = () => Math.sign(raw) * rubberBand(Math.abs(raw), OVERSCROLL_MAX)
    const draw = () => {
      if (el) el.style.transform = Math.abs(shown) > 0.05 ? `translateY(${shown}px)` : ""
    }
    const glide = (now) => {
      frame = 0
      const dt = Math.min(now - (last || now - 8), 50)
      last = now
      const goal = target()
      shown += (goal - shown) * (1 - Math.exp(-dt / OVERSCROLL_FOLLOW_MS))
      draw()
      if (raw || Math.abs(shown - goal) > 0.1) frame = win.requestAnimationFrame(glide)
      else last = 0
    }
    const pull = () => {
      if (!frame) frame = win.requestAnimationFrame(glide)
    }
    // Springs the page back from the pull; turning back mid-gesture (quick) it just lets go.
    const release = (quick = false) => {
      win.clearTimeout(timer)
      if (!raw && !shown) return
      raw = 0
      if (frame) win.cancelAnimationFrame(frame)
      frame = 0
      last = 0
      const from = shown
      shown = 0
      draw()
      if (!el || !from || reduceMotion() || (quick && Math.abs(from) < 2)) return
      el.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], {
        duration: 520,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      })
    }
    this.onGesture((phase) => {
      phases = true
      lifted = phase === "ended" || phase === "momentum"
      if (phase === "momentum") return
      if (phase === "began") {
        settled = false
        win.clearTimeout(timer)
      }
      if (lifted) {
        // macOS keeps sending the swipe's momentum after the fingers lift;
        // pulling again with it is what made the page stutter on release.
        settled = !!(raw || shown)
        release()
      }
    })
    doc.addEventListener(
      "wheel",
      (event) => {
        const page = this.page()
        if (!page || event.ctrlKey || !page.contains(event.target) || !this.settings.overscroll) return
        const atTop = page.scrollTop <= 0
        const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 1
        const dy = event.deltaY
        // Chromium decides whether a whole gesture scrolls the page at its first event: once a
        // pull has cancelled one, the rest of that gesture can't scroll it natively, so going
        // back the other way, the page is scrolled here instead. This lasts until a gesture
        // shows it scrolls natively again (its events can't be cancelled) or the scrolling
        // stops for a moment. (The trackpad helper's touch-down can arrive after a gesture's
        // first events, so it can't be what ends this: a gesture cancelled at its start but
        // left to scroll natively would be stuck.)
        const now = performance.now()
        if (!event.cancelable || now - lastWheel > HELD_GAP_MS) held = false
        lastWheel = now
        if (!raw && !((atTop && dy < 0) || (atBottom && dy > 0))) {
          if (held) {
            event.preventDefault()
            page.scrollTop += dy
          }
          return
        }
        event.preventDefault()
        held = true
        if (settled) return
        if (!raw) {
          el = sizer()
          if (el) el.getAnimations().forEach((a) => a.cancel())
        }
        if (lifted && !raw) {
          // A flick's momentum running into the end: the page carries on past
          // it as far as its speed takes it and springs straight back, as
          // macOS pages do, and the rest of the momentum is ignored (holding
          // the page out until the momentum ran out was the pause).
          settled = true
          if (!el || reduceMotion()) return
          const past = -Math.sign(dy) * Math.min(Math.abs(dy) * BOUNCE_PER_PX, OVERSCROLL_MAX * 0.6)
          el.animate(
            [
              { transform: "none", easing: "cubic-bezier(0.25, 0.8, 0.4, 1)" },
              { transform: `translateY(${past}px)`, offset: 0.3, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
              { transform: "none" },
            ],
            { duration: BOUNCE_MS }
          )
          return
        }
        const next = raw - dy
        // Scrolling back in past the end lets the page scroll normally again.
        if (raw && Math.sign(next) !== Math.sign(raw)) {
          release(true)
          page.scrollTop += -next // the rest of this scroll goes into the page
          return
        }
        raw = next
        pull()
        // Momentum (or, without the helper, any scroll) ends with a pause.
        win.clearTimeout(timer)
        if (lifted || !phases)
          timer = win.setTimeout(release, 110)
      },
      { passive: false }
    )
  }

  /**
   * Opening or closing the properties morphs the panel from its heading:
   * closed, it's a small pill around "› Properties"; it grows out of that
   * into the full panel (or shrinks back into it) while the rows fade. The
   * preview toggles them itself, since Obsidian's own toggle runs its own
   * animation that would fight this one.
   */
  attachPropertiesMorph(doc) {
    const win = doc.defaultView
    win.addEventListener(
      "click",
      (event) => {
        const heading = event.target.closest && event.target.closest(".metadata-properties-heading")
        const panel = heading && heading.closest(".metadata-container")
        if (!panel) return
        event.stopImmediatePropagation()
        event.preventDefault()
        this.toggleProperties(panel, !panel.classList.contains("is-collapsed"))
      },
      true
    )
  }

  toggleProperties(panel, close, animate = true) {
    const win = panel.ownerDocument.defaultView
    const heading = panel.querySelector(".metadata-properties-heading")
    const content = panel.querySelector(".metadata-content")
    const from = panel.getBoundingClientRect()
    panel.getAnimations().forEach((a) => a.cancel())
    if (content) content.getAnimations().forEach((a) => a.cancel())
    panel.classList.remove("is-morphing")
    for (const el of [panel, heading, heading && heading.querySelector(".collapse-indicator")])
      if (el) el.classList.toggle("is-collapsed", close)
    if (content) {
      content.style.removeProperty("--pip-props-width")
      content.style.removeProperty("min-height")
      content.style.removeProperty("overflow-y")
      content.style.display = close ? "none" : ""
    }
    const to = panel.getBoundingClientRect()
    if (!animate || reduceMotion()) return this.updateRail()
    panel.classList.add("is-morphing")
    // The rows keep the open panel's width while it grows or shrinks, so they don't rewrap.
    const open = close ? from : to
    const style = win.getComputedStyle(panel)
    if (content) {
      content.style.display = ""
      content.style.setProperty(
        "--pip-props-width",
        `${open.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`
      )
      content.animate(close ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], {
        duration: PROPERTIES_MORPH_MS * 0.7,
        easing: "ease-out",
        fill: "both",
      })
    }
    const morph = panel.animate(
      [
        { width: `${from.width}px`, height: `${from.height}px` },
        { width: `${to.width}px`, height: `${to.height}px` },
      ],
      { duration: PROPERTIES_MORPH_MS, easing: SWITCH.ease }
    )
    morph.finished.then(() => {
      panel.classList.remove("is-morphing")
      if (content) {
        content.getAnimations().forEach((a) => a.cancel())
        content.style.removeProperty("--pip-props-width")
        content.style.display = panel.classList.contains("is-collapsed") ? "none" : ""
      }
      this.updateRail()
    }, () => {})
  }

  /**
   * The frame's edges grow into bars while the cursor is near them
   * (styles.css): the top into the page's buttons, the bottom into the
   * switcher, the right into the section rail. Each opens when the cursor
   * comes within the first distance of its edge and closes once it's past
   * the second.
   */
  attachEdges(doc) {
    const body = doc.body
    const win = doc.defaultView
    const edge = (cls, near, opens, openUntil) =>
      body.classList.toggle(cls, near < (body.classList.contains(cls) ? openUntil : opens))
    doc.addEventListener("mousemove", (event) => {
      edge("is-near-top", event.clientY, EDGES.top[0], EDGES.top[1])
      edge("is-near-bottom", win.innerHeight - event.clientY, EDGES.bottom[0], EDGES.bottom[1])
      edge("is-near-right", win.innerWidth - event.clientX, EDGES.right[0], EDGES.right[1])
    })
    doc.documentElement.addEventListener("mouseleave", () => {
      body.classList.remove(
        "is-near-top",
        "is-near-bottom",
        "is-near-right",
        "is-switcher-open",
        "is-rail-open"
      )
    })
  }

  /**
   * Opens a part (the rail's labels) while any of its elements is hovered,
   * closing a moment after the cursor leaves them all.
   */
  hoverOpen(els, cls, onOpen) {
    const body = els[0].ownerDocument.body
    const win = els[0].ownerDocument.defaultView
    let timer = 0
    for (const el of els) {
      el.addEventListener("mouseenter", () => {
        win.clearTimeout(timer)
        if (body.classList.contains(cls)) return
        body.classList.add(cls)
        if (onOpen) onOpen()
      })
      el.addEventListener("mouseleave", () => {
        timer = win.setTimeout(() => body.classList.remove(cls), 220)
      })
    }
  }

  /**
   * Pointer drags (mouse, trackpad click-drag or three-finger drag) on the
   * top bar move the window; the window follows the cursor from Electron's
   * main process (pip-main.js), and letting go throws it.
   */
  attachDrag(doc) {
    let press = null
    doc.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !this.pip) return
      const tucked = !!this.settings.tucked
      if (!tucked) {
        const target = event.target.closest ? event.target : null
        if (!target || !target.closest(HANDLE) || target.closest(INTERACTIVE))
          return
      }
      press = { id: event.pointerId, x: event.screenX, y: event.screenY, tucked }
    })
    doc.addEventListener("pointermove", (event) => {
      if (!press || press.dragging || event.pointerId !== press.id) return
      if (
        Math.hypot(event.screenX - press.x, event.screenY - press.y) <
        DRAG_THRESHOLD
      )
        return
      press.dragging = true
      if (event.target.setPointerCapture)
        event.target.setPointerCapture(event.pointerId)
      this.pip.dragStart()
    })
    const end = (event) => {
      if (!press || event.pointerId !== press.id) return
      const { dragging, tucked } = press
      press = null
      if (!this.pip) return
      if (dragging) this.pip.dragEnd()
      // A click on a tucked window's handle brings it back.
      else if (tucked && event.type === "pointerup") this.pip.untuck()
    }
    doc.addEventListener("pointerup", end)
    doc.addEventListener("pointercancel", end)
    doc.addEventListener(
      "click",
      (event) => {
        if (!this.settings.tucked) return
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )
  }

  /**
   * Two-finger swipes on the top bar (or a tucked window's handle) move the
   * window: pip-main.js handles them from the trackpad's own events, so here
   * they only mustn't scroll anything. Swipes over the page scroll it.
   */
  attachSwipe(doc) {
    let blocking = false
    let timer = 0
    doc.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) return
        // A gesture keeps whatever it started as, even once the bar moves out from under it.
        if (!timer)
          blocking =
            !!this.settings.tucked ||
            event.clientY <= doc.querySelector(HANDLE).getBoundingClientRect().bottom
        window.clearTimeout(timer)
        timer = window.setTimeout(() => (timer = 0), 120)
        if (blocking) event.preventDefault()
      },
      { passive: false }
    )
  }

  /** The page fades out at its top and bottom while there's more to scroll that way (styles.css). */
  attachScrollFades(doc) {
    const update = (el) => {
      el.classList.toggle("has-above", el.scrollTop > 1)
      el.classList.toggle(
        "has-below",
        el.scrollTop + el.clientHeight < el.scrollHeight - 1
      )
    }
    doc.addEventListener(
      "scroll",
      (event) => {
        const el = event.target
        if (el.classList && el.classList.contains("markdown-preview-view"))
          update(el)
      },
      { capture: true, passive: true }
    )
    this.updateFades = () => {
      const el =
        this.leaf &&
        this.leaf.view.containerEl.querySelector(".markdown-preview-view")
      if (el) update(el)
    }
  }

  /** A tucked window shows only its handle (styles.css). */
  showTucked() {
    const doc = this.leaf && this.leaf.view.containerEl.ownerDocument
    if (!doc || doc === document) return
    doc.body.classList.toggle("is-tucked-left", this.settings.tucked === "left")
    doc.body.classList.toggle("is-tucked-right", this.settings.tucked === "right")
  }

  closeWindow() {
    if (this.pip) this.pip.dispose()
    this.pip = null
    if (this.leaf && this.leaf.view && this.leaf.view.containerEl.isConnected)
      this.leaf.detach()
    this.leaf = null
    this.win = null
    this.updateFades = null
    this.ui = null
    this.markCurrent(null)
  }
}

class MutaSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display() {
    const { containerEl } = this
    const plugin = this.plugin
    const save = async (key, value) => {
      plugin.settings[key] = value
      await plugin.saveData(plugin.settings)
      plugin.applySettings()
    }
    containerEl.empty()

    new SettingGroup(containerEl)
      .setHeading("Look")
      .addSetting((s) =>
        s
          .setName("Liquid Glass")
          .setDesc("The desktop shows through the window, blurred (macOS 26 or later). Off, the window is a plain tint.")
          .addToggle((t) => t.setValue(plugin.settings.glass).onChange((v) => save("glass", v)))
      )
      .addSetting((s) =>
        s
          .setName("Glass style")
          .setDesc("Regular blurs what's behind the window; clear barely does.")
          .addDropdown((d) =>
            d
              .addOptions({ regular: "Regular", clear: "Clear" })
              .setValue(plugin.settings.glassStyle)
              .onChange((v) => save("glassStyle", v))
          )
      )
      .addSetting((s) =>
        s
          .setName("Darkness")
          .setDesc("How dark the window is over the glass, so the page stays readable.")
          .addSlider((sl) =>
            sl
              .setLimits(0, 100, 5)
              .setValue(Math.round(plugin.settings.darkness * 100))
              .setDynamicTooltip()
              .onChange((v) => save("darkness", v / 100))
          )
      )
      .addSetting((s) =>
        s
          .setName("Mark the previewed note")
          .setDesc("Links to the note in the window turn yellow in Obsidian's other windows and the file list.")
          .addToggle((t) => t.setValue(plugin.settings.markPreviewed).onChange((v) => save("markPreviewed", v)))
      )

    new SettingGroup(containerEl)
      .setHeading("Behaviour")
      .addSetting((s) =>
        s
          .setName("Show on every Space")
          .setDesc("The window stays in the same place on every Space and over full-screen apps.")
          .addToggle((t) => t.setValue(plugin.settings.allSpaces).onChange((v) => save("allSpaces", v)))
      )
      .addSetting((s) =>
        s
          .setName("Swipe to move")
          .setDesc("Two-finger swipes on the top bar move the window, like dragging it.")
          .addToggle((t) => t.setValue(plugin.settings.swipeToMove).onChange((v) => save("swipeToMove", v)))
      )
      .addSetting((s) =>
        s
          .setName("Overscroll")
          .setDesc("Pages pull past their top and bottom and spring back.")
          .addToggle((t) => t.setValue(plugin.settings.overscroll).onChange((v) => save("overscroll", v)))
      )

    new SettingGroup(containerEl)
      .setHeading("Order")
      .addSetting((s) =>
        s
          .setName("Order notes")
          .setDesc(
            "Notes whose lists of links set the order the bottom bar steps through, " +
              "grouped by their headings and callouts. Glob patterns, one per line " +
              "(like Roadmap/*.md). Empty: the links on the note you hovered from."
          )
          .addTextArea((text) =>
            text
              .setPlaceholder("Roadmap/*.md")
              .setValue(plugin.settings.orderNotes)
              .onChange(async (value) => {
                plugin.items = null
                await save("orderNotes", value)
              })
          )
      )
  }
}
