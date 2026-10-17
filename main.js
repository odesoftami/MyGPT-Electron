const {
    app,
    BrowserWindow,
    Menu,
    shell,
    clipboard,
    session,
    nativeTheme,
    webContents
} = require("electron");

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");

const START_URL = "https://chatgpt.com";
const APP_TITLE = `MyGPT — Electron v${app.getVersion()}`;
const ICON_PATH = path.join(__dirname, "MyGPT.icns");
const SMOKE = process.env.MYGPT_SMOKE === "1";

if (SMOKE) {
    app.setPath("userData", path.join(os.tmpdir(), "mygpt-smoke-profile"));
}

const INTERNAL_DOMAINS = [
    "chatgpt.com",
    "openai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "accounts.google.com",
    "accounts.youtube.com",
    "myaccount.google.com",
    "gstatic.com",
    "googleusercontent.com",
    "appleid.apple.com",
    "idmsa.apple.com",
    "login.microsoftonline.com",
    "login.live.com"
];

const AUTH_HOSTS = new Set([
    "accounts.google.com",
    "accounts.youtube.com",
    "myaccount.google.com",
    "appleid.apple.com",
    "idmsa.apple.com",
    "login.microsoftonline.com",
    "login.live.com",
    "auth.openai.com"
]);

const BLACK_THEME_CSS = `
    :root, html.dark {
        --bg-primary: #000000 !important;
        --bg-elevated-primary: #000000 !important;
        --bg-elevated-secondary: #000000 !important;
        --bg-secondary-surface: #000000 !important;
        --component-sidebar-bg: #000000 !important;
    }
    html, body {
        background-color: #000000 !important;
    }
`;

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

let settings = { pureBlack: true };
const themeCssKeys = new Map();

function loadSettings() {
    try {
        const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
        settings = { ...settings, ...raw };
    } catch {
        // Первый запуск — используем значения по умолчанию.
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch {
        // Не критично: настройка просто не сохранится.
    }
}

function parseHttpUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
        return null;
    }
}

function hostMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
}

function isInternalUrl(rawUrl) {
    const url = parseHttpUrl(rawUrl);
    if (!url) return false;

    const host = url.hostname.toLowerCase();
    return INTERNAL_DOMAINS.some((domain) => hostMatches(host, domain));
}

function isAuthUrl(rawUrl) {
    const url = parseHttpUrl(rawUrl);
    return Boolean(url) && AUTH_HOSTS.has(url.hostname.toLowerCase());
}

function isChatGptUrl(rawUrl) {
    const url = parseHttpUrl(rawUrl);
    return Boolean(url) && hostMatches(url.hostname.toLowerCase(), "chatgpt.com");
}

function openExternally(rawUrl) {
    if (!rawUrl) return;

    if (/^mailto:/i.test(rawUrl)) {
        shell.openExternal(rawUrl).catch(() => {});
        return;
    }

    if (!/^https?:\/\//i.test(rawUrl)) return;

    if (process.platform === "darwin") {
        execFile("open", ["-a", "Google Chrome", rawUrl], (error) => {
            if (error) shell.openExternal(rawUrl).catch(() => {});
        });
    } else {
        shell.openExternal(rawUrl).catch(() => {});
    }
}

function installNavigationPolicy(contents) {
    contents.setWindowOpenHandler(({ url }) => {
        const isBlank = url === "about:blank";

        if (isBlank || isAuthUrl(url)) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    width: 560,
                    height: 780,
                    parent: contents.getOwnerBrowserWindow() || undefined,
                    backgroundColor: "#000000",
                    autoHideMenuBar: true,
                    webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true
                    }
                }
            };
        }

        if (isInternalUrl(url)) {
            return { action: "allow" };
        }

        openExternally(url);
        return { action: "deny" };
    });

    contents.on("will-navigate", (event, url) => {
        const parsed = parseHttpUrl(url);

        if (!parsed) {
            if (/^(mailto|tel):/i.test(url)) {
                event.preventDefault();
                shell.openExternal(url).catch(() => {});
            }
            return;
        }

        if (!isInternalUrl(url)) {
            event.preventDefault();
            openExternally(url);
        }
    });

    contents.on("will-attach-webview", (event) => event.preventDefault());

    contents.on("dom-ready", () => {
        refreshBlackTheme(contents);
    });
}

async function refreshBlackTheme(contents) {
    if (!contents || contents.isDestroyed()) return;

    const existing = themeCssKeys.get(contents.id);

    if (existing) {
        themeCssKeys.delete(contents.id);

        try {
            await contents.removeInsertedCSS(existing);
        } catch {
            // Документ уже сменился — ничего страшного.
        }
    }

    if (!settings.pureBlack) return;
    if (!isChatGptUrl(contents.getURL())) return;

    try {
        const key = await contents.insertCSS(BLACK_THEME_CSS);
        themeCssKeys.set(contents.id, key);
    } catch {
        // Попробуем при следующем dom-ready.
    }
}

