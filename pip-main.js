/*
 * The preview window's movement, run in Electron's main process, where the
 * window lives: moving it from there takes no round trip, so it follows a
 * drag or swipe every frame and its spring runs on its own clock, whatever
 * the page is doing.
 *
 * Drags follow the cursor itself. Swipes come from pip-helper, which sees
 * the trackpad's own events: the moment the fingers touch, every movement,
 * and the moment they lift. While a swipe carries the window, the cursor
 * rides along on the top bar, so the swipe keeps landing on it instead of
 * scrolling whatever the window has left behind.
 *
 * Let go and the window coasts on with your momentum (UIKit's projection)
 * and springs to the nearest of eight spots: the corners and the middle of
 * each side. Thrown past the left or right edge, it tucks away there,
 * leaving a handle.
 */
const { BrowserWindow, screen } = require("electron")
const { spawn } = require("child_process")
const readline = require("readline")
const fs = require("fs")
const os = require("os")
const path = require("path")

const MARGIN = 12
/** The most a window can be pulled past the bottom of the screen (px). */
const RUBBER_MAX = 120
const TUCK_VISIBLE = 12
/** Coast distance = velocity (px/s) × this (UIKit's normal deceleration, 0.998/ms). */
const PROJECTION_S = 0.998 / (1 - 0.998) / 1000
/** The landing spring: critically damped, this response (s). */
const SPRING_RESPONSE = 0.42
/** Velocity is measured over this much of the gesture's end (ms). */
const VELOCITY_WINDOW_MS = 80
/** A swipe starting this close to the window's top moves it. */
const BAR = 44
/** Frame interval for following a drag and running the spring (ms). */
const TICK_MS = 1000 / 120

// NSEvent.Phase
const BEGAN = 1
const CHANGED = 4
const ENDED = 8
const CANCELLED = 16

class Tracker {
  constructor() {
    this.samples = []
  }
  add(x, y, t) {
    this.samples.push({ x, y, t })
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW_MS)
      this.samples.shift()
  }
  /** px/s */
  velocity() {
    const s = this.samples
    if (s.length < 2) return { x: 0, y: 0 }
    const a = s[0]
    const b = s[s.length - 1]
    // A last sample long after the motion stopped means it stopped.
    const dt = Math.max(b.t - a.t, 8) / 1000
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
  }
}

/**
 * glass.node, loaded from a copy named after its build: a native module stays
 * loaded for the life of the process, so a rebuild gets a new name.
 */
function loadGlass(dir) {
  try {
    const src = path.join(dir, "glass.node")
    const copy = path.join(os.tmpdir(), `muta-glass-${fs.statSync(src).mtimeMs}.node`)
    if (!fs.existsSync(copy)) fs.copyFileSync(src, copy)
    return require(copy)
  } catch {
    return null // not built or downloaded (yet): the window goes without glass
  }
}

const workArea = (b) => screen.getDisplayMatching(b).workArea

/** One of the eight resting spots for a window of b's size: col and row are 0, 0.5 or 1. */
function spot(col, row, b) {
  const a = workArea(b)
  return {
    x: Math.round(a.x + MARGIN + (a.width - b.width - 2 * MARGIN) * col),
    y: Math.round(a.y + MARGIN + (a.height - b.height - 2 * MARGIN) * row),
    width: b.width,
    height: b.height,
  }
}

/** Off the side of the screen but its handle. */
/** How far past a limit a rubber band lets you go (iOS's formula): less and less, never more than RUBBER_MAX. */
const rubber = (d) => (1 - 1 / ((d * 0.55) / RUBBER_MAX + 1)) * RUBBER_MAX

function tuckedBounds(b, side) {
  const a = workArea(b)
  const x =
    side === "left" ? a.x - b.width + TUCK_VISIBLE : a.x + a.width - TUCK_VISIBLE
  return { ...b, x }
}

