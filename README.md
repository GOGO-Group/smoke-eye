# Floating Controller (Electron)

Electron-based window controller with a canvas dial UI and native Win32 window
control.

## Project Layout

```
main.js              Electron main process
preload.js           controller window bridge
settings-preload.js   settings window bridge
renderer/            dial UI and settings UI
native/              Win32 backend and persistence helpers
license-generator/   standalone signed-license generator
```

## Run

```bash
npm install
npm run setup-x86   # fetches the 32-bit helper (koffi ia32 + node x86) — see below
npm start
```

### 32-bit (WOW64) window support

The app is a 64-bit build. Applying **Safe** (capture protection) to a *64-bit*
window is done in-process. For a *32-bit* window — e.g. VMware Workstation's
`vmware.exe` — a 64-bit process can't inject native code directly, so the work
is delegated to a bundled 32-bit `node` that injects an x86 stub calling the
32-bit `SetWindowDisplayAffinity` (see `native/inject32.js`).

`npm run setup-x86` downloads the two pieces this needs into `vendor/node32`
(the 32-bit node runtime) and `node_modules/@koromix/koffi-win32-ia32` (the
32-bit koffi prebuilt, which a normal `npm install` skips on an x64 host). Both
are gitignored; `electron-builder` bundles them into the packaged app. Without
this step, 32-bit targets report `32-bit helper runtime missing`.

## License

The Safe quadrant is disabled until a valid `license.json` exists in the app's
user data folder. Generate one with the license generator project:

```bash
cd license-generator
npm run generate -- --name "Customer Name" --out ../license.json --expires 2027-12-31
```

Copy the generated file to the app's user data folder as `license.json`.

## Use

- **Center hub** — drag to target a window.
- **Top / Safe / Thru** — target actions for the selected window.
- **More** — opacity, process list, and move controls.
- **Move settings** — configure a modifier chord for moving the controller and
  a separate chord for nudging the selected window.
- **Right click** — opens a context menu with Settings and Exit.
