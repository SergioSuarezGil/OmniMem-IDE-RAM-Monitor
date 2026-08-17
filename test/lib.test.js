'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getMacAppBundleRoot,
  sumRssForMatchingProcesses,
  sumRssForMatchingProcessesWindows,
  parseExtensionFolderName,
  findDuplicateExtensions,
  compareVersions,
  formatMemoryStatus,
  summarizeProcessSnapshot,
} = require('../out/lib');

test('getMacAppBundleRoot extracts the bundle root without depending on the editor name', () => {
  const execPath =
    '/Applications/Devin.app/Contents/Frameworks/Devin Helper (Renderer).app/Contents/MacOS/Devin Helper (Renderer)';
  assert.equal(getMacAppBundleRoot(execPath), '/Applications/Devin.app');
});

test('getMacAppBundleRoot supports Antigravity IDE helper processes', () => {
  const execPath =
    '/Applications/Antigravity IDE.app/Contents/Frameworks/Antigravity IDE Helper (Renderer).app/Contents/MacOS/Antigravity IDE Helper (Renderer)';
  assert.equal(getMacAppBundleRoot(execPath), '/Applications/Antigravity IDE.app');
});

test('getMacAppBundleRoot returns null if there is no .app bundle', () => {
  assert.equal(getMacAppBundleRoot('/usr/local/bin/code'), null);
});

test('sumRssForMatchingProcesses sums only matching processes and discards the header', () => {
  const psOutput = [
    '  PID   RSS COMMAND',
    '  100 20000 /Applications/Windsurf.app/Contents/MacOS/Windsurf',
    '  101 30000 /Applications/Windsurf.app/Contents/Frameworks/Windsurf Helper (Renderer).app/Contents/MacOS/Windsurf Helper (Renderer)',
    '  102  5000 /usr/sbin/some-other-process',
  ].join('\n');

  const { totalKb, matched } = sumRssForMatchingProcesses(psOutput, '/Applications/Windsurf.app');

  assert.equal(matched, 2);
  assert.equal(totalKb, 50000);
});

test('sumRssForMatchingProcessesWindows sums the working set (bytes) converted to KB by exact ExecutablePath', () => {
  const jsonText = JSON.stringify([
    { ProcessId: 1, WorkingSetSize: 1024 * 1024 * 100, ExecutablePath: 'C:\\Editors\\Devin\\Devin.exe' },
    { ProcessId: 2, WorkingSetSize: 1024 * 1024 * 50, ExecutablePath: 'C:\\Editors\\Devin\\Devin.exe' },
    { ProcessId: 3, WorkingSetSize: 1024 * 1024 * 999, ExecutablePath: 'C:\\Windows\\explorer.exe' },
  ]);

  const { totalKb, matched } = sumRssForMatchingProcessesWindows(jsonText, 'C:\\Editors\\Devin\\Devin.exe');

  assert.equal(matched, 2);
  assert.equal(totalKb, 150 * 1024);
});

test('parseExtensionFolderName splits id and version, including platform suffix', () => {
  assert.deepEqual(parseExtensionFolderName('undermoon.vscode-memory-usage-1.2.2'), {
    id: 'undermoon.vscode-memory-usage',
    version: '1.2.2',
  });
  assert.deepEqual(parseExtensionFolderName('ms-python.python-2024.1.0-darwin-arm64'), {
    id: 'ms-python.python',
    version: '2024.1.0',
  });
  assert.equal(parseExtensionFolderName('not-an-extension'), null);
});

test('findDuplicateExtensions detects ids with more than one installed version', () => {
  const folders = [
    'ms-python.python-2023.20.0',
    'ms-python.python-2024.1.0',
    'esbenp.prettier-vscode-10.1.0',
    'undermoon.vscode-memory-usage-1.2.2-darwin-arm64',
  ];

  const duplicates = findDuplicateExtensions(folders);

  assert.deepEqual(duplicates, [{ id: 'ms-python.python', versions: ['2023.20.0', '2024.1.0'] }]);
});

test('findDuplicateExtensions sorts versions numerically, not lexicographically', () => {
  const folders = ['foo.bar-1.9.0', 'foo.bar-1.10.0', 'foo.bar-1.2.0'];

  const duplicates = findDuplicateExtensions(folders);

  assert.deepEqual(duplicates, [{ id: 'foo.bar', versions: ['1.2.0', '1.9.0', '1.10.0'] }]);
});

