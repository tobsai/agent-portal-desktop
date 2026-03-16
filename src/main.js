'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  Notification,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

if (require('electron-squirrel-startup')) app.quit();

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------
const WINDOW_STATE_DEFAULTS = { width: 1200, height: 800 };

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    return { ...WINDOW_STATE_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...WINDOW_STATE_DEFAULTS };
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getBounds();
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds));
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Tray icon — 16×16 template PNG built from raw bytes (no external deps)
// ---------------------------------------------------------------------------
function buildCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const CRC_TABLE = buildCRC32Table();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createTemplatePNG(size) {
  const { deflateSync } = require('zlib');

  // Draw a simple 'L' glyph in black on transparent background (RGBA)
  const pixels = Buffer.alloc(size * size * 4, 0); // all transparent
  const margin = Math.floor(size * 0.2);
  const strokeW = Math.max(2, Math.floor(size * 0.15));
  const bottom = size - margin;
  const right = size - margin;

  // Vertical bar of 'L'
  for (let y = margin; y < bottom; y++) {
    for (let x = margin; x < margin + strokeW; x++) {
      const idx = (y * size + x) * 4;
      pixels[idx] = 0;       // R
      pixels[idx + 1] = 0;   // G
      pixels[idx + 2] = 0;   // B
      pixels[idx + 3] = 255; // A
    }
  }
  // Horizontal bar of 'L'
  for (let y = bottom - strokeW; y < bottom; y++) {
    for (let x = margin; x < right; x++) {
      const idx = (y * size + x) * 4;
      pixels[idx] = 0;
      pixels[idx + 1] = 0;
      pixels[idx + 2] = 0;
      pixels[idx + 3] = 255;
    }
  }

  // Build raw image data: one filter byte (0 = None) per scanline + RGBA rows
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter type None
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    img.setTemplateImage(true);
    return img;
  }
  // Generate a 16×16 template icon on the fly
  const pngBuf = createTemplatePNG(16);
  const img = nativeImage.createFromBuffer(pngBuf, { width: 16, height: 16 });
  img.setTemplateImage(true);
  return img;
}

// ---------------------------------------------------------------------------
// Allowed navigation origins
// ---------------------------------------------------------------------------
const ALLOWED_HOSTS = [
  'talos.mtree.io', 'mtree.io', 'localhost', '127.0.0.1',
  // Google OAuth flow — all must stay in-app for session cookies to work
  'accounts.google.com', 'accounts.youtube.com',
  'consent.google.com', 'myaccount.google.com',
  'www.google.com', 'google.com',
  'content.googleapis.com', 'ssl.gstatic.com',
  'fonts.googleapis.com', 'apis.google.com',
  'lh3.googleusercontent.com',
];

function isAllowedURL(urlString) {
  try {
    const { hostname } = new URL(urlString);
    // Allow any *.google.com / *.gstatic.com / *.googleapis.com for OAuth flow
    if (hostname.endsWith('.google.com') || hostname === 'google.com' ||
        hostname.endsWith('.gstatic.com') || hostname.endsWith('.googleapis.com') ||
        hostname.endsWith('.googleusercontent.com')) {
      return true;
    }
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function buildMenu(win) {
  const template = [
    {
      label: 'Agent Portal',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => win.webContents.toggleDevTools(),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
let mainWindow = null;
let tray = null;

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x != null && state.y != null ? { x: state.x, y: state.y } : {}),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('https://talos.mtree.io', {
    userAgent: 'AgentPortal-Desktop/1.0 Electron',
  });

  // Block or open external navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedURL(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Same for new-window / window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedURL(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Persist window state on every move/resize and before close
  const persistState = () => saveWindowState(mainWindow);
  mainWindow.on('resize', persistState);
  mainWindow.on('move', persistState);
  mainWindow.on('close', persistState);

  mainWindow.on('closed', () => { mainWindow = null; });

  Menu.setApplicationMenu(buildMenu(mainWindow));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Agent Portal');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Agent Portal', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', showWindow);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('set-badge', (_event, count) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

ipcMain.on('notify', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    // macOS: re-create window if dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });
});

// Keep the app running in the tray on macOS even when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