class Pip {
  /**
   * windowId: the preview window.
   * dir: this plugin's folder (pip-helper and glass.node).
   * glass: glass.node's options for the window's look, or null for none.
   * swipes: whether two-finger swipes on the top bar move the window.
   * state: { bounds, tucked } where it was left.
   * onSettle({ bounds, tucked }): where it was put, to keep.
   */
  constructor({ windowId, dir, glass, swipes, state, onSettle }) {
    this.window = BrowserWindow.fromId(windowId)
    this.dir = dir
    this.native = loadGlass(dir)
    this.setGlass(glass)
    // Clicks in it don't bring Obsidian forward over the app you're in.
    if (this.native) this.native.preventActivation(this.window.getNativeWindowHandle())
    this.state = { bounds: state.bounds || null, tucked: state.tucked || null }
    this.onSettle = onSettle
    this.timer = null
    this.spring = null
    this.drag = null
    this.swipe = null
    this.helper = null
    this.setSwipes(swipes)
    // macOS pulls a window that's mostly off screen back on as it first
    // appears; a tucked one goes back where it belongs once it's shown.
    if (this.state.tucked) {
      const start = tuckedBounds(this.state.bounds || spot(1, 1, this.bounds()), this.state.tucked)
      setTimeout(() => {
        if (this.alive() && !this.drag && !this.spring && !this.swipe)
          this.window.setBounds(start)
      }, 400)
    }
  }

  alive() {
    return !!(this.window && !this.window.isDestroyed())
  }

  // ── Placement ─────────────────────────────────────────────────────────

  bounds() {
    return this.window.getBounds()
  }

  move(x, y) {
    this.window.setPosition(Math.round(x), Math.round(y))
  }

  /**
   * Where a window following a drag or swipe to (x, y) can actually be:
   * macOS stops windows at the menu bar, so it stops there, and past the
   * bottom of the screen it gives way less and less, like a rubber band.
   * (Sideways it goes freely, to be tucked away.)
   */
  limit(x, y) {
    const b = this.bounds()
    const a = workArea({ ...b, x, y })
    const top = a.y
    const bottom = a.y + a.height - b.height
    if (y < top) y = top
    else if (y > bottom) y = bottom + rubber(y - bottom)
    return { x, y }
  }

  // ── Throwing ──────────────────────────────────────────────────────────

  /** Coasts on with the velocity, then lands on the nearest spot or tucks away. */
  fling(velocity) {
    if (!this.alive()) return
    const b = this.bounds()
    const a = workArea(b)
    const cx = b.x + b.width / 2 + velocity.x * PROJECTION_S
    const cy = b.y + b.height / 2 + velocity.y * PROJECTION_S
    let target
    if (cx < a.x || cx > a.x + a.width) {
      const side = cx < a.x ? "left" : "right"
      const out = spot(side === "right" ? 1 : 0, 0, b)
      out.y = Math.round(
        Math.min(
          Math.max(cy - b.height / 2, a.y + MARGIN),
          a.y + a.height - b.height - MARGIN
        )
      )
      this.state = { bounds: out, tucked: side }
      target = tuckedBounds(out, side)
    } else {
      const spots = []
      for (const col of [0, 0.5, 1])
        for (const row of [0, 0.5, 1])
          if (col !== 0.5 || row !== 0.5) spots.push(spot(col, row, b))
      const distance = (s) =>
        Math.hypot(s.x + s.width / 2 - cx, s.y + s.height / 2 - cy)
      target = spots.reduce((best, s) => (distance(s) < distance(best) ? s : best))
      this.state = { bounds: target, tucked: null }
    }
    this.settled()
    this.springTo(target, velocity)
  }

  untuck() {
    if (!this.alive() || !this.state.tucked) return
    this.state = {
      bounds: this.state.bounds || spot(1, 1, this.bounds()),
      tucked: null,
    }
    this.settled()
    this.springTo(this.state.bounds, { x: 0, y: 0 })
  }

  settled() {
    try {
      this.onSettle({ ...this.state })
    } catch {}
  }

  /** Critically damped spring from the current spot and velocity to target. */
  springTo(target, velocity) {
    const b = this.bounds()
    this.spring = { x: b.x, y: b.y, vx: velocity.x, vy: velocity.y, target }
    this.tick()
  }

  stepSpring(dtMs) {
    const s = this.spring
    const omega = (2 * Math.PI) / SPRING_RESPONSE
    let dt = Math.min(dtMs / 1000, 0.05)
    while (dt > 0) {
      const h = Math.min(dt, 1 / 480)
      for (const [k, v, t] of [
        ["x", "vx", s.target.x],
        ["y", "vy", s.target.y],
      ]) {
        const accel = -omega * omega * (s[k] - t) - 2 * omega * s[v]
        s[v] += accel * h
        s[k] += s[v] * h
      }
      dt -= h
    }
    const done =
      Math.abs(s.x - s.target.x) < 0.5 &&
      Math.abs(s.y - s.target.y) < 0.5 &&
      Math.hypot(s.vx, s.vy) < 20
    if (done) {
      this.move(s.target.x, s.target.y)
      this.spring = null
    } else this.move(s.x, s.y)
  }

