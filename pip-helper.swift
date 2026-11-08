// Reports trackpad swipes to the preview window, with what Electron's wheel
// events leave out: when the fingers touch down and lift (the gesture's
// phase), so a swipe never has to be guessed at.
//
// stdout, one line per two-finger scroll event, anywhere on screen:
//   <phase> <momentumPhase> <x> <y> <dx> <dy> <natural> <ms>
// (x, y: cursor, top-left origin like Electron; dx, dy: scrolling deltas;
// natural: 1 when scrolling is natural; ms: the event's time.)
// stdin, one command per line:
//   w <x> <y>   moves the cursor there (so it rides along with the window)
//
// Watching another app's scroll events needs no permission; the helper only
// reads them and never changes or blocks them.
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

NSEvent.addGlobalMonitorForEvents(matching: .scrollWheel) { event in
  guard event.hasPreciseScrollingDeltas, let cg = event.cgEvent else { return }
  let p = cg.location
  print(
    event.phase.rawValue, event.momentumPhase.rawValue,
    Int(p.x), Int(p.y),
    event.scrollingDeltaX, event.scrollingDeltaY,
    event.isDirectionInvertedFromDevice ? 1 : 0,
    Int(event.timestamp * 1000)
  )
}

FileHandle.standardInput.readabilityHandler = { handle in
  let data = handle.availableData
  if data.isEmpty { exit(0) }  // the preview closed
  guard let text = String(data: data, encoding: .utf8) else { return }
  for line in text.split(separator: "\n") {
    let parts = line.split(separator: " ")
    guard parts.count == 3, parts[0] == "w",
      let x = Double(parts[1]), let y = Double(parts[2])
    else { continue }
    DispatchQueue.main.async {
      CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
      // Without this, a warp pauses the mouse for a quarter second.
      CGAssociateMouseAndMouseCursorPosition(1)
    }
  }
}

app.run()
