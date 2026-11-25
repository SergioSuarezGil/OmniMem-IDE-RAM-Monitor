'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findDuplicateExtensions, formatMemoryStatus } from './lib';
import { getEditorMemoryUsage } from './system';
import { DisplayFormat } from './types';

const DEFAULT_REFRESH_INTERVAL_MS = 5000;
const MIN_REFRESH_INTERVAL_MS = 1000;
const MAX_REFRESH_INTERVAL_MS = 2 ** 31 - 1;
const STATUS_BAR_PRIORITY = 100;

export const buildStatusBarItem = (): vscode.StatusBarItem => {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );
  item.command = 'memoryMonitor.refresh';
  return item;
};

export const getConfiguredRefreshIntervalMs = (): number => {
  const config = vscode.workspace.getConfiguration('memoryMonitor');
  const configured = config.get<number>('refreshIntervalMs');
  const interval =
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured <= MAX_REFRESH_INTERVAL_MS
      ? configured
      : DEFAULT_REFRESH_INTERVAL_MS;
  return Math.max(MIN_REFRESH_INTERVAL_MS, interval);
};

export const getConfiguredDisplayFormat = (): DisplayFormat => {
  const config = vscode.workspace.getConfiguration('memoryMonitor');
  return config.get<DisplayFormat>('displayFormat') ?? 'used/total';
};

export const refreshStatusBar = async (
  statusBarItem: vscode.StatusBarItem,
  readMemoryUsage: typeof getEditorMemoryUsage = getEditorMemoryUsage
): Promise<void> => {
  try {
    const { usedKb, processCount, systemTotalBytes } = await readMemoryUsage();
    const displayFormat = getConfiguredDisplayFormat();
    statusBarItem.text = `$(pulse) ${formatMemoryStatus(usedKb, systemTotalBytes, displayFormat)}`;
    statusBarItem.tooltip = `Summed RSS/working set for this editor (${processCount} process(es)) vs. total system RAM. ` +
      'Shared pages may be counted more than once. Click to refresh.';
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    statusBarItem.text = '$(warning) mem?';
    statusBarItem.tooltip = `Could not read memory usage: ${errorMessage}`;
  }
  statusBarItem.show();
};

export const listInstalledExtensionFolders = (extensionsRoot: string): string[] =>
  fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

export const reportDuplicateExtensions = (
  extensionContext: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): void => {
  if (extensionContext.extensionMode === vscode.ExtensionMode.Development) {
    vscode.window.showWarningMessage(
      'OmniMem is running in Development mode. Extension duplicate scanning requires the extension to be installed in the editor extensions directory.'
    );
    return;
  }

  const extensionsRoot = path.dirname(extensionContext.extensionPath);

  let folders: string[];
  try {
    folders = listInstalledExtensionFolders(extensionsRoot);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Could not read ${extensionsRoot}: ${errorMessage}`);
    return;
  }

  const duplicates = findDuplicateExtensions(folders);
  if (duplicates.length === 0) {
    vscode.window.showInformationMessage('No duplicate extensions with different versions were found.');
    return;
  }

  outputChannel.clear();
  outputChannel.appendLine(`Extensions with multiple versions installed in ${extensionsRoot}:`);
  duplicates.forEach((dup) => outputChannel.appendLine(`  - ${dup.id}: ${dup.versions.join(', ')}`));
  outputChannel.show();
};

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = buildStatusBarItem();
  const outputChannel = vscode.window.createOutputChannel('OmniMem');
  context.subscriptions.push(statusBarItem, outputChannel);

  // Skip refreshes while one is still running: `ps`/PowerShell can take
  // longer than the interval on a loaded system, and overlapping execs are
  // wasted work.
  let refreshInFlight = false;
  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await refreshStatusBar(statusBarItem);
    } finally {
      refreshInFlight = false;
    }
  };

  let timer: NodeJS.Timeout = setInterval(refresh, getConfiguredRefreshIntervalMs());
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('memoryMonitor.refreshIntervalMs')) {
        clearInterval(timer);
        timer = setInterval(refresh, getConfiguredRefreshIntervalMs());
      }
      if (
        event.affectsConfiguration('memoryMonitor.refreshIntervalMs') ||
        event.affectsConfiguration('memoryMonitor.displayFormat')
      ) {
        refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('memoryMonitor.refresh', refresh)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('memoryMonitor.checkDuplicateExtensions', () =>
      reportDuplicateExtensions(context, outputChannel)
    )
  );

  refresh();
}

export function deactivate(): void {}