  // ── The clock: follows a drag and runs the spring ─────────────────────

  tick() {
    if (this.timer) return
    let last = performance.now()
    const run = () => {
      const now = performance.now()
      const dt = now - last
      last = now
      if (!this.alive()) return this.stopClock()
      if (this.drag) this.followDrag(now)
      else if (this.spring) this.stepSpring(dt)
      if (this.drag || this.spring) this.timer = setTimeout(run, TICK_MS)
      else this.stopClock()
    }
    this.timer = setTimeout(run, TICK_MS)
  }

  stopClock() {
    clearTimeout(this.timer)
    this.timer = null
  }

  // ── Dragging: the page reports press and release, the cursor is followed here ──

  dragStart() {
    if (!this.alive()) return
    this.spring = null
    this.swipe = null
    const c = screen.getCursorScreenPoint()
    const b = this.bounds()
    this.drag = { ox: c.x - b.x, oy: c.y - b.y, tracker: new Tracker() }
    this.drag.tracker.add(b.x, b.y, performance.now())
    this.setMoving(true)
    this.tick()
  }

  followDrag(now) {
    const c = screen.getCursorScreenPoint()
    const raw = { x: c.x - this.drag.ox, y: c.y - this.drag.oy }
    this.drag.tracker.add(raw.x, raw.y, now)
    const { x, y } = this.limit(raw.x, raw.y)
    const b = this.bounds()
    if (Math.round(x) !== b.x || Math.round(y) !== b.y) this.move(x, y)
  }

  dragEnd() {
    if (!this.drag) return
    this.followDrag(performance.now())
    const v = this.drag.tracker.velocity()
    this.drag = null
    this.setMoving(false)
    this.fling(v)
  }

  // ── Swiping, from pip-helper's trackpad events ────────────────────────

  /** The next native menu pops up over this window (patchMenuPopup). */
  menuFromPreview() {
    if (!this.alive()) return
    global.__mutaMenuTarget = { windowId: this.window.id, at: Date.now() }
  }

  /** Liquid Glass behind the page (glass.node's options), or none (null). */
  setGlass(options) {
    if (!this.native || !this.alive()) return
    const handle = this.window.getNativeWindowHandle()
    if (options) this.native.apply(handle, options)
    else this.native.remove(handle)
  }

  /** Swipes move the window while the trackpad helper runs. */
  setSwipes(on) {
    if (on && !this.helper) this.startHelper(path.join(this.dir, "pip-helper"))
    if (!on && this.helper) {
      try {
        this.helper.stdin.end()
        this.helper.kill()
      } catch {}
      this.helper = null
      this.swipe = null
    }
  }

  startHelper(path) {
    if (!path) return
    try {
      this.helper = spawn(path, [], { stdio: ["pipe", "pipe", "ignore"] })
      this.helper.on("error", () => (this.helper = null))
      this.helper.on("exit", () => (this.helper = null))
      readline
        .createInterface({ input: this.helper.stdout })
        .on("line", (line) => this.onScroll(line))
    } catch {
      this.helper = null
    }
  }

  onScroll(line) {
    if (!this.alive()) return
    const [phase, momentum, x, y, dx, dy, natural, ms] = line.split(" ").map(Number)
    if (momentum) {
      // The page's own momentum starting: tell it, in case its lift was missed.
      if (momentum === BEGAN && this.touchedPage) this.sendPage("momentum")
      return // the window's throw has its own momentum
    }
    this.tellPage(phase, x, y)
    if (phase === BEGAN) return this.swipeBegan(x, y, ms)
    if (!this.swipe) return
    if (phase === CHANGED) this.swipeMoved(dx, dy, natural, ms)
    else if (phase === ENDED || phase === CANCELLED) this.swipeEnded(ms)
  }

  /**
   * Tells the page when fingers touch down on the window and lift again,
   * which its own wheel events can't tell it (the bottom bar's swipes go by
   * them).
   */
  tellPage(phase, x, y) {
    let event = null
    if (phase === BEGAN) {
      const b = this.bounds()
      this.touching = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
      this.touchedPage = this.touching
      if (this.touching) event = "began"
    } else if ((phase === ENDED || phase === CANCELLED) && this.touching) {
      this.touching = false
      event = "ended"
    }
    if (event) this.sendPage(event)
  }

