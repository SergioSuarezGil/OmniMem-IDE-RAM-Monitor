<div align="center">

# ⚡ OmniMem – IDE RAM Monitor

**Universal, lightweight real-time memory & process monitor for VS Code, Cursor, Windsurf, Devin Desktop, Trae, VSCodium, and other forks.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20runtime-brightgreen.svg)]()
[![Tested with Node](https://img.shields.io/badge/tests-node%3Atest-informational.svg)]()

</div>

---

## 📖 Overview

**OmniMem** displays the real RAM usage of your editor runtime (Main process, Renderers, GPU, Extension Host, and Helpers) directly in your status bar. It also scans your installed extensions folder to find duplicate versions lingering on disk.

Unlike existing memory monitors that hardcode binary names (breaking as soon as you switch to **Cursor**, **Windsurf**, or **Devin**), **OmniMem** is designed from the ground up to be **100% fork-agnostic**.

---

## 📸 Screenshots

<div align="center">
  <p><em>Status bar preview showing real-time memory consumption:</em></p>
  <img src="./assets/preview.png" alt="OmniMem Status Bar Preview" />
</div>

---

## ✨ Features

- **⚡ Real-Time RAM in Status Bar**: Sums the exact Resident Set Size (RSS / Working Set) of all processes belonging to this editor instance.
- **🎨 Configurable Display Formats**: Choose how memory is formatted (`used/total`, `usedOnly`, `percentage`, or `compact`).
- **🔍 Duplicate Extension Detector**: Scans your active editor's extensions directory and reports extensions with multiple leftover versions on disk.
- **🚀 Zero Runtime Dependencies**: Pure Node.js & VS Code API with zero bloat (< 10 KB footprint).
- **🔄 Live Hot-Reloading**: Configuration changes (refresh interval, format) apply immediately without restarting the editor.
- **🛠️ Click-to-Refresh**: Click the status bar item anytime to force an instant memory refresh.

---

## 🌐 Supported Editors

Works seamlessly across all modern Electron / VS Code-based editors:

| Editor                 | Platform Support        | Status       |
| :--------------------- | :---------------------- | :----------- |
| **Visual Studio Code** | macOS / Linux / Windows | Full Support |
| **Cursor**             | macOS / Linux / Windows | Full Support |
| **Windsurf**           | macOS / Linux / Windows | Full Support |
| **Devin Desktop**      | macOS / Linux / Windows | Full Support |
| **Trae**               | macOS / Linux / Windows | Full Support |
| **VSCodium**           | macOS / Linux / Windows | Full Support |
| **Positron**           | macOS / Linux / Windows | Full Support |

---

## ⚙️ Configuration

You can customize **OmniMem** via your editor's `settings.json` or through the Settings UI (`OmniMem`):

| Setting                           | Type     | Default        | Description                                                                                                                                                                            |
| :-------------------------------- | :------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memoryMonitor.displayFormat`     | `string` | `"used/total"` | Format for the status bar. Options: <br>• `"used/total"` &rarr; `1.5GB/16.0GB`<br>• `"usedOnly"` &rarr; `1.5GB`<br>• `"percentage"` &rarr; `9.4%`<br>• `"compact"` &rarr; `1.5GB (9%)` |
| `memoryMonitor.refreshIntervalMs` | `number` | `5000`         | Refresh frequency in milliseconds (minimum: `1000`).                                                                                                                                   |

---

## ⌨️ Commands

Access these commands from the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux):

- `OmniMem: Refresh Memory Usage` &mdash; Instantly recalculates and updates the status bar.
- `OmniMem: Check Duplicate Extensions` &mdash; Checks your extensions folder for duplicate installed versions and opens a summary report.

---

## 🧠 How It Works (Under the Hood)

OmniMem identifies processes using runtime introspection rather than hardcoded process names:

- **macOS**: Electron ships helper processes (Renderer, GPU, Plugin Host) as sub-bundles inside the main `.app` bundle. OmniMem inspects `process.execPath`, resolves the `.app` root, and sums the RSS of all child processes running under that bundle root.
- **Linux**: Electron launches child processes from the main binary path with `--type=...` parameters. OmniMem tracks all processes matching the exact `execPath`.
- **Windows**: Queries process working sets via `Get-CimInstance Win32_Process` matching the active `ExecutablePath`.
- **Duplicate Detection**: Uses `path.dirname(context.extensionPath)` to automatically point to the current editor's extension storage (`~/.cursor/extensions`, `~/.windsurf/extensions`, `~/.vscode/extensions`, etc.).

> **Note on external tools**: OmniMem tracks all processes managed by the editor application. External CLI tools and compilers installed globally on the system (outside the editor bundle) are not included.

---

## 📦 Installation

### From GitHub Releases (recommended)

1. Open the repository Releases section.
2. Download the `.vsix` attached to the version you want (for example `omnimem-1.0.0.vsix`).
3. Install it from your editor UI (_Extensions -> Install from VSIX..._) or with CLI.

### From VSIX Package

1. Package or download the `.vsix` file:
   ```bash
   npm run package
   ```
2. Install it in your editor of choice via CLI or through the UI (_Extensions &rarr; Install from VSIX..._):

```bash
# VS Code
code --install-extension omnimem-1.0.0.vsix

# Cursor
cursor --install-extension omnimem-1.0.0.vsix

# Windsurf
windsurf --install-extension omnimem-1.0.0.vsix

# Devin Desktop
devin-desktop --install-extension omnimem-1.0.0.vsix
```

---

## 🚀 Release Process

This repository is configured to create a GitHub Release and upload the `.vsix` automatically when you push a semantic version tag.

### Create a new release

```bash
# Ensure you are up to date
git checkout main
git pull origin main

# Update version in package.json if needed, then commit
git add package.json package-lock.json
git commit -m "chore: bump version to 1.0.1"
git push origin main

# Create and push the tag
git tag v1.0.1
git push origin v1.0.1
```

Once the tag is pushed, workflow `.github/workflows/release.yml` builds the extension and publishes the `.vsix` in Releases.

---

## 🛠️ Development & Testing

```bash
# Install dependencies
npm install

# Run unit test suite
npm test

# Run tests with code coverage report
npm run test:coverage

# Build VSIX package
npm run package
```

---

## 📄 License

MIT © 2026
