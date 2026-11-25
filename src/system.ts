'use strict';

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { summarizeProcessSnapshot } from './lib';
import { ProcessSnapshot, EditorMemoryUsage } from './types';

const MAX_PS_BUFFER_BYTES = 10 * 1024 * 1024;
const PROCESS_COMMAND_TIMEOUT_MS = 10_000;
/** Cap concurrent /proc reads so a stuck cmdline cannot saturate the shared libuv pool. */
export const PROC_READ_BATCH_SIZE = 8;
const PROC_PID_PATTERN = /^\d+$/;
const PROC_VM_RSS_PATTERN = /^VmRSS:[ \t]+(\d+)[ \t]+kB$/m;
const WINDOWS_PROCESS_SNAPSHOT_SCRIPT =
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,WorkingSetSize,ExecutablePath | ConvertTo-Json -Compress';

export const runCommand = (
  executable: string,
  args: string[] = [],
  timeoutMs: number = PROCESS_COMMAND_TIMEOUT_MS
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        maxBuffer: MAX_PS_BUFFER_BYTES,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });

const isCommandTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { killed?: boolean; code?: string };
  return candidate.killed === true || candidate.code === 'ETIMEDOUT';
};

type ProcReadFile = (filePath: string, encoding: 'utf8') => Promise<string>;
type ProcReaddir = (dirPath: string) => Promise<string[]>;

const withTimeout = <T>(
  timeoutMs: number,
  operation: Promise<T>,
  message: string,
  onTimeout?: () => void
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const collectLinuxProcSnapshot = async (
  procRoot: string,
  readFile: ProcReadFile,
  readdir: ProcReaddir,
  signal?: AbortSignal
): Promise<string> => {
  const entries = await readdir(procRoot);
  const pids = entries.filter((entry) => PROC_PID_PATTERN.test(entry));

  const lines = ['PID RSS COMMAND'];

  for (let start = 0; start < pids.length; start += PROC_READ_BATCH_SIZE) {
    // Stop scheduling further batches once the caller budget has expired.
    if (signal?.aborted) break;

    const batch = pids.slice(start, start + PROC_READ_BATCH_SIZE);
    const processes = await Promise.all(
      batch.map(async (pid) => {
        try {
          const status = await readFile(path.join(procRoot, pid, 'status'), 'utf8');
          const rssMatch = status.match(PROC_VM_RSS_PATTERN);
          if (!rssMatch) return null;

          const cmdline = await readFile(path.join(procRoot, pid, 'cmdline'), 'utf8');
          const command = cmdline.replace(/[\0\r\n]/g, ' ').trimEnd();
          return command ? `${pid} ${rssMatch[1]} ${command}` : null;
        } catch {
          // Processes can exit or become unreadable during the snapshot.
          return null;
        }
      })
    );

    for (const processLine of processes) {
      if (processLine !== null) lines.push(processLine);
    }
  }

  return lines.join('\n');
};

// Kernel-blocked /proc reads cannot be cancelled. Keep at most one collect in
// flight so a timed-out refresh cannot stack more libuv work on top.
let linuxProcSnapshotInFlight: Promise<string> | null = null;

/**
 * Reads the process list from /proc instead of `ps`. Used as a fallback on
 * Linux systems where `ps -ww -eo pid,rss,command` is unavailable or unsupported
 * (e.g. Alpine's busybox ps). Emits the same "PID RSS COMMAND" text format
 * as `ps` so the pure parser in lib.ts works unchanged.
 *
 * Bounded by `timeoutMs` so a stuck `/proc/<pid>/cmdline` read cannot leave
 * the status-bar refresh permanently in-flight. On timeout, further batches are
 * not scheduled; already-started reads may finish, and the mutex stays held
 * until that collect settles.
 */
export const readLinuxProcSnapshot = (
  procRoot: string = '/proc',
  timeoutMs: number = PROCESS_COMMAND_TIMEOUT_MS,
  readFile: ProcReadFile = (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  readdir: ProcReaddir = (dirPath) => fs.promises.readdir(dirPath)
): Promise<string> => {
  if (linuxProcSnapshotInFlight) {
    return Promise.reject(new Error('previous /proc snapshot still in progress'));
  }

  const controller = new AbortController();
  const collect = collectLinuxProcSnapshot(procRoot, readFile, readdir, controller.signal);
  // `.finally` returns a distinct promise. If `collect` rejects, that tracker
  // would otherwise surface as an unhandled rejection even though callers await
  // `withTimeout(collect)`.
  const tracked = collect.finally(() => {
    linuxProcSnapshotInFlight = null;
  });
  void tracked.catch(() => {});
  linuxProcSnapshotInFlight = tracked;

  return withTimeout(
    timeoutMs,
    collect,
    `reading /proc process snapshot timed out after ${timeoutMs}ms`,
    () => controller.abort()
  );
};

export const getProcessSnapshot = async (
  execute: (executable: string, args: string[]) => Promise<string> = runCommand,
  platform: NodeJS.Platform = process.platform,
  readProc: (procRoot?: string) => Promise<string> = readLinuxProcSnapshot
): Promise<ProcessSnapshot> => {
  if (platform === 'win32') {
    const raw = await execute('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_PROCESS_SNAPSHOT_SCRIPT,
    ]);
    return { platform, raw };
  }

  try {
    const raw = await execute('ps', ['-ww', '-eo', 'pid,rss,command']);
    return { platform, raw };
  } catch (error) {
    if (platform !== 'linux') throw error;
    // A timed-out `ps` already spent the budget; do not risk another unbounded wait.
    if (isCommandTimeoutError(error)) throw error;
    // Minimal ps implementations may lack these options.
    const raw = await readProc();
    return { platform, raw };
  }
};

export const getEditorMemoryUsage = async (
  readSnapshot: () => Promise<ProcessSnapshot> = getProcessSnapshot,
  execPath: string = process.execPath,
  totalMemory: () => number = os.totalmem
): Promise<EditorMemoryUsage> => {
  const snapshot = await readSnapshot();
  const { totalKb, matched, parseError } = summarizeProcessSnapshot(
    snapshot.platform,
    execPath,
    snapshot.raw
  );
  if (parseError) throw new Error('could not parse the process snapshot (invalid JSON from PowerShell)');
  if (matched === 0) throw new Error('no editor processes matched');
  return {
    usedKb: totalKb,
    processCount: matched,
    systemTotalBytes: totalMemory(),
  };
};