  sendPage(event) {
    if (this.window.isDestroyed()) return
    this.window.webContents
      .executeJavaScript(`window.mutaGesture && window.mutaGesture("${event}")`)
      .catch(() => {})
  }

  swipeBegan(x, y, ms) {
    this.swipe = null
    if (this.drag) return
    const b = this.bounds()
    const inside = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    if (!inside) return
    // Any swipe on a tucked window's handle brings it back.
    if (this.state.tucked) return this.untuck()
    if (y >= b.y + BAR) return // over the page: it scrolls
    this.spring = null
    this.swipe = {
      x: b.x,
      y: b.y,
      ox: x - b.x,
      oy: y - b.y,
      fingers: { x: 0, y: 0 },
      tracker: new Tracker(),
    }
    this.swipe.tracker.add(0, 0, ms)
    this.setMoving(true)
  }

  swipeMoved(dx, dy, natural, ms) {
    const s = this.swipe
    // The window follows the fingers, whichever way scrolling goes.
    const sign = natural ? 1 : -1
    const fx = dx * sign
    const fy = dy * sign
    s.fingers.x += fx
    s.fingers.y += fy
    s.tracker.add(s.fingers.x, s.fingers.y, ms)
    s.x += fx
    s.y += fy
    // The cursor rides along where the window actually is, so a window held
    // at the menu bar doesn't lose it.
    const at = this.limit(s.x, s.y)
    this.move(at.x, at.y)
    this.warp(at.x + s.ox, at.y + s.oy)
  }

  swipeEnded(ms) {
    // Fingers that rested before lifting throw nothing.
    this.swipe.tracker.add(this.swipe.fingers.x, this.swipe.fingers.y, ms)
    const v = this.swipe.tracker.velocity()
    this.swipe = null
    this.setMoving(false)
    this.fling(v)
  }

  warp(x, y) {
    if (this.helper) this.helper.stdin.write(`w ${Math.round(x)} ${Math.round(y)}\n`)
  }

  /** Keeps the preview's top bar open while it moves (styles.css). */
  setMoving(on) {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents
      .executeJavaScript(`document.body.classList.toggle("is-dragging", ${on})`)
      .catch(() => {})
  }

  dispose() {
    this.stopClock()
    this.drag = null
    this.spring = null
    this.swipe = null
    if (this.helper) {
      try {
        this.helper.stdin.end()
        this.helper.kill()
      } catch {}
    }
    this.helper = null
  }
}

/** One preview at a time; a new one (or a plugin reload) replaces the old. */
exports.create = (options) => {
  if (global.__muta) global.__muta.dispose()
  global.__muta = new Pip(options)
  patchMenuPopup()
  return global.__muta
}

/** Where a new window starts: where it was left, or the bottom-right corner. */
exports.placement = ({ bounds, tucked, size }) => {
  const b = bounds || spot(1, 1, { ...screen.getCursorScreenPoint(), ...size })
  return tucked ? tuckedBounds(b, tucked) : b
}

exports.dispose = () => {
  if (global.__muta) global.__muta.dispose()
  global.__muta = null
  global.__mutaMenuPopup = null
}

/**
 * Obsidian's native menus pop up over its main window, wherever the click
 * was. A menu opened from the preview (it says so just before, through
 * menuFromPreview) pops up over the preview window instead, at the button.
 * Electron's Menu.popup is wrapped once per Obsidian run; the wrapper calls
 * whatever this file last set as global.__mutaMenuPopup, so a reloaded
 * version takes over and a disposed one (null) leaves menus alone.
 */
function patchMenuPopup() {
  global.__mutaMenuPopup = (options) => {
    const target = global.__mutaMenuTarget
    global.__mutaMenuTarget = null
    if (!target || Date.now() - target.at > 500) return options
    const win = BrowserWindow.fromId(target.windowId)
    return win && !win.isDestroyed() ? { ...(options || {}), window: win } : options
  }
  if (global.__mutaMenus) return
  global.__mutaMenus = true
  const { Menu } = require("electron")
  const popup = Menu.prototype.popup
  Menu.prototype.popup = function (options) {
    const redirect = global.__mutaMenuPopup
    return popup.call(this, redirect ? redirect(options) : options)
  }
}
