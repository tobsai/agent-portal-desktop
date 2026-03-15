# Lewis Desktop

A macOS Electron desktop app that wraps the [Agent Portal](https://talos.mtree.io/c) chat interface.

## Features

- Native macOS window with hidden-inset title bar (traffic-light buttons)
- Dark background matching the web app (`#0a0a0f`)
- System tray icon — app stays alive when the window is closed
- Remembers window size and position between sessions
- Navigation guard: external links open in the default browser
- Dock badge and native notification support via `window.electronAPI`

## Run locally

```bash
npm install
node scripts/gen-icon.js   # generate icons (one-time)
npm start
```

## Package / distribute

```bash
npm run make
```

Outputs a `.zip` (and `.dmg` if `hdiutil`/`make-dmg` tools are available) in `out/make/`.

> **Note:** The `.dmg` maker requires a valid `.icns` file. `gen-icon.js` creates a
> minimal `src/icon.icns` that wraps the 256×256 PNG. For a production-quality icon
> with all resolutions, use `iconutil` on macOS:
>
> ```bash
> # Create an iconset with the required sizes, then:
> iconutil -c icns src/icon.iconset -o src/icon.icns
> ```

## Web API (available in renderer)

```javascript
window.electronAPI.setBadge(3);          // set dock badge count (0 clears)
window.electronAPI.notify('Hi', 'msg');  // native notification
window.electronAPI.platform;             // 'darwin'
```