test('compareVersions compares numeric segments, not as text', () => {
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('sumRssForMatchingProcessesWindows distinguishes invalid JSON from "zero matching processes"', () => {
  const result = sumRssForMatchingProcessesWindows('this is not json', 'C:\\Editors\\Devin\\Devin.exe');
  assert.deepEqual(result, { totalKb: 0, matched: 0, parseError: true });

  const validButEmpty = sumRssForMatchingProcessesWindows('[]', 'C:\\Editors\\Devin\\Devin.exe');
  assert.deepEqual(validButEmpty, { totalKb: 0, matched: 0, parseError: false });
});

test('summarizeProcessSnapshot uses the .app bundle root on macOS', () => {
  const execPath = '/Applications/Windsurf.app/Contents/MacOS/Windsurf';
  const psOutput = [
    'PID RSS COMMAND',
    '1 10000 /Applications/Windsurf.app/Contents/MacOS/Windsurf',
    '2 20000 /Applications/Windsurf.app/Contents/Frameworks/Windsurf Helper (Renderer).app/Contents/MacOS/Windsurf Helper (Renderer)',
    '3 99999 /usr/sbin/unrelated',
  ].join('\n');

  const result = summarizeProcessSnapshot('darwin', execPath, psOutput);

  assert.deepEqual(result, { totalKb: 30000, matched: 2 });
});

test('summarizeProcessSnapshot falls back to path.dirname(execPath) on macOS if there is no .app bundle', () => {
  const execPath = '/usr/local/bin/some-editor';
  const psOutput = ['PID RSS COMMAND', '1 5000 /usr/local/bin/some-editor', '2 7000 /usr/local/bin/some-editor-helper'].join(
    '\n'
  );

  const result = summarizeProcessSnapshot('darwin', execPath, psOutput);

  assert.deepEqual(result, { totalKb: 12000, matched: 2 });
});

test('summarizeProcessSnapshot matches by exact execPath on linux', () => {
  const execPath = '/usr/share/windsurf/windsurf';
  const psOutput = [
    'PID RSS COMMAND',
    '1 10000 /usr/share/windsurf/windsurf --type=main',
    '2 15000 /usr/share/windsurf/windsurf --type=renderer',
    '3 40000 /usr/bin/some-other-app',
  ].join('\n');

  const result = summarizeProcessSnapshot('linux', execPath, psOutput);

  assert.deepEqual(result, { totalKb: 25000, matched: 2 });
});

test('formatMemoryStatus shows "used/total" in binary GB with one decimal', () => {
  const usedKb = 1_572_864; // 1.5 GiB in KB
  const systemTotalBytes = 17_179_869_184; // 16 GiB
  assert.equal(formatMemoryStatus(usedKb, systemTotalBytes, 'used/total'), '1.5GB/16.0GB');
});

test('formatMemoryStatus supports usedOnly format', () => {
  const usedKb = 1_572_864; // 1.5 GiB in KB
  const systemTotalBytes = 17_179_869_184; // 16 GiB
  assert.equal(formatMemoryStatus(usedKb, systemTotalBytes, 'usedOnly'), '1.5GB');
});

test('formatMemoryStatus supports percentage format', () => {
  const usedKb = 1_572_864; // 1.5 GiB in KB
  const systemTotalBytes = 16 * 1024 ** 3; // 16 GiB -> (1.5 / 16) * 100 = 9.375% -> 9.4%
  assert.equal(formatMemoryStatus(usedKb, systemTotalBytes, 'percentage'), '9.4%');
});

test('formatMemoryStatus supports compact format', () => {
  const usedKb = 1_572_864; // 1.5 GiB in KB
  const systemTotalBytes = 16 * 1024 ** 3; // 16 GiB -> 1.5GB (9%)
  assert.equal(formatMemoryStatus(usedKb, systemTotalBytes, 'compact'), '1.5GB (9%)');
});

test('formatMemoryStatus rounds to one decimal and supports zero usage', () => {
  const systemTotalBytes = 8 * 1024 ** 3; // 8 GiB
  assert.equal(formatMemoryStatus(0, systemTotalBytes), '0.0GB/8.0GB');
  assert.equal(formatMemoryStatus(0, systemTotalBytes, 'percentage'), '0.0%');
  assert.equal(formatMemoryStatus(0, systemTotalBytes, 'compact'), '0.0GB (0%)');
});

test('summarizeProcessSnapshot delegates to Windows parsing by exact ExecutablePath', () => {
  const execPath = 'C:\\Editors\\Devin\\Devin.exe';
  const jsonText = JSON.stringify([
    { ProcessId: 1, WorkingSetSize: 1024 * 1024, ExecutablePath: execPath },
    { ProcessId: 2, WorkingSetSize: 1024 * 1024, ExecutablePath: 'C:\\Windows\\explorer.exe' },
  ]);

  const result = summarizeProcessSnapshot('win32', execPath, jsonText);

  assert.deepEqual(result, { totalKb: 1024, matched: 1, parseError: false });
});
