'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runCommand } = require('../out/system');

test('runCommand successfully executes a shell command and returns output', async () => {
  const output = await runCommand('echo "omnimem-test"');
  assert.ok(output.includes('omnimem-test'));
});

test('runCommand rejects when command is invalid', async () => {
  await assert.rejects(async () => {
    await runCommand('non_existent_command_12345_xyz');
  });
});
