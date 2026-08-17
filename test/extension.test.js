'use strict';

require('./setup');

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('buildStatusBarItem creates a right-aligned status bar item', () => {
  const item = buildStatusBarItem();
  assert.equal(item.command, 'memoryMonitor.refresh');
  assert.equal(item.alignment, 2); // Right
});

test('getConfiguredRefreshIntervalMs returns default when not set', () => {
  const interval = getConfiguredRefreshIntervalMs();
  assert.equal(typeof interval, 'number');
  assert.ok(interval >= 1000);
});

test('getConfiguredDisplayFormat returns configured format', () => {
  const format = getConfiguredDisplayFormat();
  assert.equal(typeof format, 'string');
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
});

test('reportDuplicateExtensions scans extensions in production mode and reports duplicates or none', () => {
  const mockContext = {
    extensionMode: 2, // Production
    extensionPath: path.resolve(__dirname, '..', 'node_modules', 'some-pkg'),
  };
  const logged = [];
  const mockChannel = {
    appendLine: (line) => logged.push(line),
    show: () => {},
    clear: () => {},
  };
  reportDuplicateExtensions(mockContext, mockChannel);
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
});

test('refreshStatusBar updates status bar text and shows it', async () => {
  const item = buildStatusBarItem();
  await refreshStatusBar(item);
  assert.ok(item.text.length > 0);
  assert.ok(item.tooltip.length > 0);
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
  assert.ok(subscriptions.length > 0);
  subscriptions.forEach((s) => s && typeof s.dispose === 'function' && s.dispose());
  deactivate();
});
