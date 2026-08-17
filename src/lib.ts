'use strict';

import * as path from 'path';
import {
  DisplayFormat,
  ProcessSummary,
  ExtensionFolderInfo,
  DuplicateExtension,
  WindowsProcessItem,
} from './types';

// Pure, editor-agnostic helpers. No dependency on `vscode`, `child_process`
// or any I/O, so they can be unit tested directly with `node --test`.

const BYTES_PER_KB = 1024;
const BYTES_PER_GB = 1024 ** 3;
const GB_DECIMAL_PLACES = 1;
const PS_HEADER_ROWS = 1;
const PS_LINE_PATTERN = /^(\d+)\s+(\d+)\s+(.*)$/;
const EXTENSION_FOLDER_PATTERN =
  /^(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:-(?:darwin|linux|win32|alpine)-[\w]+|-universal|-web)?$/;

/**
 * On macOS, Electron ships helper processes (Renderer/GPU/Plugin) as separate
 * ".app" bundles nested inside the main app bundle. Every process that
 * belongs to this editor instance - whatever fork it is (VS Code, Cursor,
 * Windsurf, Antigravity IDE, Devin Desktop, Trae, VSCodium...) - lives under
 * the FIRST ".app"
 * segment of the extension host's own execPath. Extracting that root lets us
 * group all related processes without hardcoding any product name.
 *
 * Known limitation: this takes the FIRST ".app/" occurrence in the path. If
 * an ancestor directory (not the actual bundle) were literally named with a
 * ".app" suffix, the extracted root would be wrong. This is not expected in
 * practice (installers don't produce such paths) and is accepted as-is.
 */
export const getMacAppBundleRoot = (execPath: string): string | null => {
  const bundleMarker = '.app/';
  const markerIndex = execPath.indexOf(bundleMarker);
  if (markerIndex === -1) return null;
  return execPath.slice(0, markerIndex + '.app'.length);
};

/**
 * Parses `ps -eo pid,rss,command` output (RSS in KB) and sums the RSS of the
 * lines whose command contains `matchSubstring`.
 */
export const sumRssForMatchingProcesses = (
  psOutput: string,
  matchSubstring: string
): ProcessSummary => {
  const dataLines = psOutput.split('\n').slice(PS_HEADER_ROWS);
  return dataLines.reduce<ProcessSummary>(
    (totals, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return totals;
      const match = trimmedLine.match(PS_LINE_PATTERN);
      if (!match) return totals;
      const [, , rssKbText, command] = match;
      if (!command.includes(matchSubstring)) return totals;
      return { totalKb: totals.totalKb + parseInt(rssKbText, 10), matched: totals.matched + 1 };
    },
    { totalKb: 0, matched: 0 }
  );
};

/**
 * Parses the JSON emitted by the Windows process snapshot (WorkingSetSize is
 * in bytes there) and sums the working set of processes whose ExecutablePath
 * matches exactly - Electron on Windows relaunches the very same binary for
 * every process type, so an exact path match is enough.
 */
export const sumRssForMatchingProcessesWindows = (
  jsonText: string,
  execPath: string
): ProcessSummary => {
  let processList: WindowsProcessItem[];
  try {
    const parsed = JSON.parse(jsonText) as WindowsProcessItem | WindowsProcessItem[];
    processList = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Distinguish "couldn't parse the snapshot" from "parsed fine, but zero
    // processes matched" so callers can surface an accurate error message.
    return { totalKb: 0, matched: 0, parseError: true };
  }

  const targetPath = execPath.toLowerCase();
  const totals = processList.reduce(
    (acc, proc) => {
      if (proc.ExecutablePath?.toLowerCase() !== targetPath) return acc;
      return { totalKb: acc.totalKb + (proc.WorkingSetSize ?? 0) / BYTES_PER_KB, matched: acc.matched + 1 };
    },
    { totalKb: 0, matched: 0 }
  );

  return { totalKb: Math.round(totals.totalKb), matched: totals.matched, parseError: false };
};

/**
 * Splits an extension folder name (e.g. "publisher.name-1.2.3" or
 * "publisher.name-1.2.3-darwin-arm64") into { id, version }. Returns null if
 * the folder name doesn't look like an installed extension.
 */
