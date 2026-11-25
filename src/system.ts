'use strict';

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { summarizeProcessSnapshot } from './lib';
import { ProcessSnapshot, EditorMemoryUsage } from './types';

const MAX_PS_BUFFER_BYTES = 10 * 1024 * 1024;
const PROCESS_COMMAND_TIMEOUT_MS = 10_000;
const PROC_READ_BATCH_SIZE = 32;
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

/**
 * Reads the process list from /proc instead of `ps`. Used as a fallback on
 * Linux systems where `ps -ww -eo pid,rss,command` is unavailable or unsupported
 * (e.g. Alpine's busybox ps). Emits the same "PID RSS COMMAND" text format
 * as `ps` so the pure parser in lib.ts works unchanged.
 */
export const readLinuxProcSnapshot = async (procRoot: string = '/proc'): Promise<string> => {
  const entries = await fs.promises.readdir(procRoot);
  const pids = entries.filter((entry) => PROC_PID_PATTERN.test(entry));

  const lines = ['PID RSS COMMAND'];

  for (let start = 0; start < pids.length; start += PROC_READ_BATCH_SIZE) {
    const batch = pids.slice(start, start + PROC_READ_BATCH_SIZE);
    const processes = await Promise.all(
      batch.map(async (pid) => {
        try {
          const status = await fs.promises.readFile(path.join(procRoot, pid, 'status'), 'utf8');
          const rssMatch = status.match(PROC_VM_RSS_PATTERN);
          if (!rssMatch) return null;

          const cmdline = await fs.promises.readFile(path.join(procRoot, pid, 'cmdline'), 'utf8');
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
