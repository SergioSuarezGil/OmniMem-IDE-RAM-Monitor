'use strict';

import { exec } from 'child_process';
import * as os from 'os';
import { summarizeProcessSnapshot } from './lib';
import { ProcessSnapshot, EditorMemoryUsage } from './types';

const MAX_PS_BUFFER_BYTES = 10 * 1024 * 1024;
const UNIX_PROCESS_SNAPSHOT_COMMAND = 'ps -eo pid,rss,command';
const WINDOWS_PROCESS_SNAPSHOT_COMMAND =
  'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,WorkingSetSize,ExecutablePath | ConvertTo-Json -Compress"';

export const runCommand = (command: string): Promise<string> =>
  new Promise((resolve, reject) => {
    exec(command, { maxBuffer: MAX_PS_BUFFER_BYTES }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });

export const getProcessSnapshot = async (): Promise<ProcessSnapshot> => {
  if (process.platform === 'win32') {
    const raw = await runCommand(WINDOWS_PROCESS_SNAPSHOT_COMMAND);
    return { platform: 'win32', raw };
  }
  const raw = await runCommand(UNIX_PROCESS_SNAPSHOT_COMMAND);
  return { platform: process.platform, raw };
};

export const getEditorMemoryUsage = async (): Promise<EditorMemoryUsage> => {
  const snapshot = await getProcessSnapshot();
  const { totalKb, matched, parseError } = summarizeProcessSnapshot(
    snapshot.platform,
    process.execPath,
    snapshot.raw
  );
  if (parseError) throw new Error('could not parse the process snapshot (invalid JSON from PowerShell)');
  if (matched === 0) throw new Error('no editor processes matched');
  return {
    usedKb: totalKb,
    processCount: matched,
    systemTotalBytes: os.totalmem(),
  };
};
