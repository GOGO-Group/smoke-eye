"use strict";
// Dev launcher. VS Code (and some terminals) export ELECTRON_RUN_AS_NODE=1 for
// the processes they spawn; with it set, the Electron binary runs as plain
// Node, require("electron") returns a path string instead of the API, and the
// app crashes immediately at startup. Strip it, then launch Electron normally.
// Shell-independent (works whether npm runs scripts via cmd or sh).
const cp = require("child_process");
const path = require("path");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Under plain Node, require("electron") resolves to the Electron binary path.
const electron = require("electron");
const child = cp.spawn(electron, [path.join(__dirname, "..")], {
  env,
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code == null ? 0 : code));
