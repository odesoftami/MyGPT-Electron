const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: "MyGPT",
        autoHideMenuBar: true,
        icon: path.join(__dirname, "MyGPT.icns")
    });

    win.removeMenu();

    win.webContents.setWindowOpenHandler(({ url }) => {
        win.loadURL(url);
        return { action: "deny" };
    });

    win.loadURL("https://chatgpt.com");

    win.on("page-title-updated", (event) => {
        event.preventDefault();
        win.setTitle("MyGPT");
    });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