function installContextMenu(contents) {
    contents.on("context-menu", (_event, params) => {
        const template = [];
        const window = BrowserWindow.fromWebContents(contents);

        if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
            template.push(
                {
                    label: "Открыть ссылку в Chrome",
                    click: () => openExternally(params.linkURL)
                },
                {
                    label: "Копировать адрес ссылки",
                    click: () => clipboard.writeText(params.linkURL)
                },
                { type: "separator" }
            );
        }

        if (params.isEditable) {
            template.push(
                { label: "Вырезать", role: "cut" },
                { label: "Копировать", role: "copy" },
                { label: "Вставить", role: "paste" },
                { label: "Выделить всё", role: "selectAll" }
            );
        } else if (params.selectionText) {
            template.push(
                { label: "Копировать", role: "copy" },
                { label: "Выделить всё", role: "selectAll" }
            );
        }

        if (template.length) {
            template.push({ type: "separator" });
        }

        template.push(
            {
                label: "Обновить",
                click: () => contents.reload()
            },
            {
                label: "Открыть ChatGPT в Chrome",
                click: () => openExternally(START_URL)
            }
        );

        Menu.buildFromTemplate(template).popup({ window });
    });
}

// ---------------------------------------------------------------------------
// Собственное окно About
// ---------------------------------------------------------------------------

let aboutWindow = null;

function openAboutWindow() {
    if (aboutWindow && !aboutWindow.isDestroyed()) {
        aboutWindow.show();
        aboutWindow.focus();
        return;
    }

    const version = app.getVersion();
    const electronVersion = process.versions.electron;
    const chromiumVersion = process.versions.chrome;

    const aboutIconPath = path.join(__dirname, "about-icon.png");
    console.log("About icon exists:", fs.existsSync(aboutIconPath));

    const iconUrl = fs.existsSync(aboutIconPath)
        ? `data:image/png;base64,${fs.readFileSync(aboutIconPath).toString("base64")}`
        : "";

    aboutWindow = new BrowserWindow({
        width: 540,
        height: 370,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        title: "About MyGPT",
        backgroundColor: "#1c1c1e",
        icon: ICON_PATH,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About MyGPT</title>

<style>
    * {
        box-sizing: border-box;
    }

    html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #1c1c1e;
        color: #e8e8ea;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
    }

    .content {
        display: flex;
        padding: 28px 25px 20px;
        gap: 22px;
    }

    .icon {
        width: 62px;
        height: 62px;
        flex: 0 0 62px;
        object-fit: contain;
        margin-top: 1px;
    }

    .fallback {
        width: 62px;
        height: 62px;
        flex: 0 0 62px;
        border-radius: 14px;
        display: none;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 25px;
        font-weight: 700;
        letter-spacing: -2px;
        background: linear-gradient(135deg, #1677ff, #00c7be);
    }

    .details {
        min-width: 0;
    }

    h1 {
        font-size: 17px;
        line-height: 22px;
        margin: 0 0 11px;
        font-weight: 650;
    }

    p {
        font-size: 12px;
        line-height: 16px;
        margin: 0;
        color: #d5d5d8;
    }

    .block {
        margin-top: 14px;
    }

    .runtime {
        margin-top: 16px;
    }

    a {
        color: #68a8ff;
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

    .close {
        position: absolute;
        right: 15px;
        bottom: 12px;
        min-width: 84px;
        height: 29px;
        padding: 0 16px;
        border: 1px solid #48484d;
        border-radius: 6px;
        background: #29292c;
        color: #f2f2f4;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    .close:hover {
        background: #38383c;
    }
</style>
</head>

<body>
    <main class="content">
        <img
            class="icon"
            src="${iconUrl}"
            alt=""
            onerror="this.style.display='none';document.querySelector('.fallback').style.display='flex'"
        >

        <div class="fallback">MG</div>

        <section class="details">
            <h1>MyGPT ${version}</h1>

            <p>Black as night—a desktop 💻 / 🖥️ client for macOS 🍎. </p>
            <p>It came into being on a rainy autumn evening in Bucharest 🌧️. </p>
            <p>Created by: Denys Oleksiienko 🧑‍💻</p>

            <div class="block">
                <p>Distributed free 👀 of charge</p>
                <p>For non-commercial use only ⚠️.</p>
            </div>

            <div class="runtime">
                <p>Runtime version: Electron ${electronVersion} 🔎</p>
                <p>Chromium version: 155.0.8059.85 (arm64) ⏳</p>
              </div>

            <div class="block">
                <p>
                    Website 🌐:
                    <a href="https://odesoftami.com/apk">odesoftami.com/apk</a>
                </p>

                <p>
                    GitHub 🚀 :
                    <a href="https://github.com/odesoftami">github.com/odesoftami </a>
                </p>

                <p>Powered by 👉 <a href="https://github.com/odesoftami">open-source software</a></p>
                <p>Copyright © 2014-2026 <a href="https://odesoftami.com/apk">OdeSoftAMI Inc.</a> 🎯</p>

            </div>
        </section>
    </main>

    <button class="close" onclick="window.close()">Close</button>

    <script>
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a");

            if (link) {
                event.preventDefault();
                window.open(link.href, "_blank");
            }
        });
    </script>
</body>
</html>`;

    aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
        const allowedUrls = [
            "https://odesoftami.com/apk",
            "https://github.com/odesoftami"
        ];

        if (allowedUrls.includes(url)) {
            openExternally(url);
        }

        return { action: "deny" };
    });

    aboutWindow.on("closed", () => {
        aboutWindow = null;
    });

    aboutWindow.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`
    );

    aboutWindow.once("ready-to-show", () => {
        if (aboutWindow && !aboutWindow.isDestroyed()) {
            aboutWindow.show();
        }
    });
}