export const parseExtensionFolderName = (folderName: string): ExtensionFolderInfo | null => {
  const match = folderName.match(EXTENSION_FOLDER_PATTERN);
  if (!match) return null;
  const [, id, version] = match;
  return { id, version };
};

/**
 * Compares two version strings segment by segment (split on "." and "-"),
 * comparing numerically when both segments are numeric and lexically
 * otherwise. Good enough for sorting extension versions for display; not a
 * full semver spec implementation.
 */
export const compareVersions = (versionA: string, versionB: string): number => {
  const segmentsA = versionA.split(/[.-]/);
  const segmentsB = versionB.split(/[.-]/);
  const segmentCount = Math.max(segmentsA.length, segmentsB.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentA = segmentsA[index] ?? '';
    const segmentB = segmentsB[index] ?? '';
    const numberA = Number(segmentA);
    const numberB = Number(segmentB);
    const bothNumeric = segmentA !== '' && segmentB !== '' && !Number.isNaN(numberA) && !Number.isNaN(numberB);
    const comparison = bothNumeric ? numberA - numberB : segmentA.localeCompare(segmentB);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

/**
 * Groups extension folder names by id (publisher.name) and returns the ones
 * that have more than one distinct version installed on disk.
 */
export const findDuplicateExtensions = (folderNames: string[]): DuplicateExtension[] => {
  const versionsById = folderNames.reduce<Map<string, Set<string>>>((acc, folderName) => {
    const parsed = parseExtensionFolderName(folderName);
    if (!parsed) return acc;
    const existingVersions = acc.get(parsed.id) ?? new Set();
    existingVersions.add(parsed.version);
    acc.set(parsed.id, existingVersions);
    return acc;
  }, new Map());

  return [...versionsById.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([id, versions]) => ({ id, versions: [...versions].sort(compareVersions) }))
    .sort((a, b) => a.id.localeCompare(b.id));
};

/**
 * Formats memory usage for the status bar based on the chosen displayFormat.
 * Supported formats:
 *  - 'used/total' (default): "1.5GB/16.0GB"
 *  - 'usedOnly': "1.5GB"
 *  - 'percentage': "9.4%"
 *  - 'compact': "1.5GB (9%)"
 *
 * `usedKb` is RSS in KB (as returned by the summarize* functions);
 * `systemTotalBytes` is typically `os.totalmem()`.
 */
export const formatMemoryStatus = (
  usedKb: number,
  systemTotalBytes: number,
  displayFormat: DisplayFormat = 'used/total'
): string => {
  const usedGb = (usedKb * BYTES_PER_KB) / BYTES_PER_GB;
  const totalGb = systemTotalBytes / BYTES_PER_GB;
  const percentage = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;

  switch (displayFormat) {
    case 'usedOnly':
      return `${usedGb.toFixed(GB_DECIMAL_PLACES)}GB`;
    case 'percentage':
      return `${percentage.toFixed(1)}%`;
    case 'compact':
      return `${usedGb.toFixed(GB_DECIMAL_PLACES)}GB (${percentage.toFixed(0)}%)`;
    case 'used/total':
    default:
      return `${usedGb.toFixed(GB_DECIMAL_PLACES)}GB/${totalGb.toFixed(GB_DECIMAL_PLACES)}GB`;
  }
};

/**
 * Editor-agnostic strategy selection: picks how to match this editor's own
 * processes in a process snapshot, purely from `platform` and `execPath`.
 * This is the single point that decides "macOS uses the .app bundle root,
 * Linux/Windows use the exact execPath" - kept pure and exported so the
 * platform-selection logic itself is unit-testable without mocking
 * `child_process` or `process.platform`.
 */
export const summarizeProcessSnapshot = (
  platform: NodeJS.Platform,
  execPath: string,
  rawSnapshot: string
): ProcessSummary => {
  if (platform === 'win32') return sumRssForMatchingProcessesWindows(rawSnapshot, execPath);
  if (platform === 'darwin') {
    const bundleRoot = getMacAppBundleRoot(execPath) ?? path.dirname(execPath);
    return sumRssForMatchingProcesses(rawSnapshot, bundleRoot);
  }
  return sumRssForMatchingProcesses(rawSnapshot, execPath);
};
