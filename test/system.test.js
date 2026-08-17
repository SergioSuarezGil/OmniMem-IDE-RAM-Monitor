'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEditorMemoryUsage, getProcessSnapshot, runCommand } = require('../out/system');

test('runCommand successfully executes a shell command and returns output', async () => {
  const output = await runCommand('echo "omnimem-test"');
  assert.ok(output.includes('omnimem-test'));
});

test('runCommand rejects when command is invalid', async () => {
  await assert.rejects(async () => {
    await runCommand('non_existent_command_12345_xyz');
  });
});

test('getProcessSnapshot selects the command for Unix and Windows', async () => {
  const commands = [];
  const execute = async (command) => {
    commands.push(command);
    return 'snapshot';
  };

  assert.deepEqual(await getProcessSnapshot(execute, 'darwin'), { platform: 'darwin', raw: 'snapshot' });
  assert.match(commands[0], /^ps /);

  assert.deepEqual(await getProcessSnapshot(execute, 'win32'), { platform: 'win32', raw: 'snapshot' });
  assert.match(commands[1], /^powershell /);
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
