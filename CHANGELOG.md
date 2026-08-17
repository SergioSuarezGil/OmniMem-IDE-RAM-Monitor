# Change Log

All notable changes to the **OmniMem – IDE RAM Monitor** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-08-17

### 🚀 Initial Release & Highlights

- **Universal Fork & Multi-IDE Compatibility**:
  - Dynamically calculates RAM usage for any editor derived from VS Code (**VS Code, Cursor, Windsurf, Devin Desktop, Trae, VSCodium, Positron**).
  - Uses bundle root inspection on macOS, exact binary path on Linux, and CimInstance/PowerShell on Windows without hardcoded product names.

- **Real-Time RAM Status Bar Monitor**:
  - Displays real memory (RSS / Working Set) of all editor processes (Main process, Renderers, GPU, Extension Host, and Helpers).
  - Interactive tooltip detailing process count and total system RAM.
  - Click-to-refresh shortcut right from the status bar.

- **Configurable Display Formats (`memoryMonitor.displayFormat`)**:
  - `"used/total"`: `1.5GB/16.0GB` (Default)
  - `"usedOnly"`: `1.5GB`
  - `"percentage"`: `9.4%`
  - `"compact"`: `1.5GB (9%)`

- **Configurable Refresh Interval (`memoryMonitor.refreshIntervalMs`)**:
  - Set custom update interval in milliseconds (default: `5000ms`, minimum: `1000ms`) with hot-reloading.

- **Duplicate Extension Detector (`OmniMem: Check Duplicate Extensions`)**:
  - Scans the active editor's extensions directory to identify extensions with multiple version folders on disk.
  - Generates a clean output report and handles version sorting.

- **Lightweight & High Performance**:
  - Zero external runtime dependencies.
  - Comprehensive unit test suite with 100% pass rate via `node:test`.