function buildApplicationMenu() {
    const template = [
        {
            role: "appMenu",
            submenu: [
                {
                    label: "О приложении MyGPT",
                    click: openAboutWindow
                },
                { type: "separator" },
                { role: "services", label: "Службы" },
                { type: "separator" },
                { role: "hide", label: "Скрыть MyGPT" },
                { role: "hideOthers", label: "Скрыть остальные" },
                { role: "unhide", label: "Показать все" },
                { type: "separator" },
                { role: "quit", label: "Завершить MyGPT" }
            ]
        },
        {
            role: "editMenu",
            label: "Правка"
        },
        {
            label: "Вид",
            submenu: [
                {
                    label: "Чистый чёрный фон",
                    type: "checkbox",
                    checked: settings.pureBlack,
                    click: (item) => {
                        settings.pureBlack = item.checked;
                        saveSettings();

                        for (const contents of webContents.getAllWebContents()) {
                            refreshBlackTheme(contents);
                        }
                    }
                },
                { type: "separator" },
                { role: "reload", label: "Обновить" },
                { role: "forceReload", label: "Обновить без кэша" },
                { role: "toggleDevTools", label: "Инструменты разработчика" },
                { type: "separator" },
                { role: "resetZoom", label: "Обычный масштаб" },
                { role: "zoomIn", label: "Увеличить" },
                { role: "zoomOut", label: "Уменьшить" },
                { type: "separator" },
                { role: "togglefullscreen", label: "Полноэкранный режим" }
            ]
        },
        {
            role: "windowMenu",
            label: "Окно"
        },
        {
            role: "help",
            label: "Справка",
            submenu: [
                {
                    label: "Открыть ChatGPT в Chrome",
                    click: () => openExternally(START_URL)
                },
                {
                    label: "GitHub проекта",
                    click: () => openExternally(
                        "https://github.com/odesoftami"
                    )
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        show: !SMOKE,
        title: APP_TITLE,
        backgroundColor: "#000000",
        icon: ICON_PATH,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true
        }
    });

    win.on("page-title-updated", (event) => {
        event.preventDefault();
        win.setTitle(APP_TITLE);
    });

    win.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL) => {
            console.error(
                `[MyGPT] Не удалось загрузить ${validatedURL}: ${errorDescription} (${errorCode})`
            );
        }
    );

    if (SMOKE) {
        win.webContents.once("did-finish-load", async () => {
            const theme = await win.webContents
                .executeJavaScript(`(() => {
                    const root = getComputedStyle(document.documentElement);

                    return {
                        bodyBg: getComputedStyle(document.body).backgroundColor,
                        bgPrimary: root.getPropertyValue("--bg-primary").trim(),
                        sidebarBg: root.getPropertyValue("--component-sidebar-bg").trim(),
                        darkClass: document.documentElement.classList.contains("dark"),
                        prefersDark: matchMedia("(prefers-color-scheme: dark)").matches
                    };
                })()`)
                .catch((error) => ({ error: error.message }));

            console.log(
                JSON.stringify({
                    url: win.webContents.getURL(),
                    title: win.webContents.getTitle(),
                    userAgent: win.webContents.getUserAgent(),
                    theme
                })
            );

            setTimeout(() => app.quit(), 1500);
        });
    }

    win.loadURL(START_URL).catch((error) => {
        console.error("[MyGPT] loadURL:", error.message);
    });

    return win;
}

function configureSession() {
    const ses = session.defaultSession;

    const allowedPermissions = new Set([
        "media",
        "notifications",
        "clipboard-sanitized-write",
        "fullscreen"
    ]);

    ses.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(allowedPermissions.has(permission));
    });

    if (typeof ses.setSpellCheckerLanguages === "function") {
        try {
            ses.setSpellCheckerLanguages(["ru", "en-US"]);
        } catch {
            // Не все сборки macOS поддерживают этот набор языков.
        }
    }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        const [win] = BrowserWindow.getAllWindows();

        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });

    app.on("web-contents-created", (_event, contents) => {
        if (contents.getType() === "devtools") return;

        installNavigationPolicy(contents);
        installContextMenu(contents);
    });

    app.whenReady().then(() => {
        loadSettings();
        nativeTheme.themeSource = "dark";

        if (process.platform === "darwin" && app.dock) {
            try {
                app.dock.setIcon(ICON_PATH);
            } catch {
                // Иконка в dev-режиме не критична.
            }
        }

        configureSession();
        buildApplicationMenu();
        createWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});