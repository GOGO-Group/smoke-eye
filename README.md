# Floating Controller (Electron)

An Electron version of the round pie-controller. The UI is HTML/Canvas (true
anti-aliased round window, native transparency); all Win32 window control is
delegated to the existing Python `windowctl` via a small JSON-over-stdio bridge.

```
electron/
  main.js            Electron main: spawns the bridge, creates the window, IPC
  preload.js         contextBridge -> window.api
  bridge.py          Python backend wrapping ../windowctl.py + ../processes.py
  renderer/          the dial UI (index.html, style.css, renderer.js)
```

## Run

Requires **Node.js**, **Python**, and `psutil` (`pip install psutil`) — the
bridge imports `windowctl.py`/`processes.py` from the parent folder.

```
cd electron
npm install
npm start
```

## Use

- **Center hub** — drag it onto any window to target it (Python reads the
  physical cursor position, so it is DPI-correct).
- **Quadrants** (after a target is picked): **Top** = always-on-top,
  **Safe** = capture-protect (+taskbar hide), **Thru** = click-through.
  Active flags tint their quadrant green.
- **Click the hub** to show/hide the outer ring; collapsed it is just a circle.
- **More** (bottom) — a filterable process list + Use / Refresh / Restore.
- **Right-drag** the dial to move it; **Esc** to quit.

Capture-protect on another app's window uses `windowctl`'s remote-thread
injection, exactly like the desktop app.
