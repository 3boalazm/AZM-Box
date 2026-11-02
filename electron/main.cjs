const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");

// Three launch modes:
//  - packaged installer build            -> load dist (isDev = false)
//  - `npm run electron:dev`              -> load the Vite dev server, open devtools
//  - the double-click launchers          -> PACKBOX_DIST=1: freshly `vite build`-ed
//    dist is loaded directly, no dev server and no devtools. This is what lets the
//    launcher app always run the LATEST source without an install/packaging step.
const isDev = !app.isPackaged && process.env.PACKBOX_DIST !== "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#14161c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The renderer asks to block unload when the design has unsaved changes. Electron
  // would otherwise swallow the close silently, so ask the user what to do.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "You have unsaved changes.",
      detail: "Your design is autosaved on this device, but it has not been saved to a .pbox file. Leave anyway?",
    });
    if (choice === 0) event.preventDefault(); // preventDefault() here means "ignore the block, close"
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
