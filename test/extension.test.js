'use strict';

const { reset, state } = require('./setup');

const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildStatusBarItem,
  getConfiguredRefreshIntervalMs,
  getConfiguredDisplayFormat,
  listInstalledExtensionFolders,
  reportDuplicateExtensions,
  refreshStatusBar,
  activate,
  deactivate,
} = require('../out/extension');

const temporaryDirectories = [];

beforeEach(reset);
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('buildStatusBarItem creates a right-aligned status bar item', () => {
  const item = buildStatusBarItem();
  assert.equal(item.command, 'memoryMonitor.refresh');
  assert.equal(item.alignment, 2); // Right
});

test('configuration helpers return configured and default values', () => {
  state.config.refreshIntervalMs = 2500;
  state.config.displayFormat = 'compact';
  assert.equal(getConfiguredRefreshIntervalMs(), 2500);
  assert.equal(getConfiguredDisplayFormat(), 'compact');

  state.config = {};
  assert.equal(getConfiguredRefreshIntervalMs(), 5000);
  assert.equal(getConfiguredDisplayFormat(), 'used/total');
});

test('listInstalledExtensionFolders returns subdirectories in a directory', () => {
  const currentDir = path.resolve(__dirname, '..');
  const folders = listInstalledExtensionFolders(currentDir);
  assert.ok(Array.isArray(folders));
  assert.ok(folders.includes('src'));
  assert.ok(folders.includes('test'));
});

test('reportDuplicateExtensions shows warning in development mode', () => {
  const mockContext = {
    extensionMode: 1, // Development
    extensionPath: path.resolve(__dirname, '..'),
  };
  const mockChannel = {
    appendLine: () => {},
    show: () => {},
    clear: () => {},
  };
  reportDuplicateExtensions(mockContext, mockChannel);
  assert.equal(state.warnings.length, 1);
});

test('reportDuplicateExtensions reports duplicate versions in production mode', () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimem-extensions-'));
  temporaryDirectories.push(extensionsRoot);
  fs.mkdirSync(path.join(extensionsRoot, 'example.tool-1.0.0'));
  fs.mkdirSync(path.join(extensionsRoot, 'example.tool-2.0.0'));
  const mockContext = {
    extensionMode: 2, // Production
    extensionPath: path.join(extensionsRoot, 'omnimem'),
  };
  const mockChannel = {
    lines: ['stale'],
    appendLine(line) { this.lines.push(line); },
    showCount: 0,
    show() { this.showCount += 1; },
    clear() { this.lines = []; },
  };
  reportDuplicateExtensions(mockContext, mockChannel);
  assert.equal(mockChannel.showCount, 1);
  assert.match(mockChannel.lines.join('\n'), /example\.tool: 1\.0\.0, 2\.0\.0/);
});

test('reportDuplicateExtensions reports when no duplicates exist', () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimem-extensions-'));
  temporaryDirectories.push(extensionsRoot);
  fs.mkdirSync(path.join(extensionsRoot, 'example.tool-1.0.0'));
  reportDuplicateExtensions(
    { extensionMode: 2, extensionPath: path.join(extensionsRoot, 'omnimem') },
    { appendLine() {}, show() {}, clear() {} }
  );
  assert.equal(state.information.length, 1);
});

test('reportDuplicateExtensions handles non-existent extension directory gracefully', () => {
  const mockContext = {
    extensionMode: 2, // Production
    extensionPath: '/non/existent/directory/path/here',
  };
  const mockChannel = {
    appendLine: () => {},
    show: () => {},
    clear: () => {},
  };
  reportDuplicateExtensions(mockContext, mockChannel);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /Could not read/);
});

test('refreshStatusBar renders successful memory usage', async () => {
  const item = buildStatusBarItem();
  await refreshStatusBar(item, async () => ({ usedKb: 2 * 1024 * 1024, processCount: 4, systemTotalBytes: 16 * 1024 ** 3 }));
  assert.equal(item.text, '$(pulse) 2.0GB/16.0GB');
  assert.match(item.tooltip, /4 process\(es\)/);
  assert.equal(item.showCount, 1);
});

test('refreshStatusBar renders errors without throwing', async () => {
  const item = buildStatusBarItem();
  await refreshStatusBar(item, async () => { throw new Error('snapshot failed'); });
  assert.equal(item.text, '$(warning) mem?');
  assert.match(item.tooltip, /snapshot failed/);

  await refreshStatusBar(item, async () => { throw 'unknown failure'; });
  assert.match(item.tooltip, /unknown failure/);
});

test('activate registers commands, config listeners, and status bar', () => {
  let configCallback = null;
  const subscriptions = [];
  const mockContext = {
    subscriptions,
    extensionMode: 2, // Production
    extensionPath: path.resolve(__dirname, '..'),
  };
  activate(mockContext);
  assert.equal(state.configurationListeners.length, 1);
  assert.ok(state.commands.has('memoryMonitor.refresh'));
  assert.ok(state.commands.has('memoryMonitor.checkDuplicateExtensions'));

  state.config.refreshIntervalMs = 3000;
  state.configurationListeners[0]({
    affectsConfiguration: (key) => key === 'memoryMonitor.refreshIntervalMs' || key === 'memoryMonitor.displayFormat',
  });
  state.commands.get('memoryMonitor.refresh')();
  state.commands.get('memoryMonitor.checkDuplicateExtensions')();

  assert.ok(subscriptions.length > 0);
  subscriptions.forEach((s) => s && typeof s.dispose === 'function' && s.dispose());
  deactivate();
});
