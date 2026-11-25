'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getEditorMemoryUsage,
  getProcessSnapshot,
  readLinuxProcSnapshot,
  runCommand,
} = require('../out/system');

test('runCommand returns output from the executable', async () => {
  const output = await runCommand(process.execPath, ['-p', 'JSON.stringify("omnimem-test")']);
  assert.ok(output.includes('omnimem-test'));
});

test('runCommand rejects when command is invalid', async () => {
  await assert.rejects(async () => {
    await runCommand('non_existent_command_12345_xyz');
  });
});

test('getProcessSnapshot selects the command for Unix and Windows', async () => {
  const commands = [];
  const execute = async (command, args) => {
    commands.push([command, ...args]);
    return 'snapshot';
  };

  assert.deepEqual(await getProcessSnapshot(execute, 'darwin'), { platform: 'darwin', raw: 'snapshot' });
  assert.deepEqual(commands[0], ['ps', '-ww', '-eo', 'pid,rss,command']);

  assert.deepEqual(await getProcessSnapshot(execute, 'win32'), { platform: 'win32', raw: 'snapshot' });
  assert.equal(commands[1][0], 'powershell');
  assert.match(commands[1].at(-1), /Get-CimInstance Win32_Process/);
});

test('getEditorMemoryUsage summarizes a valid process snapshot', async () => {
  const readSnapshot = async () => ({
    platform: 'linux',
    raw: [
      'PID RSS COMMAND',
      '1 10000 /usr/bin/editor --type=main',
      '2 15000 /usr/bin/editor --type=renderer',
    ].join('\n'),
  });

  assert.deepEqual(
    await getEditorMemoryUsage(readSnapshot, '/usr/bin/editor', () => 32 * 1024 ** 3),
    { usedKb: 25000, processCount: 2, systemTotalBytes: 32 * 1024 ** 3 }
  );
});

test('getEditorMemoryUsage rejects invalid and unmatched snapshots', async () => {
  await assert.rejects(
    () => getEditorMemoryUsage(async () => ({ platform: 'win32', raw: 'invalid json' }), 'C:\\Editor\\Editor.exe'),
    /could not parse/
  );

  await assert.rejects(
    () => getEditorMemoryUsage(async () => ({ platform: 'linux', raw: 'PID RSS COMMAND' }), '/usr/bin/editor'),
    /no editor processes matched/
  );
});

test('getProcessSnapshot falls back to /proc on Linux when ps fails', async () => {
  const execute = async () => {
    throw new Error('ps: invalid option');
  };
  const readProc = async () => 'PID RSS COMMAND\n1 1000 /usr/bin/editor';

  assert.deepEqual(await getProcessSnapshot(execute, 'linux', readProc), {
    platform: 'linux',
    raw: 'PID RSS COMMAND\n1 1000 /usr/bin/editor',
  });
});

test('getProcessSnapshot does not use the /proc fallback on other unix platforms', async () => {
  const execute = async () => {
    throw new Error('ps failed');
  };
  const readProc = async () => 'should not be called';

  await assert.rejects(() => getProcessSnapshot(execute, 'darwin', readProc), /ps failed/);
});

test('readLinuxProcSnapshot builds ps-compatible output from a proc tree', async () => {
  const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimem-proc-'));
  try {
    fs.mkdirSync(path.join(procRoot, '1234'));
    fs.mkdirSync(path.join(procRoot, 'notapid'));
    fs.writeFileSync(
      path.join(procRoot, '1234', 'status'),
      'Name:\teditor\nVmRSS:\t   20480 kB\nVmSize:\t  100 kB\n'
    );
    fs.writeFileSync(
      path.join(procRoot, '1234', 'cmdline'),
      '/usr/bin/editor\0--type=main\n123 5000 /usr/bin/editor\0'
    );
    // A pid whose files vanish mid-read must be skipped, not fail the snapshot.
    fs.mkdirSync(path.join(procRoot, '5678'));

    const output = await readLinuxProcSnapshot(procRoot);
    const lines = output.split('\n');

    assert.equal(lines[0], 'PID RSS COMMAND');
    assert.deepEqual(lines.slice(1), ['1234 20480 /usr/bin/editor --type=main 123 5000 /usr/bin/editor']);
  } finally {
    fs.rmSync(procRoot, { recursive: true, force: true });
  }
});
